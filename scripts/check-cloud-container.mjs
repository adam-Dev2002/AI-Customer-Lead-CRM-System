// Isolated Linux-image checks. Never mounts the actual CRM or n8n data.
// Build customerlead-hosting-qa with the mock public Auth arguments in the launch guide.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const { request } = await import(pathToFileURL(path.join(root, '.local-tools/browser-testing/node_modules/playwright-core/index.mjs')));
const id = randomUUID().slice(0, 8), container = `customerlead-qa-${id}`, network = `customerlead-qa-${id}`;
const directory = path.join(root, '.local-preview', 'hosting-qa', id), storage = path.join(directory, 'crm');
const image = 'customerlead-hosting-qa', baseURL = 'http://127.0.0.1:3003';
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 2_000_000, timeout: 120_000 }).trim();
const key = 'sb_publishable_isolated_qa_only', secret = `isolated-qa-${id}`;
const sessions = [];
const session = async () => { const context = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL }, timeout: 60_000 }); sessions.push(context); return context; };
async function login(context, email = 'owner.qa@example.com') {
  return context.post('/api/auth', { data: { action: 'login', email, password: 'isolated-qa-password', next: '/' } });
}
async function ready() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(baseURL + '/login')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Isolated container did not start.');
}
function mockAuth() { docker('exec', '-d', container, 'node', '/tmp/start-auth.mjs'); }

try {
  await mkdir(storage, { recursive: true });
  await writeFile(path.join(storage, 'crm.json'), JSON.stringify({ version: 1, emailMirrorVersion: 1, leads: [], drafts: [], tasks: [], activities: [], settings: { businessName: 'Isolated hosting QA', automaticEmailsEnabled: false }, notificationsReadAt: '', processedEventIds: [], lastAutomationEventAt: '', syncChanges: [], archivedLeadIds: [], lastSyncPollAt: '', lastConfigReadAt: '', mailJobs: [], lastMailPollAt: '', mailSenderEmail: '' }));

  // The image must refuse an empty mount instead of seeding dummy customers.
  let refused = false;
  try { docker('run', '--rm', '--network', 'none', image); }
  catch (error) { refused = error.status === 1 && error.stderr?.includes('persistent volume does not contain crm.json'); }
  assert.ok(refused, 'Missing storage must stop startup.');
  console.log('PASS: startup refuses missing restored storage');
  let n8nRefused = false;
  try { docker('run', '--rm', '--network', 'none', '--entrypoint', '/bin/sh', '--mount', `type=bind,source=${path.join(root, 'deploy/customerlead/launch-n8n.sh')},target=/launch-n8n.sh,readonly`, 'docker.n8n.io/n8nio/n8n:2.43.8', '/launch-n8n.sh'); }
  catch (error) { n8nRefused = error.status === 1 && error.stderr?.includes('restore its complete existing SQLite data directory'); }
  assert.ok(n8nRefused, 'Missing n8n storage must stop startup.');
  console.log('PASS: n8n refuses missing restored database and encryption configuration');

  docker('network', 'create', network);
  docker('run', '-d', '--name', container, '--network', network, '--network-alias', 'host.docker.internal', '--shm-size', '256m', '-p', '127.0.0.1:3003:3001', '--mount', `type=bind,source=${storage},target=/data/crm`, '-e', `N8N_WEBHOOK_SECRET=${secret}`, '-e', 'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321', '-e', `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${key}`, '-e', `CRM_REPORT_SERVERLESS=${process.argv.includes('--serverless-browser') ? '1' : '0'}`, image);
  await ready();
  const mock = (await readFile(path.join(root, 'scripts/qa/supabase-mock.mjs'), 'utf8')).replace('server.listen(0, "127.0.0.1", resolve)', 'server.listen(54321, "127.0.0.1", resolve)');
  assert.ok(mock.includes('server.listen(54321'));
  await writeFile(path.join(directory, 'mock.mjs'), mock);
  await writeFile(path.join(directory, 'start-auth.mjs'), "import { startSupabaseMock } from './mock.mjs'; await startSupabaseMock();");
  docker('cp', path.join(directory, 'mock.mjs'), container + ':/tmp/mock.mjs');
  docker('cp', path.join(directory, 'start-auth.mjs'), container + ':/tmp/start-auth.mjs');
  mockAuth();
  // Confirm readiness without logging credentials or cookies.
  for (let i = 0; i < 30; i++) {
    try { docker('exec', container, 'node', '-e', "fetch('http://127.0.0.1:54321/auth/v1/settings',{headers:{apikey:'sb_publishable_isolated_qa_only'}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"); break; }
    catch { if (i === 29) throw new Error('Mock Auth did not start.'); await new Promise(resolve => setTimeout(resolve, 200)); }
  }

  const anonymous = await session();
  assert.equal((await anonymous.get('/api/crm')).status(), 401);
  const outsider = await session();
  assert.equal((await login(outsider, 'outsider.qa@example.com')).status(), 403);
  assert.equal((await outsider.get('/api/crm')).status(), 401);
  const owner = await session();
  assert.equal((await login(owner)).status(), 200);
  const initial = await owner.get('/api/crm');
  assert.equal(initial.status(), 200);
  assert.equal((await initial.json()).leads.length, 0);
  assert.equal((await owner.post('/api/crm', { headers: { Origin: 'https://other.example.test' }, data: { action: 'lead.create', payload: {} } })).status(), 403);
  console.log('PASS: owner login, membership, signed-out API and cross-origin protection');

  const created = await owner.post('/api/crm', { data: { action: 'lead.create', payload: { name: 'Hosting QA', email: 'isolated@example.com', service: 'Container persistence', message: 'Isolated QA only. Do not send email.', source: 'Manual', consent: false } } });
  assert.equal(created.status(), 200, await created.text());
  const snapshot = await created.json(), leadId = snapshot.leads[0].id;
  assert.equal(snapshot.mailJobs.length, 0);
  const reportResponse = await owner.post('/api/crm/reports', { data: { leadIds: [leadId], label: 'Isolated hosting verification' } });
  assert.equal(reportResponse.status(), 200, await reportResponse.text());
  const reportId = (await reportResponse.json()).report.id;
  const pdf = await owner.get(`/api/crm/reports/${reportId}?format=pdf`);
  assert.equal(pdf.status(), 200);
  assert.equal((await pdf.body()).subarray(0, 4).toString(), '%PDF');
  const xlsx = await owner.get(`/api/crm/reports/${reportId}?format=xlsx`);
  assert.equal(xlsx.status(), 200);
  assert.equal((await xlsx.body()).subarray(0, 2).toString(), 'PK');
  assert.equal((await anonymous.get(`/api/crm/reports/${reportId}?format=pdf`)).status(), 401);
  console.log('PASS: Linux Chromium PDF, Excel export and private report downloads');

  const privateConnection = docker('run', '--rm', '--network', network, '--entrypoint', 'node', image, '-e', "fetch('http://host.docker.internal:3001/login').then(r=>{if(!r.ok)process.exit(1);console.log('connected')}).catch(()=>process.exit(1))");
  assert.equal(privateConnection, 'connected');
  assert.equal((await anonymous.get('/api/n8n/health')).status(), 401);
  assert.equal((await anonymous.get('/api/n8n/health', { headers: { Authorization: `Bearer ${secret}` } })).status(), 200);
  console.log('PASS: private callback network alias and authenticated machine endpoint');

  docker('restart', container);
  await ready(); mockAuth();
  await new Promise(resolve => setTimeout(resolve, 500));
  const restarted = await session();
  assert.equal((await login(restarted)).status(), 200);
  const persisted = await (await restarted.get('/api/crm')).json();
  assert.equal(persisted.leads.length, 1); assert.equal(persisted.leads[0].id, leadId); assert.equal(persisted.mailJobs.length, 0);
  assert.equal((await restarted.get(`/api/crm/reports/${reportId}?format=pdf`)).status(), 200);
  console.log('PASS: saved records and reports survive container restart; no mail queued');

  const compose = path.join(directory, 'deploy');
  await mkdir(compose, { recursive: true });
  for (const filename of ['Caddyfile', 'launch-n8n.sh']) await copyFile(path.join(root, 'deploy/customerlead', filename), path.join(compose, filename));
  await writeFile(path.join(compose, 'compose.yaml'), (await readFile(path.join(root, 'deploy/customerlead/compose.yaml'), 'utf8')).replace('../../templates/leads', path.join(root, 'templates/leads').replaceAll('\\', '/')));
  await writeFile(path.join(compose, 'n8n-runtime.env'), '# Isolated QA only\n');
  await writeFile(path.join(compose, '.env'), `CRM_HOST=crm.example.test\nN8N_HOST=automation.example.test\nACME_EMAIL=qa@example.com\nNEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${key}\nN8N_WEBHOOK_SECRET=${secret}\nCRM_FORM_ID=isolated-qa-form\n`);
  const config = JSON.parse(docker('compose', '--project-directory', compose, 'config', '--format', 'json'));
  assert.equal(config.services.crm.ports[0].host_ip, '127.0.0.1');
  assert.equal(config.services.n8n.ports[0].host_ip, '127.0.0.1');
  assert.ok(!config.services.caddy, 'Public proxy must require its explicit profile.');
  docker('run', '--rm', '--network', 'none', '-e', 'CRM_HOST=crm.example.test', '-e', 'N8N_HOST=automation.example.test', '-e', 'ACME_EMAIL=qa@example.com', '--mount', `type=bind,source=${path.join(compose, 'Caddyfile')},target=/etc/caddy/Caddyfile,readonly`, 'caddy:2', 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile');
  console.log('PASS: Compose resolves, app/editor ports stay private and HTTPS config validates');
  console.log('All hosting container checks passed. Fixtures only:', directory);
} catch (error) {
  // This container contains synthetic records and mock credentials only.
  try { console.error(docker('logs', container)); } catch {}
  throw error;
} finally {
  await Promise.all(sessions.map(context => context.dispose()));
  try { docker('rm', '-f', container); } catch {}
  try { docker('network', 'rm', network); } catch {}
}
