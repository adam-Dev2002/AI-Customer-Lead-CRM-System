import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { chromium } from "../.local-tools/browser-testing/node_modules/playwright-core/index.mjs";
import { startSupabaseMock } from "./qa/supabase-mock.mjs";
import { checkFilterOptions } from "./qa/check-filter-options.mjs";
import { waitForWorkspaceNavigation } from "./qa/workspace-page.mjs";

const root = fileURLToPath(new URL("../", import.meta.url)), app = path.join(root, "templates/leads");
const output = path.join(root, ".local-preview/followup-review"); mkdirSync(output, { recursive: true });
const base = "http://127.0.0.1:3002", token = randomUUID(), auth = await startSupabaseMock();
const log = createWriteStream(path.join(output, "server.log"));
const server = spawn(process.execPath, [path.join(app, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3002"], {
  cwd: app, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env,
    CRM_NEXT_DIST_DIR: ".next-qa", CRM_STORAGE_BACKEND: "local", SUPABASE_SECRET_KEY: "", CRM_DATA_DIR: path.join(output, `qa-${randomUUID()}`), N8N_WEBHOOK_SECRET: token,
    NEXT_PUBLIC_SUPABASE_URL: auth.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: auth.key,
    GEMINI_ASSISTANT_API_KEY: "", GEMINI_ASSISTANT_CONFIG_FILE: path.join(output, "not-configured.json") },
});
server.stdout.pipe(log); server.stderr.pipe(log);
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(base + "/login", { signal: AbortSignal.timeout(3000) })).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert(ready, "Isolated QA server did not start");
  assert.equal((await fetch(base + "/api/crm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "followup.approve", payload: { id: "test" } }) })).status, 401);
  browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage(), errors = [];
  waitForWorkspaceNavigation(page);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base + "/login");
  await page.getByLabel("Email address", { exact: true }).fill(auth.owner.email);
  await page.getByLabel("Password", { exact: true }).fill(auth.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("heading", { name: "Your business, at a glance", exact: true }).waitFor();
  async function state() { const response = await context.request.get(base + "/api/crm"); assert.equal(response.status(), 200); return response.json(); }
  async function mutate(action, payload = {}) {
    const response = await context.request.post(base + "/api/crm", { headers: { Origin: base }, data: { action, payload } });
    assert.equal(response.status(), 200, await response.text()); return response.json();
  }
  const initial = await state();
  await mutate("lead.create", { name: "Follow-up QA Customer", email: "followup.qa@example.com", service: "Tap inspection", message: "Please check the leaking tap.", consent: false });
  let snapshot = await state(), lead = snapshot.leads[0];
  await page.goto(base + "/follow-ups");
  const stat = title => page.getByRole("button", { name: new RegExp(`^${title} \\d+$`) });
  assert.equal(await stat("All records").locator(".crm-stat-value").innerText(), String(snapshot.leads.length));
  await page.getByLabel("Search follow-ups", { exact: true }).fill("Follow-up QA Customer");
  assert.equal(await stat("All records").locator(".crm-stat-value").innerText(), "1");
  await page.getByRole("button", { name: "View Follow-up QA Customer's follow-up", exact: true }).click();
  let modal = page.getByRole("dialog", { name: "Follow-up details", exact: true });
  await modal.getByText("No permission recorded", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/follow-ups");
  assert.equal(await modal.locator('a[href^="/leads"]').count(), 0);
  await modal.getByLabel("I have the customer's permission for one follow-up email.", { exact: true }).check();
  await modal.getByRole("button", { name: "Save permission", exact: true }).click();
  await modal.getByText("Customer consented", { exact: true }).waitFor();
  const future = new Date(Date.now() + 3600000);
  const local = new Date(future.getTime() - future.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  await modal.getByLabel("Follow-up date & time", { exact: true }).fill(local);
  await modal.getByRole("button", { name: "Save schedule", exact: true }).click();
  await modal.getByRole("status").filter({ hasText: "Save and approve" }).waitFor();
  const subject = "Checking on your leaking tap";
  const body = "Hi there,\n\nDo you still need help with your leaking tap? Reply with a convenient inspection time.\n\nClearFlow Plumbing";
  await modal.getByLabel("Follow-up subject", { exact: true }).fill(subject);
  await modal.getByLabel("Follow-up email body", { exact: true }).fill(body);
  await modal.getByRole("button", { name: "Save email", exact: true }).click();
  await modal.getByRole("button", { name: "Save email", exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[role="dialog"] button') && [...document.querySelectorAll('[role="dialog"] button')].some(button => button.textContent.includes("Save email") && button.disabled));
  const approval = modal.getByRole("button", { name: "Approve follow-up", exact: true });
  assert(await approval.isDisabled());
  await modal.getByLabel(/^I reviewed this email and approve sending/).check();
  await approval.click();
  await modal.getByText("Approved", { exact: true }).waitFor();
  snapshot = await state(); lead = snapshot.leads.find(item => item.id === lead.id);
  assert.equal(lead.followUpEmail.body, body); assert(lead.followUpEmail.approvedAt);
  assert.equal(lead.followUpState, "Pending"); assert.equal(lead.followUpSentAt, "");
  assert.equal(snapshot.mailJobs.length, initial.mailJobs.length);
  await page.screenshot({ path: path.join(output, "approved-desktop.png"), fullPage: true });
  // Polls preserve unsaved text; saving an edit withdraws approval.
  await modal.getByLabel("Follow-up email body", { exact: true }).fill(body + "\nUpdated note.");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(600);
  assert.equal(await modal.getByLabel("Follow-up email body", { exact: true }).inputValue(), body + "\nUpdated note.");
  await modal.getByRole("button", { name: "Save email", exact: true }).click();
  await modal.getByText("Pending review", { exact: true }).waitFor();
  assert.equal((await state()).leads.find(item => item.id === lead.id).followUpEmail.approvedAt, "");
  await modal.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await page.getByLabel("Search follow-ups", { exact: true }).fill("Follow-up QA Customer");
  await page.getByRole("button", { name: "View Follow-up QA Customer's follow-up", exact: true }).click();
  modal = page.getByRole("dialog", { name: "Follow-up details", exact: true });
  assert.equal(await modal.getByLabel("Follow-up email body", { exact: true }).inputValue(), body + "\nUpdated note.");
  await modal.getByRole("button", { name: "Cancel follow-up", exact: true }).click();
  await modal.getByText("Skipped", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/follow-ups");
  await modal.getByRole("button", { name: "Close", exact: true }).click();

  // Browser-only schedule fixtures verify counts across pages, permission and approval.
  const fixture = structuredClone(await state());
  const template = fixture.leads.find(item => item.id === lead.id);
  fixture.leads = Array.from({ length: 14 }, (_, index) => ({ ...template, id: `count-${index}`, name: `Count customer ${index}`, email: `count-${index}@example.com`, followUpState: index < 12 ? "Pending" : index === 12 ? "Sent" : "Skipped", followUpDue: index === 13 ? "" : new Date(Date.now() - 60000).toISOString(), consent: index !== 0, followUpEmail: undefined }));
  await context.route("**/api/crm", route => route.request().method() === "GET" ? route.fulfill({ contentType: "application/json", body: JSON.stringify(fixture) }) : route.continue());
  await page.goto(base + "/follow-ups");
  await page.getByRole("button", { name: "All records 14", exact: true }).waitFor();
  assert.equal(await stat("All records").locator(".crm-stat-value").innerText(), "14");
  assert.equal(await stat("Due for follow-up").locator(".crm-stat-value").innerText(), "12");
  await stat("Due for follow-up").click();
  await page.getByRole("status").filter({ hasText: "12 matching records" }).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 10, "due count includes all result pages");
  await page.screenshot({ path: path.join(output, "due-counts-desktop.png"), fullPage: true });
  await page.goto(base + "/follow-ups?lead=count-12");
  modal = page.getByRole("dialog", { name: "Follow-up details", exact: true });
  await modal.getByText("Not recorded", { exact: true }).waitFor();
  assert.equal(await modal.getByLabel("Follow-up email body", { exact: true }).count(), 0, "no invented historical email for a legacy sent follow-up");
  await page.screenshot({ path: path.join(output, "historical-email-unavailable.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem("theme", "dark"));
  await page.goto(base + "/follow-ups?lead=count-0");
  modal = page.getByRole("dialog", { name: "Follow-up details", exact: true });
  await modal.getByLabel("Follow-up email body", { exact: true }).waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert((await modal.boundingBox()).width <= 390);
  await page.screenshot({ path: path.join(output, "editor-mobile-dark.png"), fullPage: true });
  await context.unroute("**/api/crm");
  await checkFilterOptions({ page, context, base, snapshot: await state(), output });
  assert.deepEqual(errors, []);
  console.log("Passed: authenticated standalone permission/schedule/editor/approval, no delivery on approval, persistence, poll-safe edits, reapproval, cancellation, total/due counts across pagination, mobile dark layout. Isolated records and no real email.");
} finally {
  await browser?.close();
  if (server.pid) try { execFileSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {}
  await auth.close(); log.end();
}
