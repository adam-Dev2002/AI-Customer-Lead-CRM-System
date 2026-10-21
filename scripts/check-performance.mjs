// Production-only benchmark with synthetic records and mock authentication.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { chromium } from '../.local-tools/browser-testing/node_modules/playwright-core/index.mjs';
import { startSupabaseMock } from './qa/supabase-mock.mjs';
import { createSeed } from '../templates/leads/lib/crm/seed.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const app = path.join(root, 'templates/leads'), base = 'http://127.0.0.1:3002';
const labelIndex = process.argv.indexOf('--label');
const label = labelIndex < 0 ? 'current' : process.argv[labelIndex + 1];
const slowNetwork = process.argv.includes('--slow-network');
assert(/^[a-z0-9-]+$/.test(label));
const probe = createServer();
await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(3002, '127.0.0.1', resolve); });
await new Promise(resolve => probe.close(resolve));
const count = 500, output = path.join(root, '.local-preview/performance');
const directory = path.join(output, 'qa-' + randomUUID());
mkdirSync(directory, { recursive: true });
const data = createSeed(), template = data.leads[0];
data.leads = Array.from({ length: count }, (_, i) => ({
  ...template, id: 'PERF-' + i, name: `Performance Customer ${i}`, email: `qa${i}@example.com`,
  service: `Controlled inspection ${i}`, source: 'Manual', status: i % 5 ? 'New' : 'Pending',
  priority: ['Low', 'Normal', 'High', 'Urgent'][i % 4], consent: true, isSample: false,
  createdAt: new Date(Date.now() - (i % 15) * 3600000).toISOString(),
  followUpState: 'Pending', followUpDue: new Date(Date.now() + (i + 1) * 3600000).toISOString(),
  followUpSentAt: '', photoUrl: '',
}));
for (const key of ['drafts', 'tasks', 'activities', 'syncChanges', 'mailJobs']) data[key] = [];
data.emailMirrorVersion = 1;
data.settings.automaticEmailsEnabled = false;
data.settings.businessName = 'Performance QA';
data.settings.businessLogo = '';
writeFileSync(path.join(directory, 'crm.json'), JSON.stringify(data));
const auth = await startSupabaseMock();
const env = { ...process.env, CRM_NEXT_DIST_DIR: '.next-qa', CRM_STORAGE_BACKEND: "local", SUPABASE_SECRET_KEY: "", CRM_DATA_DIR: directory,
  NEXT_PUBLIC_SUPABASE_URL: auth.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: auth.key,
  N8N_WEBHOOK_SECRET: randomUUID(), NEXT_TELEMETRY_DISABLED: '1',
  GEMINI_ASSISTANT_API_KEY: '', GEMINI_ASSISTANT_CONFIG_FILE: path.join(directory, 'not-configured.json'),
  GOOGLE_CONTACTS_CLIENT_ID: '', GOOGLE_CONTACTS_CLIENT_SECRET: '', GOOGLE_CONTACTS_REFRESH_TOKEN: '' };
const log = createWriteStream(path.join(output, `${label}-server.log`));
let server, browser;
const stop = process => {
  if (process?.pid) try { execFileSync('taskkill', ['/pid', String(process.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {}
};
try {
  console.log(`Building isolated production benchmark: ${count} synthetic inquiries.`);
  const build = spawn(process.execPath, [path.join(app, 'node_modules/next/dist/bin/next'), 'build'], { cwd: app, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  build.stdout.pipe(log, { end: false }); build.stderr.pipe(log, { end: false });
  assert.equal(await new Promise(resolve => build.on('exit', resolve)), 0, 'Production build failed; see private benchmark log.');
  server = spawn(process.execPath, [path.join(app, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3002'], { cwd: app, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.pipe(log, { end: false }); server.stderr.pipe(log, { end: false });
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try { if ((await fetch(base + '/login')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert(ready, 'Isolated production server did not start.');
  assert.equal((await fetch(base + '/api/crm')).status, 401);
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const loginContext = await browser.newContext();
  const login = await loginContext.newPage();
  await login.goto(base + '/login');
  await login.getByLabel('Email address', { exact: true }).fill(auth.owner.email);
  await login.getByLabel('Password', { exact: true }).fill(auth.password);
  await login.getByRole('button', { name: 'Sign in', exact: true }).click();
  await login.getByRole('heading', { name: 'Your business, at a glance', exact: true }).waitFor({ timeout: 120000 });
  const storageState = await loginContext.storageState();
  const apiTimes = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now(), response = await loginContext.request.get(base + '/api/crm');
    assert.equal(response.status(), 200); await response.body(); apiTimes.push(performance.now() - start);
  }
  await loginContext.close();
  const routes = [ ['/', 'Your business, at a glance'], ['/leads', 'Your leads'], ['/follow-ups', 'Follow-ups'], ['/inbox', 'Customer inbox'] ];
  const results = [], errors = [], mutations = [];
  for (const mobile of (slowNetwork ? [true] : [false, true])) {
    const context = await browser.newContext({ storageState, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/crm' && route.request().method() !== 'GET') { mutations.push(url.pathname); return route.abort(); }
      if (url.pathname === '/api/crm/company-logo') return route.fulfill({ status: 404 });
      return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort();
    });
    await context.addInitScript(() => {
      window.__perf = { lcp: 0, cls: 0, blockingMs: 0 };
      new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__perf.lcp = entry.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__perf.cls += entry.value; }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__perf.blockingMs += Math.max(0, entry.duration - 50); }).observe({ type: 'longtask', buffered: true });
    });
    for (const [route, heading] of routes) {
      const page = await context.newPage();
      page.setDefaultTimeout(120000);
      page.on('pageerror', error => errors.push(error.message));
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      if (slowNetwork) await cdp.send('Network.emulateNetworkConditions', {
        offline: false, latency: 100, downloadThroughput: 1.6 * 1024 * 1024 / 8,
        uploadThroughput: 750 * 1024 / 8, connectionType: 'cellular4g',
      });
      let crmReads = 0;
      page.on('request', request => { if (request.url() === base + '/api/crm' && request.method() === 'GET') crmReads++; });
      await page.goto(base + route, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: heading, exact: true }).waitFor();
      const contentVisibleMs = await page.evaluate(() => performance.now());
      let interactiveMs = contentVisibleMs;
      if (label !== 'before') {
        await page.locator('[data-crm-ready="true"]').waitFor();
        interactiveMs = await page.evaluate(() => performance.now());
      }
      await page.waitForTimeout(1200);
      const metric = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0], resources = performance.getEntriesByType('resource');
        return { ttfbMs: nav.responseStart, lcpMs: window.__perf.lcp, cls: window.__perf.cls, blockingMs: window.__perf.blockingMs,
          scriptKB: resources.filter(r => r.initiatorType === 'script').reduce((sum, r) => sum + r.encodedBodySize, 0) / 1024 };
      });
      const result = { route, mobile, ...Object.fromEntries(Object.entries({ contentVisibleMs, interactiveMs, ...metric }).map(([key, value]) => [key, Math.round(value * 100) / 100])), initialCrmReads: crmReads };
      results.push(result); console.log(JSON.stringify(result));
      if (label !== 'before' && route === '/follow-ups') {
        await page.getByTestId('next-followup').getByText(/Nothing due yet/).waitFor();
        assert.equal(await page.getByTestId('next-followup').locator('time').getAttribute('datetime'), data.leads[0].followUpDue);
        assert.equal(await page.getByRole('button', { name: 'Due for follow-up 0', exact: true }).getAttribute('aria-describedby'), 'followup-stat-due');
      }
      if (label !== 'before' && route === '/inbox') {
        assert.equal(await page.locator('.crm-inquiry-row').count(), 50);
        await page.getByRole('button', { name: 'Load more inquiries', exact: true }).click();
        await page.getByText('Showing 100 of 500 inquiries', { exact: true }).waitFor();
        assert.equal(await page.locator('.crm-inquiry-row').count(), 100);
        await page.getByLabel('Search inquiries', { exact: true }).fill('Controlled inspection 499');
        await page.getByRole('heading', { name: 'Controlled inspection 499', exact: true }).waitFor();
        assert.equal(await page.locator('.crm-inquiry-row').count(), 1, 'Search must include unloaded inquiries.');
      }
      if (route === '/follow-ups') await page.screenshot({ path: path.join(output, `${label}-followups-${mobile ? 'mobile' : 'desktop'}.png`), fullPage: true });
      await page.close();
    }
    await context.close();
  }
  assert.deepEqual(errors, []); assert.deepEqual(mutations, []);
  if (label !== 'before') {
    const noJS = await browser.newContext({ storageState, javaScriptEnabled: false });
    const rendered = await noJS.newPage();
    await rendered.goto(base + '/follow-ups');
    assert.equal(await rendered.locator('tbody tr').count(), 10, 'Authorized content must arrive in server HTML.');
    await noJS.close();
    const denied = await fetch(base + '/follow-ups', { redirect: 'manual' });
    assert.equal(denied.status, 307);
    assert(!(await denied.text()).includes('Performance Customer'));
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    const photosLoaded = page.waitForResponse(response => response.url() === base + '/api/crm/contact-photos');
    await page.goto(base + '/leads/PERF-0');
    await page.locator('[data-crm-ready="true"]').waitFor();
    await photosLoaded;
    const snapshot = await (await context.request.get(base + '/api/crm')).json();
    const edited = structuredClone(snapshot);
    Object.assign(edited.leads[0], { priority: 'Urgent', notes: 'Unsaved edits stay current after an older read returns.' });
    let reads = 0, photos = 0, write = null, release;
    const held = new Promise(resolve => { release = resolve; });
    page.on('request', request => { if (request.url() === base + '/api/crm/contact-photos') photos++; });
    await page.route('**/api/crm', async route => {
      if (route.request().method() === 'POST') {
        write = route.request().postDataJSON();
        return route.fulfill({ json: edited }); // Browser-only response; no stored mutation.
      }
      reads++; await held; return route.fulfill({ json: snapshot });
    });
    await page.getByRole('button', { name: 'Edit lead', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Edit lead', exact: true });
    await modal.getByLabel('Priority', { exact: true }).selectOption('Urgent');
    await modal.getByLabel('Internal notes', { exact: true }).fill(edited.leads[0].notes);
    await page.evaluate(() => { for (let i = 0; i < 12; i++) window.dispatchEvent(new Event('focus')); });
    await page.waitForTimeout(200);
    assert.equal(reads, 1, 'Focus bursts must share a single workspace read.');
    assert.equal(photos, 0, 'Fresh contact photos must not refetch on every focus event.');
    await modal.getByRole('button', { name: 'Save changes', exact: true }).click();
    await modal.waitFor({ state: 'hidden' });
    assert.equal(write.action, 'lead.update');
    assert.equal(write.payload.id, 'PERF-0');
    const oldRead = page.waitForResponse(response => response.url() === base + '/api/crm' && response.request().method() === 'GET');
    release(); await (await oldRead).finished(); await page.waitForTimeout(200);
    await page.getByText(edited.leads[0].notes, { exact: true }).waitFor();
    assert.deepEqual((await (await context.request.get(base + '/api/crm')).json()).leads, snapshot.leads);
    await context.close();
    console.log('Passed: server-rendered records after access verification, Inbox load-more/search, next schedule explanation, coalesced reads, photo caching, and stale-read protection.');
  }
  apiTimes.sort((a,b) => a-b);
  const report = { label, production: true, syntheticInquiries: count, cpuSlowdown: 4,
    network: slowNetwork ? 'browser: 1.6 Mbps down / 750 Kbps up / 100ms latency; local mock authentication' : 'local; mock authentication; no WAN latency simulation',
    apiP50Ms: Math.round(apiTimes[9]), apiP95Ms: Math.round(apiTimes[18]), results };
  writeFileSync(path.join(output, `${label}.json`), JSON.stringify(report, null, 2));
  console.log(`Passed: production pages, access protection, desktop/mobile; API p50 ${report.apiP50Ms}ms / p95 ${report.apiP95Ms}ms. No real records, external requests or email sends.`);
} finally {
  await browser?.close(); stop(server); await auth.close(); log.end();
}
