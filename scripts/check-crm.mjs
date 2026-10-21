import { chromium } from "../.local-tools/browser-testing/node_modules/playwright-core/index.mjs";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { startSupabaseMock } from "./qa/supabase-mock.mjs";
import { waitForWorkspaceNavigation, expandAdvancedFilters, recordFilterControl } from "./qa/workspace-page.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const app = path.join(root, "templates/leads"),
  output = path.join(root, ".local-preview");
mkdirSync(output, { recursive: true });
const token = randomBytes(32).toString("hex"),
  base = "http://127.0.0.1:3002";
const cloudMode = process.env.CRM_QA_CLOUD === "1";
const supabase = cloudMode ? await (await import("./qa/cloud-supabase.mjs")).startCloudSupabase() : await startSupabaseMock();
if (cloudMode) {
  const { createSeed } = await import("../templates/leads/lib/crm/seed.ts");
  const response = await fetch(supabase.url + "/rest/v1/rpc/crm_store_import", { method: "POST", headers: { apikey: supabase.secret, "Content-Type": "application/json" }, body: JSON.stringify({ p_data: createSeed() }) });
  assert.equal(response.status, 200);
}
let ownerCookie = "";
const qaFetch = (url, options = {}) => {
  const headers = new Headers(options.headers);
  if (String(url).startsWith(base + "/api/crm") && ownerCookie) {
    headers.set("Cookie", ownerCookie);
    if (!headers.has("Origin")) headers.set("Origin", base);
  }
  return fetch(url, { ...options, headers });
};
const log = createWriteStream(path.join(output, "crm-qa-server.log"));
const server = spawn(
  process.execPath,
  [
    path.join(app, "node_modules/next/dist/bin/next"),
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3002",
  ],
  {
    cwd: app,
    windowsHide: true,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      CRM_NEXT_DIST_DIR: ".next-qa",
      CRM_DATA_DIR: path.join(output, `qa-data-${randomUUID()}`),
      CRM_STORAGE_BACKEND: cloudMode ? "supabase" : "local",
      SUPABASE_SECRET_KEY: cloudMode ? supabase.secret : "",
      N8N_WEBHOOK_SECRET: token,
      NEXT_PUBLIC_SUPABASE_URL: supabase.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabase.key,
      GEMINI_ASSISTANT_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
server.stdout.pipe(log);
server.stderr.pipe(log);
let browser, qaPage;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function state() {
  const r = await qaFetch(`${base}/api/crm`);
  assert.equal(r.status, 200);
  return r.json();
}
async function expectReplyTab(page) {
  await page.waitForURL(url => url.pathname === "/inbox" && url.searchParams.get("view") === "replies");
  await page.getByRole("tabpanel", { name: /^AI replies/ }).waitFor();
  assert.equal(await page.getByRole("tab", { name: /^AI replies/ }).getAttribute("aria-selected"), "true");
}
try {
  let ready = false;
  for (let i = 0; i < 45; i++) {
    try {
      const r = await fetch(`${base}/login`, {
        signal: AbortSignal.timeout(3000),
      });
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    if (server.exitCode !== null)
      throw new Error("QA server exited. See crm-qa-server.log.");
    await sleep(1000);
  }
  assert(ready, "QA server did not become ready.");
  browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage(),
    pageErrors = [];
  qaPage = page;
  waitForWorkspaceNavigation(page);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(base);
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Ask assistant", exact: true }).count(), 0);
  await page.getByLabel("Email address", { exact: true }).fill(supabase.owner.email);
  await page.getByLabel("Password", { exact: true }).fill(supabase.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("heading", { name: "Your business, at a glance" })
    .waitFor();
  ownerCookie = (await context.cookies(base)).map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
  assert(ownerCookie, "Real SSR client should store a QA session cookie.");
  await page.screenshot({
    path: path.join(output, "crm-dashboard-desktop.png"),
    fullPage: true,
  });
  for (const [href, title] of [
    ["/leads", "Your leads"],
    ["/inbox", "Customer inbox"],
    ["/follow-ups", "Follow-ups"],
    ["/tasks", "Tasks & reminders"],
    ["/calendar", "Your calendar"],
    ["/contacts", "Your contacts"],
    ["/activity", "Workspace activity"],
    ["/automation", "How it works"],
    ["/settings", "Workspace settings"],
    ["/help", "Your dashboard, explained"],
  ]) {
    await page.locator(`a[href="${href}"]`).first().click();
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, href);
  }
  console.log("Passed: all sidebar routes render through real navigation.");
  assert.equal(await page.getByRole("link", { name: "AI Drafts", exact: true }).count(), 0);
  const beforeInbox = await state(), firstReply = beforeInbox.drafts[0];
  assert(firstReply);
  const reviewFixture = structuredClone(beforeInbox);
  const secondReply = { ...firstReply, id: "QA-SECOND-REPLY", subject: "Second reply selection QA",
    body: "An older rejected reply for this same inquiry.", status: "Rejected" };
  reviewFixture.drafts.unshift(secondReply);
  const reviewRoute = route => route.fulfill({ json: reviewFixture });
  await page.route("**/api/crm", reviewRoute);
  await page.goto(`${base}/drafts?lead=${encodeURIComponent(firstReply.leadId)}&draft=${encodeURIComponent(firstReply.id)}`);
  await expectReplyTab(page);
  assert.equal(new URL(page.url()).searchParams.get("lead"), firstReply.leadId);
  assert.equal(new URL(page.url()).searchParams.get("draft"), firstReply.id);
  assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1);
  assert.equal(await page.getByLabel("Reply body", { exact: true }).inputValue(), firstReply.body);
  await page.locator("#inbox-panel-replies button").filter({ hasText: secondReply.subject }).click();
  await page.waitForURL(url => url.searchParams.get("draft") === secondReply.id);
  assert.equal(await page.getByLabel("Reply body", { exact: true }).inputValue(), secondReply.body);
  await page.locator("#inbox-panel-replies button").filter({ hasText: firstReply.subject }).click();
  await page.waitForURL(url => url.searchParams.get("draft") === firstReply.id);
  const editedReply = firstReply.body + "\nUnsaved tab-switch check.";
  await page.getByLabel("Reply body", { exact: true }).fill(editedReply);
  await page.getByRole("tab", { name: "Incoming inquiries", exact: true }).click();
  await page.getByRole("tabpanel", { name: "Incoming inquiries", exact: true }).waitFor();
  await page.getByLabel("Search inquiries", { exact: true }).fill("Olivia");
  await page.getByRole("tab", { name: /^AI replies/ }).click();
  await expectReplyTab(page);
  assert.equal(await page.getByLabel("Reply body", { exact: true }).inputValue(), editedReply);
  await page.getByRole("tab", { name: "Incoming inquiries", exact: true }).click();
  await page.getByRole("tabpanel", { name: "Incoming inquiries", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Search inquiries", { exact: true }).inputValue(), "Olivia");
  const incomingUrl = page.url();
  await page.getByRole("tab", { name: /^AI replies/ }).focus();
  await page.keyboard.press("End");
  await page.waitForURL(url => url.searchParams.get("view") === "outgoing");
  await page.reload();
  assert.equal(await page.getByRole("tab", { name: /^Outgoing emails/ }).getAttribute("aria-selected"), "true");
  assert.equal(await page.getByRole("tabpanel").count(), 1);
  await page.goBack();
  await page.waitForURL(incomingUrl);
  await page.goto(`${base}/inbox?view=invalid-view`);
  assert.equal(await page.getByRole("tab", { name: "Incoming inquiries", exact: true }).getAttribute("aria-selected"), "true");
  assert.deepEqual((await state()).drafts, beforeInbox.drafts);
  await page.unroute("**/api/crm", reviewRoute);
  console.log("Passed: combined Inbox tabs, legacy reply links, keyboard navigation, refresh/back state and unsaved edits retained across tabs. No messages sent.");
  assert.equal(await page.getByText("SAVED VIEWS", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("link", { name: "Leads", exact: true }).count(), 1);
  await page.goto(`${base}/leads`);
  await expandAdvancedFilters(page);
  await recordFilterControl(page, "Filter status").selectOption("New");
  assert((await page.locator("tbody tr").evaluateAll(rows => rows.map(row => row.children[3].textContent.trim()))).every(status => status === "New"));
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expandAdvancedFilters(page);
  await recordFilterControl(page, "Filter priority").selectOption("Urgent");
  assert((await page.locator("tbody tr").evaluateAll(rows => rows.map(row => row.children[4].textContent.trim()))).every(priority => priority === "Urgent"));
  await page.goto(`${base}/follow-ups?state=Pending`);
  await expandAdvancedFilters(page);
  await recordFilterControl(page, "Follow-up state").selectOption("Sent");
  await page.waitForURL(`${base}/follow-ups?state=Sent`);
  await page.reload();
  assert.equal(await recordFilterControl(page, "Follow-up state").inputValue(), "Sent");
  const beforeFilters = await state();
  const noAttention = structuredClone(beforeFilters);
  noAttention.leads.forEach(lead => { lead.followUpState = "Skipped"; });
  const attentionRoute = route => route.fulfill({ json: noAttention });
  await page.route("**/api/crm", attentionRoute);
  await page.goto(`${base}/follow-ups?state=attention`);
  await page.getByRole("heading", { name: "No follow-ups need attention", exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, "crm-followup-empty-filter.png"), fullPage: true });
  await page.getByRole("button", { name: "Show all follow-ups", exact: true }).click();
  await page.waitForURL(`${base}/follow-ups`);
  assert.equal(await recordFilterControl(page, "Follow-up state").inputValue(), "all");
  await page.getByLabel("Search follow-ups", { exact: true }).fill("no-such-qa-customer");
  await page.getByRole("button", { name: "Show all follow-ups", exact: true }).click();
  assert.equal(await page.getByLabel("Search follow-ups", { exact: true }).inputValue(), "");
  await page.reload();
  assert.equal(await recordFilterControl(page, "Follow-up state").inputValue(), "all");
  await page.goto(`${base}/follow-ups?state=unknown-filter`);
  assert.equal(await recordFilterControl(page, "Follow-up state").inputValue(), "all");
  assert.deepEqual((await state()).leads, beforeFilters.leads);
  await page.unroute("**/api/crm", attentionRoute);
  console.log("Passed: one Leads entry, in-page filters, persistent follow-up selection and empty-view recovery without mutations.");
  await page.goto(`${base}/leads`);
  await page.getByRole("button", { name: "Create new", exact: true }).click();
  let modal = page.getByRole("dialog");
  await modal.getByLabel("Full name", { exact: true }).fill("QA Customer");
  await modal
    .getByLabel("Email address", { exact: true })
    .fill("qa.customer@example.com");
  await modal
    .getByLabel("Service needed", { exact: true })
    .fill("Kitchen sink repair");
  await modal
    .getByLabel("Inquiry message", { exact: true })
    .fill("The kitchen sink is leaking. Please review the request.");
  assert.equal(await modal.getByRole("checkbox").count(), 0, "Permission is managed only in Follow-ups.");
  await modal.getByText("Not recorded", { exact: true }).waitFor();
  await modal.getByRole("button", { name: "Create lead", exact: true }).click();
  await modal.waitFor({ state: "hidden" });
  let snapshot = await state(),
    lead = snapshot.leads.find((l) => l.email === "qa.customer@example.com");
  assert(lead);
  assert.equal(lead.consent, false);
  assert.equal(lead.followUpState, "Skipped");
  await page.goto(`${base}/follow-ups?lead=${encodeURIComponent(lead.id)}`);
  modal = page.getByRole("dialog", { name: "Follow-up details", exact: true });
  await modal.getByLabel("I have the customer's permission for one follow-up email.", { exact: true }).check();
  await modal.getByRole("button", { name: "Save permission", exact: true }).click();
  await modal.getByText("Customer consented", { exact: true }).waitFor();
  const initialFollowupTime = new Date(Date.now() + 86400000);
  await modal.getByLabel("Follow-up date & time", { exact: true }).fill(new Date(initialFollowupTime.getTime() - initialFollowupTime.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  await modal.getByRole("button", { name: "Save schedule", exact: true }).click();
  await modal.getByText("Pending", { exact: true }).waitFor();
  await modal.getByRole("button", { name: "Close", exact: true }).click();
  await page.goto(`${base}/leads`);
  await page.reload();
  await page
    .getByRole("link", { name: /QA Customer/ })
    .first()
    .waitFor();
  await page
    .getByRole("button", { name: "Actions for QA Customer", exact: true })
    .click();
  await page.screenshot({ path: path.join(output, "crm-lead-actions-desktop.png"), fullPage: true });
  await page.getByRole("menuitem", { name: "Edit lead", exact: true }).click();
  modal = page.getByRole("dialog");
  assert.equal(await modal.getByRole("checkbox").count(), 0);
  await modal.getByText("Granted", { exact: true }).waitFor();
  await modal.getByLabel("Priority", { exact: true }).selectOption("Urgent");
  await modal.getByLabel("Assigned owner", { exact: true }).fill("QA Owner");
  await modal.getByRole("button", { name: "Save changes" }).click();
  await modal.waitFor({ state: "hidden" });
  snapshot = await state();
  lead = snapshot.leads.find((l) => l.id === lead.id);
  assert.equal(lead.priority, "Urgent");
  assert.equal(lead.owner, "QA Owner");
  assert.equal(lead.consent, true, "Editing ordinary lead fields must preserve recorded permission.");
  await page.goto(`${base}/inbox`);
  await page
    .getByRole("textbox", { name: "Search inquiries" })
    .fill("QA Customer");
  await page.getByRole("button", { name: "Create reply draft" }).click();
  await expectReplyTab(page);
  await page
    .getByLabel("Reply body", { exact: true })
    .fill(
      "Hi QA Customer,\n\nThank you for the inquiry. Please send your location and a photo of the leak so we can review it.\n\nKind regards,\nQA Owner",
    );
  await page
    .getByRole("button", { name: "Approve reply", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Reply approved locally" })
    .waitFor();
  snapshot = await state();
  assert.equal(
    snapshot.drafts.find((d) => d.leadId === lead.id).status,
    "Approved",
  );
  assert.equal(snapshot.leads.find((l) => l.id === lead.id).status, "New");
  assert.equal(snapshot.leads.find((l) => l.id === lead.id).followUpSentAt, "");
  console.log(
    "Passed: create/edit persistence, inquiry-to-draft flow, and approval without sending.",
  );
  await page.goto(`${base}/follow-ups?state=Pending`);
  await page.getByLabel("Search follow-ups", { exact: true }).fill("QA Customer");
  await page.getByRole("button", { name: "View QA Customer's follow-up", exact: true }).click();
  modal = page.getByRole("dialog", { name: "Follow-up details", exact: true });
  await modal.getByText("qa.customer@example.com", { exact: true }).first().waitFor();
  assert.equal(new URL(page.url()).pathname, "/follow-ups");
  assert.deepEqual((await state()).leads, snapshot.leads, "Viewing a follow-up must not change records.");
  await page.screenshot({ path: path.join(output, "crm-followup-actions-desktop.png"), fullPage: true });
  await modal.getByRole("button", { name: "Cancel follow-up", exact: true }).click();
  await modal.getByText("Skipped", { exact: true }).waitFor();
  assert.equal((await state()).leads.find(l => l.id === lead.id).followUpState, "Skipped");
  const future = new Date(Date.now() + 172800000);
  const local = new Date(future.getTime() - future.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  await modal.getByLabel("Follow-up date & time", { exact: true }).fill(local);
  await modal.getByRole("button", { name: "Save schedule" }).click();
  await modal.getByText("Pending", { exact: true }).waitFor();
  await modal.getByRole("button", { name: "Close", exact: true }).click();
  assert.equal(new URL(page.url()).pathname, "/follow-ups");
  assert.equal((await state()).leads.find(l => l.id === lead.id).followUpState, "Pending");
  assert.equal((await state()).mailJobs.length, 0);
  await page.goto(`${base}/leads/${lead.id}`);
  await page
    .getByRole("button", { name: "Mark as contacted", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Lead marked contacted" })
    .waitFor();
  snapshot = await state();
  assert.equal(
    snapshot.leads.find((l) => l.id === lead.id).followUpState,
    "Skipped",
  );
  await page.goto(`${base}/tasks`);
  await page.getByRole("button", { name: "New task", exact: true }).click();
  modal = page.getByRole("dialog");
  await modal
    .getByLabel("Task title", { exact: true })
    .fill("QA follow-up call");
  await modal.getByLabel("Related lead", { exact: true }).selectOption(lead.id);
  await modal.getByRole("button", { name: "Create task", exact: true }).click();
  await modal.waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Edit task QA follow-up call", exact: true })
    .click();
  modal = page.getByRole("dialog");
  await modal.getByLabel("Task title", { exact: true }).fill("QA revised call");
  await modal.getByRole("button", { name: "Save task", exact: true }).click();
  await modal.waitFor({ state: "hidden" });
  await page
    .getByRole("checkbox", { name: "Complete QA revised call", exact: true })
    .click();
  await page.getByRole("status").filter({ hasText: "Task updated" }).waitFor();
  assert.equal(
    (await state()).tasks.find((t) => t.title === "QA revised call").completed,
    true,
  );
  console.log(
    "Passed: follow-up scheduling/contact suppression and persisted task completion.",
  );
  await page.goto(`${base}/leads`);
  await page
    .getByLabel("Choose leads CSV")
    .setInputFiles({
      name: "test-leads.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        'Name,Email,Service,Message,Consent\r\nCSV Customer,csv.customer@example.com,"Drain, kitchen","Please inspect the kitchen drain.",No',
      ),
    });
  modal = page.getByRole("dialog");
  await modal
    .getByRole("button", { name: "Import 1 leads", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  const imported = (await state()).leads.find(
    (l) => l.email === "csv.customer@example.com",
  );
  assert(imported);
  assert.equal(imported.consent, false);
  assert.equal(imported.followUpState, "Skipped");
  await page
    .getByRole("button", { name: "Import / Export", exact: true })
    .click();
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /Export .* leads to CSV/ }).click();
  const exported = await pendingDownload;
  assert.equal(exported.suggestedFilename(), "customer-leads.csv");
  await page.goto(`${base}/settings`);
  await page.getByLabel("Business name", { exact: true }).fill("QA Plumbing");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Your preferences were saved" })
    .waitFor();
  await page.reload();
  await page.getByLabel("Business name", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Business name", { exact: true }).inputValue(),
    "QA Plumbing",
  );
  await page
    .getByRole("button", { name: "Remove sample data", exact: true })
    .click();
  modal = page.getByRole("dialog");
  await modal
    .getByRole("button", { name: "Remove sample data", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  snapshot = await state();
  assert.equal(snapshot.leads.length, 2);
  assert(snapshot.leads.every((l) => !l.isSample));
  console.log(
    "Passed: CSV import/export, settings persistence, and sample removal preserving own records.",
  );
  const event = {
    eventId: "qa-event-1",
    type: "lead.upsert",
    data: {
      Lead_ID: "N8N-QA-1",
      Name: "Webhook Customer",
      Email: "webhook.qa@example.com",
      Service: "Drain inspection",
      Message: "Please inspect a blocked drain.",
      Status: "New",
      Priority: "High",
      Consent: "Yes",
      Source: "n8n Form",
      Follow_Up_State: "Pending",
      Follow_Up_Due_UTC: new Date(Date.now() + 86400000).toISOString(),
    },
  };
  const sendEvent = (withAuth = true) =>
    fetch(`${base}/api/n8n/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(withAuth ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(event),
    });
  assert.equal((await sendEvent(false)).status, 401);
  assert.equal((await sendEvent()).status, 200);
  assert.equal((await (await sendEvent()).json()).duplicate, true);
  assert.equal(
    (await state()).leads.filter((l) => l.id === "N8N-QA-1").length,
    1,
  );
  const crossOrigin = await qaFetch(`${base}/api/crm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://unrelated.example",
    },
    body: JSON.stringify({ action: "samples.clear" }),
  });
  assert.equal(crossOrigin.status, 403);
  console.log(
    "Passed: authenticated n8n ingestion, duplicate protection, and cross-origin write rejection.",
  );
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  assert.equal((await fetch(`${base}/api/n8n/config`)).status, 401);
  assert.equal((await fetch(`${base}/api/n8n/sync`)).status, 401);
  const configResponse = await fetch(`${base}/api/n8n/config`, { headers: auth });
  assert.equal(configResponse.status, 200);
  const configBody = await configResponse.text();
  assert(!configBody.includes(token));
  assert.equal(JSON.parse(configBody).config.business_name, "QA Plumbing");
  const ownerEdit = await qaFetch(`${base}/api/crm`, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({action:"lead.update", payload:{id:"N8N-QA-1",notes:"Owner sync test"}}) });
  assert.equal(ownerEdit.status, 200);
  const poll = () => fetch(`${base}/api/n8n/sync`, {headers:auth}).then(r=>r.json());
  const polled = await poll();
  assert.equal(new Set(polled.changes.map(c=>c.entityId)).size, polled.changes.length);
  const change = polled.changes.find(c=>c.leadId === "N8N-QA-1");
  assert(change);
  assert.deepEqual(change.fields,["Notes"]);
  const stale = await fetch(`${base}/api/n8n/events`, {method:"POST",headers:auth,body:JSON.stringify({...event,eventId:"stale-row-test"})});
  assert.equal(stale.status,409);
  const confirm = (status) => fetch(`${base}/api/n8n/sync`, {method:"POST",headers:auth,body:JSON.stringify({changeId:change.id,status,detail:status === "Failed" ? "QA Sheets error" : "QA shared record updated",executionId:"QA-101"})});
  assert.equal((await confirm("Failed")).status,200);
  await page.goto(`${base}/automation`);
  await page.getByRole("heading",{name:"How it works",exact:true}).waitFor();
  await expandAdvancedFilters(page);
  await recordFilterControl(page, "Filter saved changes").selectOption("Failed");
  await page.getByText("This change could not be completed. Review the update or contact support if it keeps happening.",{exact:true}).first().waitFor();
  assert(!(await page.locator("body").innerText()).includes("QA Sheets error"));
  await page.getByRole("button",{name:"Retry update",exact:true}).click();
  await page.getByRole("status").filter({hasText:"Your saved change will be tried again"}).waitFor();
  assert((await poll()).changes.some(c=>c.id===change.id));
  assert.equal((await confirm("Applied")).status,200);
  assert.equal((await (await confirm("Applied")).json()).duplicate,true);
  assert.equal((await state()).syncChanges.find(c=>c.id===change.id).status,"Applied");
  await expandAdvancedFilters(page);
  await recordFilterControl(page, "Filter saved changes").selectOption("Applied");
  await page.getByRole("button",{name:"Refresh status",exact:true}).click();
  await page.getByText("Your changes were saved to the shared records.",{exact:true}).first().waitFor();
  await page.screenshot({path:path.join(output,"crm-automation-desktop.png"),fullPage:true});
  for (const asset of ["customerlead-sync-bridge.json","customerlead-event-adapters.json","connection-guide.md"]) {
    const assetResponse = await fetch(`${base}/integrations/${asset}`);
    assert.equal(assetResponse.status,200);
  }
  console.log("Passed: authenticated configuration, ordered write-back, conflict protection, failed/applied acknowledgements, frontend retry, and downloadable n8n kit.");
  // Delivery callbacks are simulated on this isolated server; no Gmail call runs.
  const mailRequest = body => fetch(`${base}/api/n8n/mail`, {method:"POST",headers:auth,body:JSON.stringify(body)});
  assert.equal((await fetch(`${base}/api/n8n/mail`, {method:"POST",headers:{"Content-Type":"application/json"},body:'{"action":"claim"}'})).status,401);
  const registration = await mailRequest({action:"claim",executionId:"QA-MAIL-REGISTER",senderEmail:"qa.owner@example.com"});
  assert.equal(registration.status,200);
  assert.equal((await registration.json()).job,null);
  const mailLeadId="QA-MAIL-LEAD", mailDraftId="QA-MAIL-DRAFT";
  const mailEvent={eventId:"qa-mail-inquiry",type:"support.processed",data:{Lead_ID:mailLeadId,Name:"QA Mail Customer",Email:"qa.mail@example.com",Service:"Email drain inquiry",Message:"Could you inspect the drain?",Source:"Gmail",Consent:"No",Status:"New",Gmail_Thread_ID:"qa-mail-thread",Draft_ID:mailDraftId,Gmail_Draft_ID:"qa-gmail-draft",Subject:"Re: Email drain inquiry",Body:"Thank you for contacting us. Please share your preferred inspection time."}};
  assert.equal((await fetch(`${base}/api/n8n/events`,{method:"POST",headers:auth,body:JSON.stringify(mailEvent)})).status,200);
  await page.goto(`${base}/inbox`);
  await expandAdvancedFilters(page);
  await recordFilterControl(page, "Inquiry source").selectOption("Gmail");
  await page.getByLabel("Search inquiries",{exact:true}).fill("QA Mail Customer");
  await page.getByRole("link",{name:"Review reply draft",exact:true}).click();
  await expectReplyTab(page);
  await page.getByRole("button",{name:"Approve reply",exact:true}).click();
  await page.getByRole("status").filter({hasText:"Reply approved locally"}).waitFor();
  assert.equal((await state()).mailJobs.length,0);
  await page.getByRole("button",{name:"Send via Gmail",exact:true}).click();
  modal=page.getByRole("dialog");
  await modal.getByText("qa.mail@example.com",{exact:true}).waitFor();
  await modal.getByRole("button",{name:"Cancel",exact:true}).click();
  await modal.waitFor({state:"hidden"});
  assert.equal((await state()).mailJobs.length,0);
  await page.getByRole("button",{name:"Send via Gmail",exact:true}).click();
  modal=page.getByRole("dialog");
  await modal.getByRole("button",{name:"Confirm and queue email",exact:true}).click();
  await modal.waitFor({state:"hidden"});
  await page.getByRole("tabpanel", { name: /^AI replies/ }).getByText("Queued",{exact:true}).waitFor();
  assert.equal(await page.getByLabel("Reply body",{exact:true}).isDisabled(),true);
  const mailJob=(await state()).mailJobs[0];
  assert.equal(mailJob.status,"Queued");
  assert.equal((await (await mailRequest({action:"claim",executionId:"QA-MAIL-WAIT",senderEmail:"qa.owner@example.com"})).json()).job,null);
  for(let pass=0;pass<5;pass++) {
    const pending=(await poll()).changes.filter(c=>c.leadId===mailLeadId);
    if(!pending.length)break;
    for(const reviewChange of pending) {
      const response=await fetch(`${base}/api/n8n/sync`,{method:"POST",headers:auth,body:JSON.stringify({changeId:reviewChange.id,status:"Applied",detail:"QA review sync",executionId:"QA-REVIEW"})});
      assert.equal(response.status,200);
    }
  }
  const claimed=(await (await mailRequest({action:"claim",executionId:"QA-MAIL-SEND",senderEmail:"qa.owner@example.com"})).json()).job;
  assert.equal(claimed.id,mailJob.id);
  assert.equal((await (await mailRequest({action:"claim",executionId:"QA-MAIL-SECOND",senderEmail:"qa.owner@example.com"})).json()).job,null);
  assert.equal((await mailRequest({action:"prepared",jobId:claimed.id,executionId:"QA-MAIL-SEND",gmailDraftId:"qa-gmail-draft"})).status,200);
  const mailResultBody={action:"result",jobId:claimed.id,executionId:"QA-MAIL-SEND",status:"Sent",gmailMessageId:"qa-sent-message",gmailThreadId:"qa-mail-thread"};
  assert.equal((await mailRequest(mailResultBody)).status,200);
  assert.equal((await (await mailRequest(mailResultBody)).json()).duplicate,true);
  await page.goto(`${base}/inbox`);
  await page.getByRole("tab",{name:/^Outgoing emails/}).click();
  await page.getByRole("heading",{name:"Re: Email drain inquiry",exact:true}).waitFor();
  assert.equal((await state()).mailJobs[0].status,"Sent");
  assert.equal((await state()).leads.find(l=>l.id===mailLeadId).status,"Contacted");
  await page.screenshot({path:path.join(output,"crm-outgoing-mail-desktop.png"),fullPage:true});
  for(const asset of ["customerlead-manual-gmail-sender.json","customerlead-email-nodes.json"]) assert.equal((await fetch(`${base}/integrations/${asset}`)).status,200);
  console.log("Passed: Gmail inquiry ingestion, manual send confirmation/cancel, ordered claiming, simulated delivery confirmation, duplicate protection, and outgoing email view. No Gmail delivery was performed.");
  // Concurrent follow-up claims use isolated API fixtures, never a live mailbox.
  assert.equal((await fetch(`${base}/api/n8n/followups`, {method:"POST",headers:{"Content-Type":"application/json"},body:'{"action":"claim"}'})).status,401);
  const followupLeadId="QA-FOLLOWUP-RACE", due=new Date(Date.now()-3600000).toISOString();
  const preferences=(await state()).settings;
  assert.equal((await qaFetch(`${base}/api/crm`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"settings.update",payload:{...preferences,automaticEmailsEnabled:true,customerFollowUps:true}})})).status,200);
  assert.equal((await fetch(`${base}/api/n8n/events`,{method:"POST",headers:auth,body:JSON.stringify({eventId:"qa-followup-race",type:"lead.upsert",data:{Lead_ID:followupLeadId,Name:"Follow-up API QA",Email:"followup.qa@example.com",Service:"Tap inspection",Message:"Please inspect the tap.",Consent:"Yes",Status:"New",Source:"n8n Form",Follow_Up_State:"Pending",Follow_Up_Due_UTC:due}})})).status,200);
  let reviewResponse=await qaFetch(`${base}/api/crm`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"followup.save",payload:{id:followupLeadId,revision:0,subject:"Follow-up QA",body:"Please let us know if you still need help with the tap."}})}); assert.equal(reviewResponse.status,200);
  const reviewedEmail=(await reviewResponse.json()).leads.find(item=>item.id===followupLeadId).followUpEmail;
  reviewResponse=await qaFetch(`${base}/api/crm`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"followup.approve",payload:{id:followupLeadId,revision:reviewedEmail.revision,subject:reviewedEmail.subject,body:reviewedEmail.body,email:"followup.qa@example.com",dueAt:due,confirmed:true}})});assert.equal(reviewResponse.status,200);
  const followupClaim=executionId=>fetch(`${base}/api/n8n/followups`,{method:"POST",headers:auth,body:JSON.stringify({action:"claim",leadId:followupLeadId,email:"followup.qa@example.com",followUpDue:due,executionId,capabilities:["approved-followups-v1"]})});
  const claims=await Promise.all(["QA-FOLLOWUP-A","QA-FOLLOWUP-B"].map(async executionId=>{
    const response=await followupClaim(executionId); assert.equal(response.status,200); return response.json();
  }));
  assert.equal(claims.filter(result=>result.claimed).length,1);
  assert.equal(claims.filter(result=>result.reason==="already_reserved").length,1);
  const winner=claims.find(result=>result.claimed).executionId;
  const reserved=(await state()).leads.find(item=>item.id===followupLeadId);
  assert.equal(reserved.followUpState,"Reserved");
  assert.equal(reserved.followUpExecutionId,winner);
  assert.equal((await (await followupClaim(winner)).json()).claimed,false);
  const followupResult=executionId=>fetch(`${base}/api/n8n/events`,{method:"POST",headers:auth,body:JSON.stringify({eventId:"qa-followup-result-"+executionId,type:"followup.updated",data:{Lead_ID:followupLeadId,Execution_ID:executionId,Follow_Up_State:"Sent",Follow_Up_Sent_UTC:new Date().toISOString()}})});
  assert.equal((await followupResult("QA-NONOWNER")).status,409);
  assert.equal((await followupResult(winner)).status,200);
  assert.equal((await state()).leads.find(item=>item.id===followupLeadId).followUpState,"Sent");
  console.log("Passed: authenticated atomic follow-up API race, persisted reservation, replay rejection and execution-owned simulated result. No follow-up email was sent.");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await page
    .getByRole("heading", { name: "Your business, at a glance" })
    .waitFor();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Page overflows mobile viewport.",
  );
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("link", { name: "Contacts", exact: true }).click();
  await drawer.waitFor({ state: "hidden" });
  await page.getByRole("heading", { name: "Your contacts" }).waitFor();
  await page.getByRole("button", { name: "Toggle theme", exact: true }).click();
  assert((await page.locator("html").getAttribute("class"))?.includes("dark"));
  await page.screenshot({
    path: path.join(output, "crm-contacts-mobile-dark.png"),
    fullPage: true,
  });
  await page.goto(`${base}/automation`);
  await page.getByRole("heading",{name:"How it works",exact:true}).waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth),"Automation page overflows the mobile viewport.");
  await page.screenshot({path:path.join(output,"crm-automation-mobile-dark.png"),fullPage:true});
  await page.goto(`${base}/inbox`);
  await page.getByRole("tab",{name:/^AI replies/}).click();
  await expectReplyTab(page);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth),"AI replies overflow the mobile viewport.");
  await page.screenshot({path:path.join(output,"crm-inbox-replies-mobile-dark.png"),fullPage:true});
  await page.getByRole("tab",{name:/^Outgoing emails/}).click();
  await page.getByRole("heading",{name:"Re: Email drain inquiry",exact:true}).waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth),"Outgoing emails overflow the mobile viewport.");
  await page.screenshot({path:path.join(output,"crm-outgoing-mail-mobile-dark.png"),fullPage:true});
  await page.goto(`${base}/follow-ups?lead=${followupLeadId}`);
  modal = page.getByRole("dialog", { name: "Follow-up details", exact: true });
  await modal.getByText("followup.qa@example.com", { exact: true }).first().waitFor();
  assert.equal(await modal.getByRole("button", { name: "Reschedule", exact: true }).count(), 0);
  assert.equal(await modal.getByRole("button", { name: "Cancel follow-up", exact: true }).count(), 0);
  assert(await modal.evaluate(element => element.scrollWidth <= element.clientWidth), "Follow-up detail overflows on mobile.");
  await page.screenshot({path:path.join(output,"crm-followup-actions-mobile-dark.png"),fullPage:true});
  await modal.getByRole("button", { name: "Close", exact: true }).click();
  assert.deepEqual(pageErrors, []);
  console.log(
    "Passed: mobile navigation, viewport fit, dark mode, and no browser runtime errors.",
  );
} catch (error) {
  if (qaPage) {
    await qaPage
      .screenshot({
        path: path.join(output, "crm-check-failure.png"),
        fullPage: true,
      })
      .catch(() => {});
    console.error(
      "Visible alerts:",
      await qaPage
        .locator('[role="alert"]')
        .allTextContents()
        .catch(() => []),
    );
  }
  throw error;
} finally {
  await browser?.close();
  if (server.pid) {
    if (process.platform === "win32") {
      try {
        execFileSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
      } catch {}
    } else server.kill("SIGTERM");
  }
  await supabase.close();
  log.end();
}
