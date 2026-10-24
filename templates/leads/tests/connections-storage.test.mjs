import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash, randomBytes } from 'node:crypto';
import { startTenantSupabase } from '../../../scripts/qa/tenant-supabase.mjs';
import { createEmptyWorkspace } from '../lib/crm/new-workspace.ts';
import { sealConnection, openConnection } from '../lib/connections/config.ts';

test('connection SQL denies browser access, isolates state and cannot replace existing integration tokens', { timeout: 120000 }, async () => {
  const service = await startTenantSupabase();
  try {
    const original = await service.rpc('crm_store_read'), workspaces = [];
    for (const name of ['Business one', 'Business two']) {
      const user = randomUUID();
      await service.sql('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [user, randomUUID() + '@example.com']);
      workspaces.push((await service.rpc('crm_provision_workspace', { p_user_id: user, p_name: name, p_data: createEmptyWorkspace(name) })).workspace_id);
    }
    const [a, b] = workspaces, key = randomBytes(32), payload = sealConnection({ refresh: 'isolated-secret' }, a, key);
    assert.deepEqual(await service.rpc('crm_connection_read', { p_workspace_id: a }), { revision: 0, payload: null });
    assert.deepEqual(await service.rpc('crm_connection_save', { p_workspace_id: a, p_revision: 0, p_payload: payload }), { applied: true, revision: 1 });
    assert.equal((await service.rpc('crm_connection_read', { p_workspace_id: b })).payload, null);
    assert.throws(() => openConnection(payload, b, key), /setup-unavailable/);
    assert.deepEqual(await service.rpc('crm_connection_save', { p_workspace_id: a, p_revision: 0, p_payload: payload }), { applied: false });
    const token = value => createHash('sha256').update(value).digest('hex');
    assert.equal(await service.rpc('crm_connection_register', { p_workspace_id: a, p_token_hash: token('new-connection') }), true);
    assert.equal(await service.rpc('crm_connection_register', { p_workspace_id: a, p_token_hash: token('new-connection') }), true);
    assert.equal(await service.rpc('crm_connection_register', { p_workspace_id: a, p_token_hash: token('different-connection') }), false);
    await service.rpc('crm_set_workspace_token', { p_workspace_id: b, p_token_hash: token('existing-manual') });
    await service.rpc('crm_connection_save', { p_workspace_id: b, p_revision: 0, p_payload: sealConnection({}, b, key) });
    assert.equal(await service.rpc('crm_connection_register', { p_workspace_id: b, p_token_hash: token('replacement') }), false);
    assert.deepEqual(await service.rpc('crm_store_read'), original);
    for (const role of ['anon', 'authenticated']) for (const expression of ['select * from public.crm_business_connections', `select public.crm_connection_read('${a}')`, `select public.crm_connection_save('${a}',1,'${payload}')`, `select public.crm_connection_register('${a}','${token('bad')}')`]) {
      await assert.rejects(service.db.transaction(async tx => { await tx.exec('set local role ' + role); await tx.exec(expression); }), /permission denied/);
    }
    await assert.rejects(service.rpc('crm_connection_save', { p_workspace_id: 'clearflow', p_revision: 0, p_payload: payload }), /Invalid connection state/);
  } finally { await service.close(); }
});
