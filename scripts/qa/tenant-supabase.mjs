// Embedded PostgreSQL plus isolated Auth/Storage HTTP adapters. No Docker, hosted
// Supabase project, real credentials or customer records are used by this helper.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { startSupabaseMock } from './supabase-mock.mjs';
import { createEmptyWorkspace } from '../../templates/leads/lib/crm/new-workspace.ts';

const { PGlite } = createRequire(new URL('../../templates/leads/package.json', import.meta.url))('@electric-sql/pglite');

export async function startTenantSupabase({ legacyData = createEmptyWorkspace('Existing ClearFlow'), signupEnabled = true } = {}) {
  const db = new PGlite(), secret = 'sb_secret_tenant_isolated_qa', objects = new Map();
  const control = { unavailable: false, lostCommits: 0, commits: 0, missingRPCs: new Set() }, calls = [];
  let server, auth;
  const sql = (statement, params = []) => db.query(statement, params);
  const service = (expression, values = []) => db.transaction(async tx => {
    await tx.exec('set local role service_role');
    return (await tx.query('select ' + expression + ' as result', values)).rows[0].result;
  });
  const rpc = (name, body = {}) => {
    switch (name) {
      case 'crm_store_read': return service('public.crm_store_read()');
      case 'crm_store_import': return service('public.crm_store_import($1::jsonb)', [body.p_data]);
      case 'crm_store_commit': return service('public.crm_store_commit($1,$2::jsonb,$3::uuid)', [body.p_revision, body.p_data, body.p_request_id]);
      case 'crm_tenant_read': return service('public.crm_tenant_read($1)', [body.p_workspace_id]);
      case 'crm_tenant_commit': return service('public.crm_tenant_commit($1,$2,$3::jsonb,$4::uuid)', [body.p_workspace_id, body.p_revision, body.p_data, body.p_request_id]);
      case 'crm_provision_workspace': return service('public.crm_provision_workspace($1::uuid,$2,$3::jsonb)', [body.p_user_id, body.p_name, body.p_data]);
      case 'crm_set_workspace_token': return service('public.crm_set_workspace_token($1,$2)', [body.p_workspace_id, body.p_token_hash]);
      case 'crm_resolve_workspace_token': return service('public.crm_resolve_workspace_token($1)', [body.p_token_hash]);
      case 'crm_workspace_connection': return service('public.crm_workspace_connection($1)', [body.p_workspace_id]);
      case 'crm_consume_limit': return service('public.crm_consume_limit($1,$2,$3)', [body.p_key, body.p_limit, body.p_window_ms]);
      default: throw Object.assign(new Error('Unknown isolated RPC.'), { status: 404 });
    }
  };
  const mirrorAccount = user => sql('insert into auth.users(id,email,email_confirmed_at) values ($1,$2,$3) on conflict (id) do update set email = excluded.email, email_confirmed_at = excluded.email_confirmed_at', [user.id, user.email, user.email_confirmed_at === undefined ? '2026-01-01' : user.email_confirmed_at]);
  const close = async () => {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (auth) await auth.close();
    await db.close();
  };
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, deleted_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint);`);
    for (const migration of ['202610200001_crm_workspace_access.sql', '202610210001_crm_cloud_storage.sql', '202610220001_crm_private_workspaces.sql']) {
      await db.exec(await readFile(new URL('../../supabase/migrations/' + migration, import.meta.url), 'utf8'));
    }
    await rpc('crm_store_import', { p_data: legacyData });
    auth = await startSupabaseMock({ signupEnabled, onSignup: mirrorAccount, onConfirmed: mirrorAccount, resolveMembership: async user => (await sql('select user_id, workspace_id, role, display_name from public.crm_workspace_members where user_id = $1::uuid', [user.id])).rows });
    for (const user of auth.accounts || [auth.owner, auth.outsider, auth.member]) await mirrorAccount(user);
    for (const [user, role] of [[auth.owner, 'owner'], [auth.member, 'member']]) {
      await sql("insert into public.crm_workspace_members(user_id,workspace_id,role,display_name) values ($1,'clearflow',$2,$3)", [user.id, role, role === 'owner' ? 'QA Owner' : 'QA Member']);
    }
    server = createServer(async (request, response) => {
      const send = (body, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
      try {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const bytes = Buffer.concat(chunks); calls.push({ pathname, method: request.method });
        if (pathname.startsWith('/auth/') || pathname === '/rest/v1/crm_workspace_members') {
          const headers = { ...request.headers }; delete headers.host; delete headers.connection; delete headers['content-length'];
          const upstream = await fetch(auth.url + request.url, { method: request.method, headers, ...(['GET', 'HEAD'].includes(request.method) ? {} : { body: bytes }) });
          response.writeHead(upstream.status, Object.fromEntries(upstream.headers)); response.end(Buffer.from(await upstream.arrayBuffer())); return;
        }
        if (request.headers.apikey !== secret) return send({ code: '42501' }, 403);
        if (control.unavailable) return send({ code: 'unavailable' }, 503);
        const body = () => JSON.parse(bytes.toString() || '{}');
        if (pathname.startsWith('/storage/v1/object/crm-private/')) {
          const key = decodeURIComponent(pathname.slice('/storage/v1/object/crm-private/'.length));
          if (request.method === 'GET') { if (!objects.has(key)) return send({ code: 'not_found' }, 404); response.writeHead(200); response.end(objects.get(key)); return; }
          if (request.method === 'POST') { if (objects.has(key)) return send({ code: 'Duplicate' }, 409); objects.set(key, bytes); return send({ Key: key }); }
        }
        if (pathname === '/storage/v1/object/crm-private' && request.method === 'DELETE') { body().prefixes.forEach(key => objects.delete(key)); return send({}); }
        if (pathname === '/storage/v1/object/list/crm-private' && request.method === 'POST') {
          const input = body(), entries = new Map(), prefix = input.prefix + '/';
          for (const [key, data] of objects) if (key.startsWith(prefix)) {
            const remaining = key.slice(prefix.length), name = remaining.split('/')[0];
            entries.set(name, remaining.includes('/') ? { name, id: null } : { name, id: name, metadata: { size: data.length } });
          }
          return send([...entries.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(input.offset, input.offset + input.limit));
        }
        if (!pathname.startsWith('/rest/v1/rpc/') || request.method !== 'POST') return send({}, 404);
        const name = pathname.slice('/rest/v1/rpc/'.length);
        if (control.missingRPCs.has(name)) return send({ code: 'PGRST202' }, 404);
        const result = await rpc(name, body());
        if (['crm_store_commit', 'crm_tenant_commit'].includes(name)) {
          control.commits++;
          if (control.lostCommits > 0) { control.lostCommits--; response.destroy(); return; }
        }
        send(result);
      } catch (error) { send({ code: 'isolated_qa_error' }, error.status || 400); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { ...auth, auth, url: `http://127.0.0.1:${server.address().port}`, key: auth.key, secret, db, sql, rpc, objects, control, calls, close };
  } catch (error) { await close(); throw error; }
}
