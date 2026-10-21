// Real isolated PostgreSQL for SQL/RLS/concurrency checks; mock Storage and Auth.
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { startSupabaseMock } from './supabase-mock.mjs';
const execute = promisify(execFile);
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
export async function startCloudSupabase() {
  const name = 'crm-cloud-qa-' + randomUUID().slice(0, 8), secret = 'sb_secret_isolated_cloud_qa_only';
  let auth, server;
  const docker = (...args) => execute('docker', args, { encoding: 'utf8', maxBuffer: 10_000_000, timeout: 60000 });
  const sql = statement => new Promise((resolve, reject) => {
    // stdin avoids Windows' command-line size limit for complete CRM snapshots.
    const child = spawn('docker', ['exec', '-i', name, 'psql', '-X', '-qAt', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', diagnostic = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { diagnostic += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(Object.assign(new Error('Isolated SQL failed.'), { stderr: diagnostic })));
    child.stdin.end(statement + '\n');
  });
  const close = async () => {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (auth) await auth.close();
    await docker('rm', '-f', name).catch(() => {});
  };
  try {
    await docker('run', '-d', '--name', name, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_PASSWORD=isolated-qa-only', 'postgres:16-alpine');
    for (let i = 0; ; i++) { try { await docker('exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'); break; } catch { if (i >= 60) throw new Error('QA Postgres startup failed.'); await new Promise(resolve => setTimeout(resolve, 250)); } }
    await sql('create role anon; create role authenticated; create role service_role bypassrls; create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint);');
    const migration = await readFile(new URL('../../supabase/migrations/202610210001_crm_cloud_storage.sql', import.meta.url), 'utf8');
    execFileSync('docker', ['exec', '-i', name, 'psql', '-X', '-q', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: migration, encoding: 'utf8', maxBuffer: 1_000_000 });
    auth = await startSupabaseMock();
    const objects = new Map(), control = { unavailable: false, lostCommits: 0, commits: 0 };
    server = createServer(async (req, res) => {
      try {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (pathname.startsWith('/auth/') || pathname === '/rest/v1/crm_workspace_members') {
          const chunks = []; for await (const chunk of req) chunks.push(chunk);
          const headers = { ...req.headers }; delete headers.host; delete headers.connection; delete headers['content-length'];
          const upstream = await fetch(auth.url + req.url, { method: req.method, headers, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) });
          res.writeHead(upstream.status, Object.fromEntries(upstream.headers)); res.end(Buffer.from(await upstream.arrayBuffer())); return;
        }
        const send = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
        if (req.headers.apikey !== secret) return send({ code: '42501' }, 403);
        if (control.unavailable) return send({ code: 'unavailable' }, 503);
        const chunks = []; for await (const chunk of req) chunks.push(chunk); const bytes = Buffer.concat(chunks);
        if (pathname === '/storage/v1/object/list/crm-private' && req.method === 'POST') {
          const body = JSON.parse(bytes), entries = new Map(), prefix = body.prefix + '/';
          for (const [key, data] of objects) if (key.startsWith(prefix)) {
            const remaining = key.slice(prefix.length), name = remaining.split('/')[0];
            entries.set(name, remaining.includes('/') ? { name, id: null } : { name, id: name, metadata: { size: data.length } });
          }
          return send([...entries.values()].sort((a,b) => a.name.localeCompare(b.name)).slice(body.offset, body.offset + body.limit));
        }
        if (pathname.startsWith('/storage/v1/object/crm-private/')) {
          const key = decodeURIComponent(pathname.slice('/storage/v1/object/crm-private/'.length));
          if (req.method === 'GET') { if (!objects.has(key)) return send({ code: 'not_found' }, 404); res.writeHead(200); res.end(objects.get(key)); return; }
          if (req.method === 'POST') { if (objects.has(key)) return send({ code: 'Duplicate' }, 409); objects.set(key, bytes); return send({ Key: key }); }
        }
        if (pathname === '/storage/v1/object/crm-private' && req.method === 'DELETE') { JSON.parse(bytes).prefixes.forEach(key => objects.delete(key)); return send({}); }
        const body = JSON.parse(bytes.toString() || '{}');
        let expression;
        switch (pathname) {
          case '/rest/v1/rpc/crm_store_read': expression = 'public.crm_store_read()'; break;
          case '/rest/v1/rpc/crm_store_import': expression = `public.crm_store_import(${literal(JSON.stringify(body.p_data))}::jsonb)`; break;
          case '/rest/v1/rpc/crm_store_commit': expression = `public.crm_store_commit(${Number(body.p_revision)},${literal(JSON.stringify(body.p_data))}::jsonb,${literal(body.p_request_id)}::uuid)`; break;
          case '/rest/v1/rpc/crm_consume_limit': expression = `public.crm_consume_limit(${literal(body.p_key)},${Number(body.p_limit)},${Number(body.p_window_ms)})`; break;
          default: return send({ code: 'PGRST202' }, 404);
        }
        const output = await sql(`set role service_role; select to_jsonb(${expression});`);
        if (pathname.endsWith('crm_store_commit')) { control.commits++; if (control.lostCommits > 0) { control.lostCommits--; res.destroy(); return; } }
        send(JSON.parse(output));
      } catch (error) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: String(error.stderr || '').includes('P0002') || String(error.stderr || '').includes('Import the existing') ? 'P0002' : 'qa_error' })); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { ...auth, url: `http://127.0.0.1:${server.address().port}`, key: auth.key, secret, auth, objects, control, sql, close };
  } catch (error) { await close(); throw error; }
}
