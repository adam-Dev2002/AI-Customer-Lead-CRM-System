// Isolated public-page/access checks. Never touches hosted services or live data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startTenantSupabase } from './qa/tenant-supabase.mjs';

const root = process.cwd(), app = path.join(root, 'templates/leads'), output = path.join(root, '.local-preview/public-pages');
mkdirSync(output, { recursive: true });
const { chromium } = createRequire(path.join(root, '.local-tools/browser-testing/package.json'))('playwright-core');
const service = await startTenantSupabase(), port = 3025, base = `http://127.0.0.1:${port}`;
const entry = path.join(output, 'next-server.cjs');
writeFileSync(entry, `const next=require(${JSON.stringify(path.join(app, 'node_modules/next'))});const http=require('node:http');const app=next({dev:true,webpack:true,dir:${JSON.stringify(app)},hostname:'127.0.0.1',port:${port}});app.prepare().then(()=>http.createServer(app.getRequestHandler()).listen(${port},'127.0.0.1'));`);
const log = createWriteStream(path.join(output, 'server.log'));
const server = spawn(process.execPath, [entry], { cwd: app, windowsHide: true, env: {
  ...process.env, CRM_NEXT_DIST_DIR: '.next-public-qa', CRM_DATA_DIR: path.join(output, 'isolated-data-' + randomUUID()),
  CRM_STORAGE_BACKEND: 'supabase', NEXT_PUBLIC_SUPABASE_URL: service.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: service.key,
  SUPABASE_SECRET_KEY: service.secret, SUPABASE_URL: service.url, CRM_GOOGLE_CONNECTIONS_ENABLED: 'false', N8N_WEBHOOK_SECRET: randomUUID(),
  CRM_PUBLIC_OPERATOR_NAME: '', CRM_PUBLIC_SUPPORT_EMAIL: '', GEMINI_ASSISTANT_API_KEY: '',
}, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.pipe(log); server.stderr.pipe(log);
let browser;
const pages = [
  { route: '/about', heading: 'A clearer view of every customer conversation.', title: 'Customer inquiries, replies and follow-ups' },
  { route: '/privacy', heading: 'Privacy policy', title: 'Privacy policy' },
  { route: '/terms', heading: 'Terms of service', title: 'Terms of service' },
];
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base + '/about', { signal: AbortSignal.timeout(3000) })).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert(ready, 'Public-page QA server did not become ready.');
  const calls = service.calls.length;
  for (const item of pages) {
    const response = await fetch(base + item.route, { redirect: 'manual' });
    assert.equal(response.status, 200); const html = await response.text();
    assert.match(html, /CustomerLead CRM/); assert.match(html, /Public preview/);
    assert.match(html, /noindex/); assert.match(html, new RegExp(`rel="canonical" href="https://ai-customer-lead-crm-system-oyh1.vercel.app${item.route}"`));
    assert.doesNotMatch(html, /Existing ClearFlow|sb_secret_tenant_isolated_qa/);
  }
  assert.equal(service.calls.length, calls, 'Public pages must not read auth, private branding or a workspace.');
  for (const route of ['/', '/inbox', '/settings', '/connections', '/privacy/private', '/terms/admin']) {
    const response = await fetch(base + route, { redirect: 'manual' });
    assert.equal(response.status, 307, route); assert.equal(new URL(response.headers.get('location'), base).pathname, '/login');
  }
  assert.equal((await fetch(base + '/api/crm')).status, 401);
  assert.equal((await fetch(base + '/api/connections/google')).status, 401);

  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  for (const item of pages) {
    await page.goto(base + item.route); await page.getByRole('heading', { name: item.heading, exact: true }).waitFor();
    assert.match(await page.title(), new RegExp(item.title.replaceAll('.', '\\.')));
    const header = page.getByRole('navigation', { name: 'Public pages', exact: true });
    for (const target of pages) assert.equal(await header.locator(`a[href="${target.route}"]`).count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: path.join(output, item.route.slice(1) + '-desktop.png'), fullPage: true });
  }
  await page.goto(base + '/privacy'); await page.getByRole('navigation', { name: 'On this page' }).getByRole('link', { name: /Why Google access/ }).click();
  await page.waitForFunction(() => window.location.hash === '#google-access' && window.scrollY > 100);
  await page.goto(base + '/about'); await page.getByRole('button', { name: 'Toggle theme' }).click();
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await page.screenshot({ path: path.join(output, 'about-dark.png'), fullPage: true });
  await page.getByRole('navigation', { name: 'Public pages', exact: true }).getByRole('link', { name: 'Privacy policy', exact: true }).click();
  await page.getByRole('heading', { name: 'Privacy policy', exact: true }).waitFor();
  assert.equal(await page.locator('html').evaluate(element => element.classList.contains('dark')), true);
  await page.screenshot({ path: path.join(output, 'privacy-dark.png'), fullPage: false });

  await page.goto(base + '/login');
  await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor();
  assert.equal(await page.getByRole('navigation', { name: 'Product information' }).locator('a').count(), 3);
  await page.screenshot({ path: path.join(output, 'login-links.png'), fullPage: true });
  assert.equal((await context.request.post(base + '/api/auth', { headers: { Origin: base }, data: { action: 'login', email: service.auth.owner.email, password: service.auth.password } })).status(), 200);
  const signedInCalls = service.calls.length;
  for (const item of pages) {
    await page.goto(base + item.route); await page.getByRole('heading', { name: item.heading, exact: true }).waitFor();
    assert.doesNotMatch(await page.locator('body').innerText(), /Existing ClearFlow|QA Owner/);
    assert.doesNotMatch(await page.title(), /ClearFlow/);
  }
  assert.equal(service.calls.length, signedInCalls, 'A signed-in public visitor must not load private workspace metadata.');
  await page.goto(base + '/settings'); await page.getByRole('heading', { name: 'Workspace settings', exact: true }).waitFor();
  assert.match(await page.title(), /Existing ClearFlow/);
  assert.equal(await page.getByRole('navigation', { name: 'Product information' }).locator('a').count(), 3);
  await context.close();

  const mobile = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce', isMobile: true, deviceScaleFactor: 1 });
  const phone = await mobile.newPage();
  phone.on('pageerror', error => errors.push(error.message));
  for (const item of pages) {
    await phone.goto(base + item.route); await phone.getByRole('heading', { name: item.heading, exact: true }).waitFor();
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Mobile overflow on ' + item.route);
    await phone.screenshot({ path: path.join(output, item.route.slice(1) + '-mobile.png'), fullPage: true });
    await phone.screenshot({ path: path.join(output, item.route.slice(1) + '-mobile-top.png'), fullPage: false });
  }
  await phone.getByRole('button', { name: 'Toggle theme' }).click();
  await phone.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await phone.screenshot({ path: path.join(output, 'terms-mobile-dark.png'), fullPage: false });
  await mobile.close(); assert.deepEqual(errors, []);
  console.log('Public-page QA passed: anonymous and signed-in public access without private reads; protected pages/APIs; metadata; shared links; policy navigation; desktop/mobile light/dark.');
} finally {
  if (browser) await browser.close();
  server.kill(); await service.close(); log.end();
}
