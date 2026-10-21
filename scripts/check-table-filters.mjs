import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { chromium } from '../.local-tools/browser-testing/node_modules/playwright-core/index.mjs';
import { startSupabaseMock } from './qa/supabase-mock.mjs';
import { waitForWorkspaceNavigation, expandAdvancedFilters, recordFilterControl } from './qa/workspace-page.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)), app = path.join(root, 'templates/leads');
const output = path.join(root, '.local-preview/table-filters'); mkdirSync(output, { recursive: true });
const base = 'http://127.0.0.1:3002', auth = await startSupabaseMock();
const log = createWriteStream(path.join(output, 'server.log'));
const server = spawn(process.execPath, [path.join(app, 'node_modules/next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '3002'], {
  cwd: app, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
    CRM_NEXT_DIST_DIR: '.next-qa', CRM_STORAGE_BACKEND: "local", SUPABASE_SECRET_KEY: "", CRM_DATA_DIR: path.join(output, `qa-${randomUUID()}`), N8N_WEBHOOK_SECRET: randomUUID(),
    NEXT_PUBLIC_SUPABASE_URL: auth.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: auth.key,
    GEMINI_ASSISTANT_API_KEY: '', GEMINI_ASSISTANT_CONFIG_FILE: path.join(output, 'not-configured.json') },
});
server.stdout.pipe(log); server.stderr.pipe(log);
let browser, qaPage;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(base + '/login', { signal: AbortSignal.timeout(3000) })).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert(ready, 'Isolated QA server did not start');
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = [], writes = [];
  qaPage = page;
  waitForWorkspaceNavigation(page);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/login');
  await page.getByLabel('Email address', { exact: true }).fill(auth.owner.email);
  await page.getByLabel('Password', { exact: true }).fill(auth.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Your business, at a glance', exact: true }).waitFor();
  const storedBefore = await (await context.request.get(base + '/api/crm')).json();
  const view = structuredClone(storedBefore), now = Date.now();
  const priorities = ['Low', 'Normal', 'High', 'Urgent'], stages = ['New', 'Pending', 'Contacted', 'Qualified', 'Won', 'Lost', 'Closed'];
  const states = ['Pending', 'Reserved', 'Sent', 'Skipped', 'Needs Review'];
  const lead = i => ({
    id: `sort-${i}`, name: `Customer ${String(i + 1).padStart(2, '0')}`, email: `sort-${i}@example.com`, phone: `+1555000${String(i).padStart(4, '0')}`,
    service: `Service ${i % 7 + 1}`, message: 'An isolated customer inquiry for filter testing.', source: i % 2 ? 'Email' : 'Form',
    status: stages[i % stages.length], priority: priorities[i % priorities.length], category: 'plumbing', summary: 'Filter QA', owner: i % 2 ? 'Owner B' : 'Owner A', notes: '',
    consent: i % 2 === 0, createdAt: new Date(now - (i + 1) * 3600000).toISOString(), updatedAt: new Date(now).toISOString(),
    followUpDue: i % 5 ? new Date(now + (i - 10) * 3600000).toISOString() : '', followUpState: states[i % states.length], followUpSentAt: '',
    acknowledgementStatus: '', ownerAlertStatus: '', isSample: false,
  });
  const originals = Array.from({ length: 27 }, (_, i) => lead(i));
  originals[0].service = 'Request for an inspection of a leaking bathroom tap and an estimate for replacing the worn fittings';
  originals[0].message = 'There has been an ongoing leak overnight and we need help inspecting the fittings. '.repeat(12);
  originals[0].summary = 'Customer requests a bathroom tap inspection and a replacement estimate.';
  originals[26].message = 'Please inspect the outside water line and advise us on the available repairs. '.repeat(10);
  originals[26].summary = 'Customer needs a full inspection of the outside pipe and a written estimate.';
  view.leads = [...originals].reverse();
  for (let i = 0; i < 12; i++) view.leads.push({ ...originals[i === 11 ? 1 : 0], id: `repeat-${i}`, owner: `Office ${i + 1}`, createdAt: new Date(now - (60 + i) * 3600000).toISOString() });
  view.drafts = originals.map((l, i) => ({ id: `reply-${i}`, leadId: l.id, subject: `Reply ${String(i + 1).padStart(2, '0')}`, body: 'An isolated suggested reply. No mail is sent by this check.', status: ['Pending review', 'Approved', 'Rejected'][i % 3], provider: 'Gemini', reason: '', createdAt: l.createdAt, updatedAt: l.createdAt })).reverse();
  view.mailJobs = originals.map((l, i) => ({ id: `mail-${i}`, draftId: `reply-${i}`, leadId: l.id, to: l.email, subject: `Outgoing ${String(i + 1).padStart(2, '0')}`, body: 'An isolated outgoing email preview.', gmailDraftId: '', gmailThreadId: '', senderEmail: 'owner@example.com', status: ['Queued', 'Sending', 'Sent', 'Needs Review', 'Cancelled'][i % 5], detail: 'Simulated result only.', executionId: '', createdAt: l.createdAt, updatedAt: l.createdAt, sentAt: i % 5 === 2 ? l.createdAt : '', gmailMessageId: '' })).reverse();
  const singaporeDay = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  view.tasks = Array.from({ length: 21 }, (_, i) => ({ id: `task-${i}`, title: `Task ${String(i + 1).padStart(2, '0')}`, leadId: originals[i].id, dueAt: new Date(`${singaporeDay}T09:${String(i).padStart(2, '0')}:00+08:00`).toISOString(), completed: i % 3 === 0, createdAt: originals[i].createdAt })).reverse();
  view.activities = Array.from({ length: 34 }, (_, i) => ({ id: `activity-${i}`, type: ['lead', 'draft', 'followup', 'task', 'settings', 'automation'][i % 6], title: `Activity ${String(i + 1).padStart(2, '0')}`, detail: `Test detail ${i}`, createdAt: new Date(now - i * 60000).toISOString(), status: ['running', 'success', 'failed', 'skipped', undefined][i % 5] })).reverse();
  view.syncChanges = Array.from({ length: 21 }, (_, i) => ({ id: `change-${i}`, kind: 'lead.upsert', entityId: originals[i].id, leadId: originals[i].id, label: 'Lead update', payload: {}, fields: ['notes'], intent: 'lead.update', status: ['Pending', 'Applied', 'Failed'][i % 3], detail: '', createdAt: originals[i].createdAt, updatedAt: originals[i].createdAt })).reverse();
  const fixtureBefore = structuredClone(view);
  await context.route('**/api/crm', route => {
    if (route.request().method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(view) });
    writes.push(route.request().postData());
    return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Read-only filter check.' }) });
  });
  async function navigate(route, expanded = true) {
    await page.goto(base + route);
    const advanced = page.getByRole('button', { name: 'Advanced filters', exact: true });
    await advanced.waitFor();
    assert.equal(await advanced.getAttribute('aria-expanded'), 'false', 'Advanced controls start collapsed');
    const toolbar = page.getByRole('group', { name: 'Filters and sorting', exact: true });
    assert.equal(await toolbar.locator('select:visible').count(), 0, 'Everyday view keeps extra filters and sort menus hidden');
    assert(await toolbar.locator('input').isVisible(), 'Search stays visible');
    if (expanded) await expandAdvancedFilters(page);
  }
  const control = label => recordFilterControl(page, label);
  async function clear() {
    const reset = page.getByRole('button', { name: 'Clear filters', exact: true });
    if (!await reset.isVisible()) await expandAdvancedFilters(page);
    await reset.click();
    if (new URL(page.url()).pathname === '/follow-ups') {
      await page.waitForURL(url => !url.searchParams.has('state'));
      await page.waitForFunction(() => document.querySelector('select[aria-label="Follow-up state"]')?.value === 'all');
    }
  }
  const rowIds = () => page.locator('[data-record-id]:visible').evaluateAll(rows => rows.map(row => row.getAttribute('data-record-id')));
  async function idsMatch(expected) {
    await page.waitForFunction(ids => JSON.stringify([...document.querySelectorAll('[data-record-id]')].filter(row => row.getClientRects().length).map(row => row.getAttribute('data-record-id'))) === JSON.stringify(ids), expected);
    assert.deepEqual(await rowIds(), expected);
  }
  async function tableIds(count, size = 10) {
    const ids = [];
    for (let i = 0; i < Math.max(1, Math.ceil(count / size)); i++) {
      await page.getByText(`Page ${i + 1} of ${Math.max(1, Math.ceil(count / size))}`, { exact: true }).waitFor();
      const previous = ids.slice();
      await page.waitForFunction(({ previous, length }) => {
        const rows = [...document.querySelectorAll('tbody [data-record-id]')];
        return rows.length === length && rows.every(row => !previous.includes(row.getAttribute('data-record-id')));
      }, { previous, length: Math.min(size, Math.max(0, count - i * size)) });
      ids.push(...await rowIds());
      if (i + 1 < Math.ceil(count / size)) await page.getByRole('button', { name: 'Next page', exact: true }).click();
    }
    return ids;
  }
  const compare = (a, b) => typeof a === 'number' || typeof a === 'boolean' ? Number(a) - Number(b) : String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
  function assertOrdered(ids, records, value, direction) {
    let foundMissing = false, previous;
    for (const id of ids) {
      const v = value(records.find(row => (row.id || row.email) === id));
      if (v === '' || v == null || (typeof v === 'number' && !Number.isFinite(v))) { foundMissing = true; continue; }
      assert(!foundMissing, 'Empty values must be last in either direction');
      if (previous != null) assert(compare(previous, v) * (direction === 'asc' ? 1 : -1) <= 0, `Wrong ${direction} order: ${previous} then ${v}`);
      previous = v;
    }
  }
  async function tableSorts(specs, records) {
    for (const [label, key, value, first = 'asc'] of specs) {
      const heading = page.getByRole('columnheader').filter({ has: page.getByRole('button', { name: `Sort by ${label}`, exact: true }) });
      const hasHeading = await heading.count() > 0;
      const initialDirection = hasHeading && await control('Sort by').inputValue() === key ? (await heading.getAttribute('aria-sort') === 'ascending' ? 'desc' : 'asc') : first;
      for (const direction of [initialDirection, initialDirection === 'asc' ? 'desc' : 'asc']) {
        if (hasHeading) await page.getByRole('button', { name: `Sort by ${label}`, exact: true }).click();
        else {
          await control('Sort by').selectOption(key);
          if (direction !== first) await page.getByRole('button', { name: /^Sort direction:/ }).click();
        }
        assert.equal(await control('Sort by').inputValue(), key);
        if (hasHeading) assert.equal(await page.getByRole('columnheader').filter({ has: page.getByRole('button', { name: `Sort by ${label}`, exact: true }) }).getAttribute('aria-sort'), direction === 'asc' ? 'ascending' : 'descending');
        const ids = await tableIds(records.length);
        assert.equal(new Set(ids).size, records.length);
        assertOrdered(ids, records, value, direction);
      }
    }
  }

  await navigate('/leads');
  await page.locator('tbody [data-record-id]').first().waitFor();
  await tableSorts([
    ['Lead name', 'name', l => l.name], ['Email', 'email', l => l.email], ['Inquiry', 'service', l => l.service], ['Status', 'status', l => l.status],
    ['Priority', 'priority', l => priorities.indexOf(l.priority), 'desc'], ['Source', 'source', l => l.source], ['Owner', 'owner', l => l.owner], ['Date', 'createdAt', l => Date.parse(l.createdAt), 'desc'],
  ], view.leads);
  await clear();
  await control('Filter priority').selectOption('Urgent');
  await control('Filter status').selectOption('New');
  await idsMatch(view.leads.filter(l => l.priority === 'Urgent' && l.status === 'New').sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map(l => l.id));
  await clear(); await control('Filter leads').fill('no such customer'); await idsMatch([]); await clear();
  await page.getByRole('button', { name: 'Advanced filters', exact: true }).click();
  assert.deepEqual(await page.locator('thead button').allTextContents(), ['Lead name', 'Inquiry', 'Status', 'Priority', 'Date']);
  const longInquiry = page.locator('[data-record-id="sort-0"] [data-inquiry-preview]');
  await longInquiry.getByText(originals[0].summary, { exact: true }).waitFor();
  assert.equal(await longInquiry.getByText('AI summary', { exact: true }).count(), 1);
  assert.equal(await longInquiry.locator('p').first().textContent(), originals[0].service);
  assert(await longInquiry.locator('p').first().evaluate(p => getComputedStyle(p).whiteSpace === 'normal' && p.scrollWidth <= p.clientWidth + 1));
  await page.getByRole('group', { name: 'Filters and sorting', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'leads-desktop.png'), fullPage: true });
  await control('Filter leads').fill('written estimate'); await idsMatch(['sort-26']);
  await page.getByRole('link', { name: 'Read inquiry from Customer 27', exact: true }).click();
  await page.getByRole('heading', { name: 'Customer inquiry', exact: true }).waitFor();
  await page.getByText(originals[26].message, { exact: true }).waitFor();
  await page.getByText('Source', { exact: true }).waitFor();
  await page.getByText('Assigned to', { exact: true }).waitFor();
  await navigate('/leads');
  await control('Filter priority').selectOption('Urgent');
  await control('Filter leads').fill('Customer 27'); await idsMatch([]);
  await page.getByRole('button', { name: 'Advanced filters', exact: true }).click();
  assert(await page.getByRole('button', { name: 'Remove Priority filter', exact: true }).isVisible());
  await page.getByRole('button', { name: 'Remove Priority filter', exact: true }).click(); await idsMatch(['sort-26']);
  assert.equal(await control('Filter leads').inputValue(), 'Customer 27');
  await page.waitForURL(url => url.searchParams.get('q') === 'Customer 27' && !url.searchParams.has('priority'));
  await page.reload();
  await idsMatch(['sort-26']);
  assert.equal(await control('Filter leads').inputValue(), 'Customer 27', 'Removing a linked filter preserves search after refresh');
  assert.equal(await control('Filter priority').inputValue(), 'all', 'Removed URL filters do not return after refresh');
  assert.equal(await control('Filter priority').isVisible(), false, 'Removing an applied filter keeps the extra controls closed');
  await navigate('/leads?priority=Urgent&q=Customer', false);
  await page.getByRole('button', { name: 'Remove Priority filter', exact: true }).click();
  await page.waitForURL(url => !url.searchParams.has('priority'));
  assert.equal(await control('Filter leads').inputValue(), 'Customer');
  await page.reload();
  assert.equal(await control('Filter priority').inputValue(), 'all');
  await clear();
  await page.getByRole('button', { name: 'Sort by Priority', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Order filter', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Remove Order filter', exact: true }).click();
  assert.equal(await control('Sort by').inputValue(), 'createdAt');
  console.log('Passed: everyday columns, closed advanced filters, removable applied filters, saved AI summaries, summary search and full inquiries with secondary details.');
  console.log('Passed: every lead column sorts both ways across all pages; combined filters, empty results, clear and pagination reset.');

  await navigate('/follow-ups');
  await page.getByRole('button', { name: 'All records 39', exact: true }).waitFor();
  await tableSorts([
    ['Customer', 'name', l => l.name], ['Inquiry', 'service', l => l.service], ['Priority', 'priority', l => priorities.indexOf(l.priority), 'desc'], ['Consent', 'consent', l => l.consent],
    ['Lead status', 'status', l => l.status], ['Due time', 'due', l => l.followUpDue ? Date.parse(l.followUpDue) : null], ['Follow-up state', 'state', l => l.followUpState],
  ], view.leads);
  await clear();
  for (const [label, values, matches] of [
    ['Follow-up priority', priorities, (l, value) => l.priority === value],
    ['Follow-up lead status', stages, (l, value) => l.status === value],
    ['Follow-up consent', ['yes', 'no'], (l, value) => l.consent === (value === 'yes')],
  ]) {
    for (const value of values) {
      await control(label).selectOption(value);
      const expected = view.leads.filter(l => matches(l, value));
      await page.getByRole('status').filter({ hasText: new RegExp(`^${expected.length} matching record`) }).waitFor();
      assert.deepEqual((await tableIds(expected.length)).sort(), expected.map(l => l.id).sort(), `${label}: ${value}`);
    }
    await control(label).selectOption('all');
  }
  await control('Follow-up priority').selectOption('High'); await control('Follow-up consent').selectOption('yes');
  await control('Follow-up lead status').selectOption('New');
  const expectedFollow = view.leads.filter(l => l.priority === 'High' && l.consent && l.status === 'New');
  assert.deepEqual((await tableIds(expectedFollow.length)).sort(), expectedFollow.map(l => l.id).sort());
  assert.equal(await page.getByRole('button', { name: 'All records 39', exact: true }).count(), 1, 'Table column filters must not change workspace summary counts');
  await control('Follow-up state').selectOption('Sent'); await idsMatch([]); await clear();
  await page.waitForFunction(() => [...document.querySelectorAll('tbody td:nth-child(5)')].every(cell => {
    if (getComputedStyle(cell).whiteSpace !== 'normal') return false;
    return [...cell.querySelectorAll('p')].every(p => {
      const range = document.createRange(); range.selectNodeContents(p);
      return [...range.getClientRects()].every(rect => rect.right <= cell.getBoundingClientRect().right + 1);
    });
  }));
  await page.getByRole('button', { name: 'Advanced filters', exact: true }).click();
  await page.getByRole('group', { name: 'Filters and sorting', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'followups-desktop.png'), fullPage: true });
  await control('Search follow-ups').fill('Customer 27'); await idsMatch(['sort-26']);
  await page.getByRole('button', { name: "View Customer 27's follow-up", exact: true }).click();
  const detail = page.getByRole('dialog', { name: 'Follow-up details', exact: true });
  await detail.getByText('Read original inquiry', { exact: true }).click();
  await detail.getByText(originals[26].message, { exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/follow-ups');
  await detail.getByRole('button', { name: 'Close', exact: true }).click();
  await clear();
  console.log('Passed: every follow-up column, missing due dates, consent/priority/stage combinations and clear; summary counts remain independent.');

  await navigate('/contacts');
  await page.locator('tbody [data-record-id]').first().waitFor();
  const contacts = originals.map(l => ({ ...l, id: l.email, count: l.id === 'sort-0' ? 12 : l.id === 'sort-1' ? 2 : 1,
    open: !['Won', 'Lost', 'Closed'].includes(l.status) ? l.id === 'sort-0' ? 12 : l.id === 'sort-1' ? 2 : 1 : 0 }));
  await tableSorts([
    ['Customer', 'name', c => c.name], ['Email', 'email', c => c.email], ['Phone', 'phone', c => c.phone],
    ['Inquiries', 'count', c => c.count, 'desc'], ['Open inquiries', 'open', c => c.open, 'desc'], ['Last inquiry', 'service', c => c.service], ['Date', 'createdAt', c => Date.parse(c.createdAt), 'desc'],
  ], contacts);
  await clear();
  for (const value of ['open', 'closed']) {
    await control('Contact inquiries').selectOption(value);
    const expected = contacts.filter(c => value === 'open' ? c.open > 0 : !c.open);
    await page.getByText(`${expected.length} contacts`, { exact: true }).waitFor();
    assert.deepEqual((await tableIds(expected.length)).sort(), expected.map(c => c.id).sort());
  }
  await clear(); await control('Search contacts').fill('  CUSTOMER 27  '); await idsMatch(['sort-26@example.com']);
  console.log('Passed: all contact columns, numeric 12/2/1 counts, open inquiries and trimmed search.');

  await navigate('/tasks');
  for (const value of ['open', 'done', 'overdue', 'all']) {
    await control('Task filter').selectOption(value);
    const expected = view.tasks.filter(t => value === 'all' || (value === 'open' && !t.completed) || (value === 'done' && t.completed) || (value === 'overdue' && !t.completed && Date.parse(t.dueAt) < Date.now())).sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
    await idsMatch(expected.map(t => t.id));
  }
  await control('Task filter').selectOption('all'); await control('Sort by').selectOption('title');
  await idsMatch(Array.from({ length: 21 }, (_, i) => `task-${i}`));
  await page.getByRole('button', { name: 'Sort direction: A to Z', exact: true }).click();
  await idsMatch(Array.from({ length: 21 }, (_, i) => `task-${20 - i}`));
  await control('Task filter').selectOption('done'); await control('Search tasks').fill('Task 01'); await idsMatch(['task-0']);
  await clear(); assert.equal(await control('Task filter').inputValue(), 'all'); await idsMatch(Array.from({ length: 21 }, (_, i) => `task-${i}`));

  await navigate('/activity');
  for (const value of ['running', 'success', 'failed', 'skipped', 'none']) {
    await control('Activity result').selectOption(value);
    await idsMatch(view.activities.filter(a => value === 'none' ? !a.status : a.status === value).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map(a => a.id));
  }
  await control('Activity result').selectOption('all');
  await control('Activity type').selectOption('automation'); await control('Activity result').selectOption('success');
  const activityIds = view.activities.filter(a => a.type === 'automation' && a.status === 'success').sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map(a => a.id);
  await idsMatch(activityIds); await clear(); await control('Sort by').selectOption('title');
  assert.deepEqual(await tablelessPages(34, 15), Array.from({ length: 34 }, (_, i) => `activity-${i}`));
  await page.getByRole('button', { name: 'Sort direction: A to Z', exact: true }).click();
  assert.deepEqual(await tablelessPages(34, 15), Array.from({ length: 34 }, (_, i) => `activity-${33 - i}`));
  async function tablelessPages(count, size) {
    const ids = [];
    for (let i = 0; i < Math.ceil(count / size); i++) {
      await page.getByText(`Page ${i + 1} of ${Math.ceil(count / size)}`, { exact: true }).waitFor();
      await page.waitForFunction(previous => [...document.querySelectorAll('[data-record-id]')].every(row => !previous.includes(row.getAttribute('data-record-id'))), ids);
      ids.push(...await rowIds());
      if (i + 1 < Math.ceil(count / size)) await page.getByRole('button', { name: 'Next page', exact: true }).click();
    }
    return ids;
  }
  console.log('Passed: task status/search/order/reset and activity type/result/search/order across pages.');

  for (const [viewName, filterLabel, status, key, searchLabel, prefix] of [
    ['inquiries', 'Inquiry priority', 'Urgent', 'name', 'Search inquiries', 'sort'],
    ['replies', 'Filter draft status', 'Approved', 'customer', 'Search drafts', 'reply'],
    ['outgoing', 'Outgoing reply status', 'Sent', 'customer', 'Search outgoing emails', 'mail'],
  ]) {
    await navigate(`/inbox?view=${viewName}`);
    await control('Sort by').selectOption(key);
    const records = viewName === 'inquiries' ? view.leads : viewName === 'replies' ? view.drafts : view.mailJobs;
    const ids = records.map(r => r.id).sort((a, b) => Number(a.split('-').at(-1)) - Number(b.split('-').at(-1)));
    if (viewName === 'inquiries') {
      const actual = await rowIds(); assertOrdered(actual, view.leads, l => l.name, 'asc');
    } else await idsMatch(ids);
    const values = viewName === 'inquiries' ? priorities : viewName === 'replies' ? ['Pending review', 'Approved', 'Rejected'] : ['Queued', 'Sending', 'Sent', 'Needs Review', 'Cancelled'];
    for (const value of values) {
      await control(filterLabel).selectOption(value);
      const expected = records.filter(r => (viewName === 'inquiries' ? r.priority : r.status) === value);
      await page.waitForFunction(count => [...document.querySelectorAll('[data-record-id]')].filter(row => row.getClientRects().length).length === count, expected.length);
      assert.deepEqual((await rowIds()).sort(), expected.map(r => r.id).sort(), `${viewName}: ${value}`);
    }
    await control(filterLabel).selectOption(status);
    await control(searchLabel).fill('  CUSTOMER 08  ');
    await idsMatch(viewName === 'outgoing' ? ['mail-7'] : viewName === 'replies' ? ['reply-7'] : ['sort-7']);
    await clear(); assert.equal(await control(filterLabel).inputValue(), 'all');
    await control(searchLabel).fill('no such customer'); await idsMatch([]); await clear();
  }
  await navigate('/inbox');
  await control('Search inquiries').fill('Customer 27');
  await page.getByRole('tab', { name: /^AI replies/ }).click();
  await control('Search drafts').fill('Customer 08');
  await page.getByRole('tab', { name: 'Incoming inquiries', exact: true }).click();
  assert.equal(await control('Search inquiries').inputValue(), 'Customer 27'); await idsMatch(['sort-26']);
  console.log('Passed: all three inbox views filter, search, sort and clear; switching tabs retains each view’s controls.');

  await navigate('/automation');
  await control('Filter saved changes').selectOption('Failed'); await control('Search saved changes').fill('Customer 03'); await idsMatch(['change-2']);
  await clear(); await control('Sort by').selectOption('customer');
  assert.deepEqual(await tablelessPages(21, 10), Array.from({ length: 21 }, (_, i) => `change-${i}`));

  await navigate('/');
  await page.getByRole('button', { name: 'Sort by Lead name', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('select[aria-label="Sort by"]')?.value === 'name');
  await control('Search overview inquiries').fill('  CUSTOMER 27  '); await idsMatch(['sort-26']); await clear();
  await page.getByRole('button', { name: 'Sort by Priority', exact: true }).click();
  assert.equal(await control('Sort by').inputValue(), 'priority');
  assertOrdered(await rowIds(), view.leads, l => priorities.indexOf(l.priority), 'desc');
  assert((await rowIds()).every(id => view.leads.find(l => l.id === id).priority === 'Urgent'));

  await navigate('/calendar');
  await control('Calendar event type').selectOption('task'); await control('Search calendar').fill('Task 02'); await idsMatch(['task-1']);
  await control('Calendar event type').selectOption('followup'); await idsMatch([]); await clear();
  await control('Calendar event type').selectOption('task'); await control('Sort by').selectOption('title');
  const openTaskIds = view.tasks.filter(t => !t.completed).sort((a, b) => a.title.localeCompare(b.title)).map(t => t.id);
  await idsMatch(openTaskIds);
  console.log('Passed: saved changes, overview subset and calendar agenda use the same functioning controls.');

  await navigate('/leads?status=New&status=Pending&priority=High&priority=Urgent&q=Customer', false);
  assert.equal(await control('Filter status').inputValue(), 'New');
  assert.equal(await control('Filter priority').inputValue(), 'High');
  const legacyExpected = view.leads.filter(l => l.status === 'New' && l.priority === 'High').sort((a,b) => Date.parse(b.createdAt)-Date.parse(a.createdAt));
  await idsMatch(legacyExpected.map(l => l.id));
  await page.getByRole('button', { name: 'Remove Priority filter', exact: true }).click();
  await page.waitForURL(url => !url.searchParams.has('priority') && url.searchParams.getAll('status').length === 1);
  await page.reload();
  assert.equal(await control('Filter status').inputValue(), 'New');
  assert.equal(await control('Filter priority').inputValue(), 'all');
  await navigate('/follow-ups?state=Pending&state=Sent');
  assert.equal(await control('Follow-up state').inputValue(), 'Pending');
  const legacyFollow = view.leads.filter(l => l.followUpState === 'Pending');
  assert.deepEqual((await tableIds(legacyFollow.length)).sort(), legacyFollow.map(l => l.id).sort());
  await control('Follow-up state').selectOption('Sent');
  await page.waitForURL(url => url.searchParams.getAll('state').length === 1 && url.searchParams.get('state') === 'Sent');
  await page.reload(); await expandAdvancedFilters(page);
  assert.equal(await control('Follow-up state').inputValue(), 'Sent');
  await page.screenshot({path:path.join(output,'single-followup-filters.png'),fullPage:true});
  console.log('Passed: old multi-value links use one visible choice; removing a linked filter preserves the remaining choice and search; follow-up changes persist one URL value.');

  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/', '/leads', '/follow-ups', '/contacts', '/tasks', '/activity', '/inbox', '/inbox?view=replies', '/inbox?view=outgoing', '/calendar', '/automation']) {
      await navigate(route, false);
      await expandAdvancedFilters(page);
      await control('Sort by').waitFor();
      const toolbar = page.getByRole('group', { name: 'Filters and sorting', exact: true });
      assert(await toolbar.locator('select').count() > 0, 'Single-selection dropdowns are present');
      assert(await toolbar.locator('select').evaluateAll(selects => selects.every(select => !select.multiple)), 'Every filter and sort accepts one choice');
      assert.equal(await toolbar.locator('input[type="checkbox"],input[type="radio"],button[data-filter-values]').count(), 0, 'No checkbox or check-mark menus in the filters');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Single filters fit the viewport');
      await page.getByRole('button', { name: 'Advanced filters', exact: true }).click();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${route} overflows at ${width}px`);
      assert.equal(await control('Sort by').isVisible(), false);
      if (width === 390 && ['/leads', '/follow-ups', '/inbox', '/contacts'].includes(route)) {
        await page.getByRole('group', { name: 'Filters and sorting', exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, `${route.slice(1)}-mobile.png`), fullPage: true });
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await navigate('/follow-ups', false);
  await page.screenshot({ path: path.join(output, 'followups-dark.png'), fullPage: true });
  await navigate('/leads');
  await control('Filter priority').selectOption('High');
  await page.screenshot({path:path.join(output,'single-filters-dark.png'),fullPage:true});
  assert.deepEqual(errors, []); assert.deepEqual(writes, []); assert.deepEqual(view, fixtureBefore);
  const storedAfter = await (await context.request.get(base + '/api/crm')).json();
  assert.deepEqual(storedAfter.leads, storedBefore.leads); assert.deepEqual(storedAfter.settings, storedBefore.settings); assert.deepEqual(storedAfter.mailJobs, storedBefore.mailJobs);
  console.log('Passed: 390px/768px layouts on every record page, dark mode, no runtime errors, no record writes and no email sends.');
} catch (error) {
  await qaPage?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  if (browser) await browser.close();
  try { execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { server.kill(); }
  await auth.close(); log.end();
}
