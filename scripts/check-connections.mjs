// Isolated browser/API QA. Google and n8n are simulated; no real accounts/sends.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { request as httpRequest } from 'node:http';
import { startTenantSupabase } from './qa/tenant-supabase.mjs';
const root = process.cwd(), app = path.join(root, 'templates/leads'), output = path.join(root, '.local-preview/connections');
mkdirSync(output, { recursive: true });
const { chromium } = createRequire(path.join(root, '.local-tools/browser-testing/package.json'))('playwright-core');
const service = await startTenantSupabase(), port = 3024, base = `http://127.0.0.1:${port}`;
const entry = path.join(output, 'next-server.cjs');
writeFileSync(entry, `const next=require(${JSON.stringify(path.join(app, 'node_modules/next'))});const http=require('node:http');const app=next({dev:true,webpack:true,dir:${JSON.stringify(app)},hostname:'127.0.0.1',port:${port}});app.prepare().then(()=>http.createServer(app.getRequestHandler()).listen(${port},'127.0.0.1'));`);
const log = createWriteStream(path.join(output, 'server.log'));
const server = spawn(process.execPath, [entry], { cwd: app, windowsHide: true, env: { ...process.env, CRM_NEXT_DIST_DIR: '.next-connections-qa', CRM_DATA_DIR: path.join(output, 'isolated-data-' + randomUUID()), CRM_STORAGE_BACKEND: 'supabase', NEXT_PUBLIC_SUPABASE_URL: service.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: service.key, SUPABASE_SECRET_KEY: service.secret, SUPABASE_URL: service.url, CRM_GOOGLE_CONNECTIONS_ENABLED: 'false', N8N_WEBHOOK_SECRET: randomUUID(), GEMINI_ASSISTANT_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.pipe(log); server.stderr.pipe(log);
let browser;
try {
  let ready = false;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/login', { signal: AbortSignal.timeout(3000) })).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 1000)); }
  assert(ready, 'QA server did not become ready.');
  // Node fetch replaces Host; use a direct HTTP request to exercise the real
  // incoming host through Next's proxy without following a production redirect.
  const requestHost = (resource, host) => new Promise((resolve, reject) => {
    const request = httpRequest(new URL(base + resource), { headers: { Host: host } }, response => {
      response.resume(); resolve({ status: response.statusCode, headers: new Headers(response.headers) });
    });
    request.on('error', reject); request.end();
  });
  for (const host of ['ai-customer-lead-crm-system.vercel.app', 'ai-customer-lead-crm-system-1hmk.vercel.app']) {
    const redirect = await requestHost('/login?next=%2Finbox', host);
    assert.equal(redirect.status, 307); assert.equal(redirect.headers.get('location'), 'https://ai-customer-lead-crm-system-oyh1.vercel.app/login?next=%2Finbox');
    assert.match(redirect.headers.get('cache-control'), /no-store/);
    const api = await requestHost('/api/crm', host);
    assert.equal(api.status, 401); assert.equal(api.headers.get('location'), null, 'API authentication must not redirect between projects.');
  }
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  assert.equal((await context.request.get(base + '/api/connections/google')).status(), 401);
  assert.equal((await context.request.post(base + '/api/n8n/onboarding', { data: { action: 'claim' } })).status(), 401);
  const signup = { action: 'signup', businessName: 'Connection QA business', email: 'connection.qa@example.com', password: 'isolated-connection-password', confirmPassword: 'isolated-connection-password' };
  assert.equal((await context.request.post(base + '/api/auth', { headers: { Origin: base }, data: signup })).status(), 200);
  const disabled = await context.request.get(base + '/api/connections/google'); assert.equal(disabled.status(), 200); assert.equal((await disabled.json()).available, false);
  assert.equal((await context.request.post(base + '/api/connections/google', { headers: { Origin: 'https://outside.test' }, data: { action: 'connect' } })).status(), 403);
  const memberContext = await browser.newContext();
  assert.equal((await memberContext.request.post(base + '/api/auth', { headers: { Origin: base }, data: { action: 'login', email: service.auth.member.email, password: service.auth.password } })).status(), 200);
  assert.equal((await memberContext.request.get(base + '/api/connections/google')).status(), 403); await memberContext.close();
  const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/connections'); await page.getByText('Email connection setup is not available yet.', { exact: false }).waitFor();
  await page.screenshot({ path: path.join(output, 'not-enabled.png'), fullPage: true });
  let status = { available: true, owner: true, managed: false, phase: 'not-connected', step: 'google', email: '', spreadsheetUrl: '', message: '', pending: false, canRetry: false };
  const steps = ['labels', 'spreadsheet', 'gmail-credential', 'sheets-credential', 'crm-credential', 'register', 'workflow', 'verify', 'complete'], actions = [];
  let pendingReads = 0, completionPhase = '';
  await page.route('**/api/connections/google', async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON(); actions.push(body);
      if (body.action === 'connect') return route.fulfill({ json: { authorizationUrl: base + '/connections?connected=google' } });
      if (body.action === 'advance') { status.step = steps[steps.indexOf(status.step) + 1]; if (status.step === 'complete') status.phase = 'ready'; }
      if (body.action === 'enable') { assert.equal(body.confirmed, true); status.pending = true; completionPhase = 'active'; pendingReads = 0; }
      if (body.action === 'pause') { status.pending = true; completionPhase = 'paused'; pendingReads = 0; }
      return route.fulfill({ json: { ok: true } });
    }
    if (completionPhase && ++pendingReads >= 3) { status.phase = completionPhase; status.pending = false; completionPhase = ''; }
    return route.fulfill({ json: status });
  });
  await page.reload(); await page.getByRole('button', { name: 'Connect Google', exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'connect-google.png'), fullPage: true });
  status = { ...status, phase: 'setting-up', step: 'labels', email: 'inbox.qa@example.com', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/qa_only_sheet_id_123456789/edit' };
  await page.getByRole('button', { name: 'Connect Google', exact: true }).click();
  await page.getByRole('button', { name: 'Enable inquiry processing', exact: true }).waitFor({ timeout: 25000 });
  assert.equal(actions.filter(a => a.action === 'advance').length, 8);
  const enable = page.getByRole('button', { name: 'Enable inquiry processing', exact: true }); assert(await enable.isDisabled());
  await page.screenshot({ path: path.join(output, 'ready-desktop.png'), fullPage: true });
  await page.getByRole('checkbox').check(); await enable.click();
  const waitingEnable = page.getByRole('button', { name: 'Waiting for processing to start…', exact: true }); await waitingEnable.waitFor(); assert(await waitingEnable.isDisabled());
  await page.getByRole('button', { name: 'Pause processing', exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'processing-enabled.png'), fullPage: true });
  await page.getByRole('button', { name: 'Pause processing', exact: true }).click();
  const waitingPause = page.getByRole('button', { name: 'Waiting for processing to pause…', exact: true }); await waitingPause.waitFor(); assert(await waitingPause.isDisabled());
  await enable.waitFor(); assert(await enable.isDisabled());
  status = { ...status, phase: 'setting-up', step: 'gmail-credential', pending: true, workerOnline: false, message: 'Waiting for the background service to reconnect. Your setup request is saved.' };
  await page.reload(); await page.getByText('Waiting for the background service to reconnect.', { exact: false }).waitFor();
  const countBefore = actions.length; await page.waitForTimeout(2800); assert.equal(actions.length, countBefore, 'Waiting for Docker must not repeat setup mutations.');
  await page.screenshot({ path: path.join(output, 'waiting-for-docker.png'), fullPage: true });
  status = { ...status, phase: 'attention', pending: true, message: 'A setup result could not be confirmed. Contact support before trying again.', canRetry: false };
  await page.reload(); await page.getByText('A setup result could not be confirmed.', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Retry setup step' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Enable inquiry processing' }).count(), 0);
  await page.screenshot({ path: path.join(output, 'uncertain-result.png'), fullPage: true });
  status = { ...status, phase: 'ready', step: 'complete', pending: false, message: '' };
  await page.setViewportSize({ width: 390, height: 844 }); await page.reload(); await enable.waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: path.join(output, 'ready-mobile.png'), fullPage: true });
  await page.evaluate(() => document.documentElement.classList.add('dark')); await page.screenshot({ path: path.join(output, 'ready-mobile-dark.png'), fullPage: true });
  assert.deepEqual(errors, []);
  const snapshot = await (await context.request.get(base + '/api/crm')).json(); assert.equal(snapshot.leads.length, 0); assert.equal(snapshot.mailJobs.length, 0);
  console.log('Passed isolated connection UI/API checks: old public address redirects with API authentication retained, authentication, worker authentication, owner-only access, origin checks, disabled setup, automatic progress, confirmed asynchronous enable/pause, offline queued setup without mutation retries, uncertain-result stop, mobile/dark layout. Google/n8n were simulated; no real account, Sheet, workflow or email was created.');
} finally {
  await browser?.close();
  if (server.pid) server.kill('SIGTERM');
  await service.close(); log.end();
}
