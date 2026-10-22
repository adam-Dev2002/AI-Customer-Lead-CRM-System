import { chromium } from "../.local-tools/browser-testing/node_modules/playwright-core/index.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { startTenantSupabase } from "./qa/tenant-supabase.mjs";
import { createSeed } from "../templates/leads/lib/crm/seed.ts";

// Real isolated PostgreSQL semantics, fake Auth/email and private Storage. This
// script never touches the hosted Supabase project or sends email.
const root = fileURLToPath(new URL("../", import.meta.url)), app = path.join(root, "templates/leads");
const output = path.join(root, ".local-preview/signup"); mkdirSync(output, { recursive: true });
const port = 3005, base = `http://127.0.0.1:${port}`;
await new Promise((resolve, reject) => { const probe = createServer(); probe.once("error", reject); probe.listen(port, "127.0.0.1", () => probe.close(resolve)); });
const legacyData = createSeed(); legacyData.settings.businessName = "Existing ClearFlow";
const supabase = await startTenantSupabase({ legacyData });
const dataDir = path.join(output, `qa-${randomUUID()}`), log = createWriteStream(path.join(output, "server.log"));
// A single custom-server process makes cleanup deterministic on Windows.
const entry = `const next = require(${JSON.stringify(path.join(app, "node_modules/next"))}); const http = require("node:http"); const application = next({dev:true,webpack:true,dir:${JSON.stringify(app)},hostname:"127.0.0.1",port:${port}}); application.prepare().then(() => http.createServer(application.getRequestHandler()).listen(${port},"127.0.0.1"));`;
const entryPath = path.join(output, "next-server.cjs"), legacySecret = randomUUID();
writeFileSync(entryPath, entry);
const legacyFormUrl = "https://original-control-form.test/form/legacy";
const server = spawn(process.execPath, [entryPath], { cwd: app, windowsHide: true, env: { ...process.env, CRM_NEXT_DIST_DIR: ".next-signup-cloud-qa", CRM_STORAGE_BACKEND: "supabase", CRM_DATA_DIR: dataDir, SUPABASE_SECRET_KEY: supabase.secret, NEXT_PUBLIC_SUPABASE_URL: supabase.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabase.key, N8N_WEBHOOK_SECRET: legacySecret, CRM_CUSTOMER_FORM_URL: legacyFormUrl, GEMINI_ASSISTANT_API_KEY: "", GEMINI_ASSISTANT_CONFIG_FILE: path.join(dataDir, "not-configured.json") }, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.pipe(log); server.stderr.pipe(log);
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(base + "/login", { signal: AbortSignal.timeout(3000) })).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert(ready, "Signup QA server did not start.");
  const request = (body, origin = base) => fetch(base + "/api/auth", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
  const signup = { action: "signup", businessName: "QA Business", email: "validation.qa@example.com", password: "isolated-signup-password", confirmPassword: "isolated-signup-password" };
  for (const body of [{ ...signup, businessName: "Q" }, { ...signup, businessName: "QA\tBusiness" }, { ...signup, businessName: "x".repeat(101) }, { ...signup, password: "short", confirmPassword: "short" }, { ...signup, confirmPassword: "a-different-password" }]) assert.equal((await request(body)).status, 400);
  assert.equal((await request(signup, "https://outside.test")).status, 403);
  assert.equal((await fetch(base + "/api/crm")).status, 401);
  const expectFailure = async (response, expected, text) => {
    assert.equal(response.status, expected === "AUTH_RATE_LIMIT" ? 429 : expected === "AUTH_WEAK_PASSWORD" ? 400 : 503);
    const body = await response.json(); assert.equal(body.code, expected); assert.match(body.error, text);
    assert.match(body.requestId, /^[a-f0-9-]{36}$/);
    assert(!JSON.stringify(body).includes("Simulated"), "raw provider diagnostics must not reach the browser");
  };
  const beforeFailures = supabase.accounts.length;
  const beforeProviderRequests = supabase.auth.control.signupRequests;
  supabase.auth.control.emailAutoConfirm = false;
  await expectFailure(await request({ ...signup, email: "confirmation-on.qa@example.com" }), "AUTH_SIGNUP_POLICY", /Account creation is being set up/);
  assert.equal(supabase.auth.control.signupRequests, beforeProviderRequests, "confirmation-required projects must not receive a signup request");
  assert.equal(supabase.auth.control.confirmationEmails, 0);
  supabase.auth.control.emailAutoConfirm = true;
  supabase.control.missingRPCs.add("crm_workspace_connection");
  await expectFailure(await request({ ...signup, email: "setup-missing.qa@example.com" }), "AUTH_WORKSPACE_SETUP", /Account creation is being set up/);
  supabase.control.missingRPCs.clear();
  supabase.control.unavailable = true;
  await expectFailure(await request({ ...signup, email: "storage-offline.qa@example.com" }), "AUTH_CONFIGURATION", /Account access is temporarily unavailable/);
  supabase.control.unavailable = false;
  for (const [code, status, expected, message] of [
    ["email_address_not_authorized", 403, "AUTH_EMAIL_SETUP", /confirmation emails are not available/],
    ["signup_disabled", 422, "AUTH_SIGNUP_DISABLED", /Account creation is being set up/],
    ["over_email_send_rate_limit", 429, "AUTH_RATE_LIMIT", /Too many attempts/],
    ["weak_password", 422, "AUTH_WEAK_PASSWORD", /stronger password/],
    ["unexpected_failure", 500, "AUTH_UNAVAILABLE", /Could not create your account/],
  ]) {
    supabase.auth.control.signupFailure = { code, status };
    await expectFailure(await request({ ...signup, email: `${code}.qa@example.com` }), expected, message);
  }
  supabase.auth.control.signupFailure = null;
  supabase.auth.control.resetFailure = { code: "email_address_not_authorized", status: 403 };
  await expectFailure(await request({ action: "reset", email: "reset-error.qa@example.com" }), "AUTH_EMAIL_SETUP", /Password reset emails are not available/);
  supabase.auth.control.resetFailure = null;
  assert.equal(supabase.accounts.length, beforeFailures, "failed setup/email requests must not create accounts");

  const interrupted = { ...signup, email: "workspace-interrupted.qa@example.com" };
  supabase.control.missingRPCs.add("crm_provision_workspace");
  const interruptedSignup = await request(interrupted);
  await expectFailure(interruptedSignup.clone(), "AUTH_WORKSPACE_UNAVAILABLE", /Your account was created/);
  const interruptedCookie = interruptedSignup.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  assert.equal((await fetch(base + "/api/crm", { headers: { Cookie: interruptedCookie } })).status, 401, "failed workspace opening must clear the incomplete session");
  supabase.control.missingRPCs.clear();
  assert.equal((await request({ action: "login", email: interrupted.email, password: interrupted.password })).status, 200, "an account created during a temporary workspace failure recovers through ordinary sign-in");

  const fresh = { ...signup, email: "account.qa@example.com" };
  const registration = await request(fresh);
  assert.equal(registration.status, 200);
  const registrationBody = await registration.json();
  assert.equal(registrationBody.next, "/");
  assert(registration.headers.get("set-cookie")?.includes("auth-token="), "signup grants the new account a session immediately");
  const registeredCookie = registration.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const immediate = await fetch(base + "/api/crm", { headers: { Cookie: registeredCookie } });
  assert.equal(immediate.status, 200, "the signup session must open its private CRM without a separate login");
  assert.equal((await immediate.json()).settings.businessName, fresh.businessName);
  const duplicate = await request(fresh);
  assert.equal(duplicate.status, 400);
  assert.match((await duplicate.json()).error, /Try signing in or resetting your password/);
  assert(!duplicate.headers.get("set-cookie")?.includes("auth-token="), "duplicate signup must not grant access to the existing account");
  assert.equal(supabase.confirmationToken(fresh.email), undefined);
  assert.equal(supabase.auth.control.confirmationEmails, 0);
  assert.equal((await fetch(base + "/api/crm")).status, 401);

  browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage(), errors = [], submissions = [];
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/api/auth", async route => {
    const payload = route.request().postDataJSON(); submissions.push(payload);
    await new Promise(resolve => setTimeout(resolve, 250));
    return route.continue();
  });
  await page.goto(base + "/login");
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByRole("heading", { name: "Create your account", exact: true }).waitFor();
  await page.getByLabel("Business name", { exact: true }).fill("Isolated QA Business");
  await page.getByLabel("Email address", { exact: true }).fill("new.qa@example.com");
  await page.getByLabel("Password", { exact: true }).fill("isolated-signup-password");
  await page.getByLabel("Confirm password", { exact: true }).fill("different-signup-password");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Your passwords do not match" }).waitFor();
  assert.equal(submissions.length, 0);
  await page.getByLabel("Confirm password", { exact: true }).fill("isolated-signup-password");
  assert.equal(await page.getByLabel("Password", { exact: true }).getAttribute("autocomplete"), "new-password");
  await page.getByRole("button", { name: "Show password", exact: true }).click();
  assert.equal(await page.getByLabel("Password", { exact: true }).getAttribute("type"), "text");
  assert.equal(await page.getByLabel("Confirm password", { exact: true }).getAttribute("type"), "text");
  await page.screenshot({ path: path.join(output, "signup-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByRole("button", { name: "Creating account…", exact: true }).waitFor();
  assert(await page.getByLabel("Email address", { exact: true }).isDisabled());
  await page.locator('[data-crm-ready="true"]').waitFor();
  assert.equal(new URL(page.url()).pathname, "/");
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].businessName, "Isolated QA Business");
  const opened = await (await context.request.get(base + "/api/crm")).json();
  assert.equal(opened.settings.businessName, "Isolated QA Business");
  assert.deepEqual(opened.leads, []);
  assert.equal(supabase.auth.control.confirmationEmails, 0);
  await page.screenshot({ path: path.join(output, "signup-opened-workspace.png"), fullPage: true });
  await context.unroute("**/api/auth");
  assert.equal((await context.request.post(base + "/api/auth", { headers: { Origin: base }, data: { action: "logout" } })).status(), 200);
  assert.equal((await context.request.get(base + "/api/crm")).status(), 401);
  await page.goto(base + "/login");
  await page.getByRole("button", { name: "Forgot your password?", exact: true }).click();
  await page.getByRole("heading", { name: "Reset your password", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Password", { exact: true }).count(), 0);
  await page.goto(base + "/login?reason=confirmed");
  await page.getByRole("status").filter({ hasText: "Your email is confirmed" }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem("theme", "dark"));
  await page.reload();
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByRole("heading", { name: "Create your account", exact: true }).waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(output, "signup-mobile-dark.png"), fullPage: true });

  const login = async (session, email, password) => {
    const result = await session.request.post(base + "/api/auth", { headers: { Origin: base }, data: { action: "login", email, password } });
    assert.equal(result.status(), 200, await result.text());
  };
  await login(context, fresh.email, fresh.password);
  let own = await (await context.request.get(base + "/api/crm")).json();
  assert.equal(own.settings.businessName, fresh.businessName);
  for (const group of ["leads", "drafts", "tasks", "activities", "mailJobs", "syncChanges"]) assert.deepEqual(own[group], [], group);
  assert.equal(own.mailSenderEmail, "");
  assert.equal(own.settings.automaticEmailsEnabled, false);
  const membership = (await supabase.sql("select workspace_id from public.crm_workspace_members where user_id=$1", [supabase.accounts.find(account => account.email === fresh.email).id])).rows[0];
  assert.notEqual(membership.workspace_id, "clearflow");
  const created = await context.request.post(base + "/api/crm", { headers: { Origin: base }, data: { action: "lead.create", payload: { name: "Private tenant customer", email: "customer.qa@example.com", service: "Private inquiry", message: "This belongs only to the newly registered business.", consent: false } } });
  assert.equal(created.status(), 200, await created.text());
  own = await (await context.request.get(base + "/api/crm?workspace_id=clearflow")).json();
  assert.equal(own.leads.length, 1);
  assert.equal(own.leads[0].name, "Private tenant customer");
  await page.goto(base + "/leads");
  await page.locator('[data-crm-ready="true"]').waitFor();
  await page.getByText("Private tenant customer", { exact: true }).first().waitFor();
  assert.equal(await page.getByText(legacyData.leads[0].name, { exact: true }).count(), 0);
  await page.screenshot({ path: path.join(output, "new-business-mobile.png"), fullPage: true });

  const ownerContext = await browser.newContext();
  await login(ownerContext, supabase.owner.email, supabase.password);
  const existing = await (await ownerContext.request.get(base + "/api/crm")).json();
  assert.equal(existing.settings.businessName, legacyData.settings.businessName);
  assert.equal(existing.leads.length, legacyData.leads.length);
  assert(!existing.leads.some(lead => lead.id === own.leads[0].id));
  const crossUpdate = await ownerContext.request.post(base + "/api/crm", { headers: { Origin: base }, data: { action: "lead.update", payload: { id: own.leads[0].id, notes: "Cross-business update must fail" } } });
  assert.equal(crossUpdate.status(), 404);

  const second = { ...signup, businessName: "Second private business", email: "second.qa@example.com" };
  assert.equal((await request(second)).status, 200);
  const secondContext = await browser.newContext();
  await login(secondContext, second.email, second.password);
  const other = await (await secondContext.request.get(base + "/api/crm")).json();
  assert.equal(other.settings.businessName, second.businessName);
  assert.deepEqual(other.leads, []);
  const secondMembership = (await supabase.sql("select workspace_id from public.crm_workspace_members where user_id=$1", [supabase.accounts.find(account => account.email === second.email).id])).rows[0];
  const tokenA = "clw_" + randomBytes(32).toString("base64url"), tokenB = "clw_" + randomBytes(32).toString("base64url");
  const tokenHash = token => createHash("sha256").update(token).digest("hex");
  await supabase.rpc("crm_set_workspace_token", { p_workspace_id: membership.workspace_id, p_token_hash: tokenHash(tokenA) });
  await supabase.rpc("crm_set_workspace_token", { p_workspace_id: secondMembership.workspace_id, p_token_hash: tokenHash(tokenB) });
  const machine = (route, token, body) => fetch(base + route, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-CRM-Workspace": secondMembership.workspace_id }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const eventLeadId = "qa-token-owned-lead";
  const event = await machine("/api/n8n/events?workspaceId=" + secondMembership.workspace_id, tokenA, { eventId: "qa-token-event", type: "lead.upsert", workspaceId: secondMembership.workspace_id, data: { Lead_ID: eventLeadId, Name: "Token-owned customer", Email: "token.qa@example.com", Service: "Token scope check", Message: "Only the token owner may receive this inquiry.", Consent: "No", Status: "New" } });
  assert.equal(event.status, 200, await event.text());
  const configA = await (await machine("/api/n8n/config?workspaceId=clearflow", tokenA)).json();
  const configB = await (await machine("/api/n8n/config", tokenB)).json();
  const configLegacy = await (await machine("/api/n8n/config?workspaceId=" + membership.workspace_id, legacySecret)).json();
  assert.equal(configA.config.business_name, fresh.businessName);
  assert.equal(configB.config.business_name, second.businessName);
  assert.equal(configLegacy.config.business_name, legacyData.settings.businessName);
  const syncA = await (await machine("/api/n8n/sync?workspaceId=" + secondMembership.workspace_id, tokenA)).json();
  const syncB = await (await machine("/api/n8n/sync", tokenB)).json();
  assert(syncA.changes.some(change => change.entityId === `lead:${own.leads[0].id}`));
  assert.deepEqual(syncB.changes, []);
  const mailA = await machine("/api/n8n/mail", tokenA, { action: "claim", executionId: "qa-empty-claim-a", senderEmail: "sender-a.qa@example.com", workspaceId: secondMembership.workspace_id });
  const mailB = await machine("/api/n8n/mail", tokenB, { action: "claim", executionId: "qa-empty-claim-b", senderEmail: "sender-b.qa@example.com" });
  assert.equal(mailA.status, 200); assert.deepEqual(await mailA.json(), { job: null });
  assert.equal(mailB.status, 200); assert.deepEqual(await mailB.json(), { job: null });
  const afterA = await (await context.request.get(base + "/api/crm")).json();
  const afterB = await (await secondContext.request.get(base + "/api/crm")).json();
  assert(afterA.leads.some(lead => lead.id === eventLeadId));
  assert.deepEqual(afterB.leads, []);
  assert.equal(afterA.mailSenderEmail, "sender-a.qa@example.com");
  assert.equal(afterB.mailSenderEmail, "sender-b.qa@example.com");
  const rotated = "clw_" + randomBytes(32).toString("base64url");
  await supabase.rpc("crm_set_workspace_token", { p_workspace_id: membership.workspace_id, p_token_hash: tokenHash(rotated) });
  assert.equal((await machine("/api/n8n/config", tokenA)).status, 401);
  assert.equal((await machine("/api/n8n/config", "clw_" + randomBytes(32).toString("base64url"))).status, 401);
  assert.equal((await machine("/api/n8n/config", rotated)).status, 200);
  const legacyReport = randomUUID(), privateReport = randomUUID();
  for (const [prefix, id, label] of [["", legacyReport, "Existing ClearFlow"], [`workspaces/${membership.workspace_id}/`, privateReport, fresh.businessName]]) {
    supabase.objects.set(`${prefix}reports/${id}/report.json`, Buffer.from(JSON.stringify({ id, filename: "isolation-test", businessName: label })));
    supabase.objects.set(`${prefix}reports/${id}/report.pdf`, Buffer.from(`%PDF-isolated-${label}`));
  }
  assert.equal((await ownerContext.request.get(base + `/api/crm/reports/${legacyReport}?format=pdf`)).status(), 200);
  assert.equal((await context.request.get(base + `/api/crm/reports/${legacyReport}?format=pdf`)).status(), 404);
  assert.equal((await context.request.get(base + `/api/crm/reports/${privateReport}?format=pdf`)).status(), 200);
  assert.equal((await ownerContext.request.get(base + `/api/crm/reports/${privateReport}?format=pdf`)).status(), 404);
  assert.equal((await secondContext.request.get(base + `/api/crm/reports/${privateReport}?format=pdf`)).status(), 404);
  assert.equal((await context.request.post(base + "/api/assistant", { headers: { Origin: base }, data: { question: "How many inquiries?" } })).status(), 503, "unconfigured new business must not use the original assistant credential");
  const newSettings = await context.request.get(base + "/settings");
  assert.equal(newSettings.status(), 200);
  assert(!(await newSettings.text()).includes(legacyFormUrl), "new business must not receive the original public form URL");
  assert.equal((await (await context.request.get(base + "/api/crm")).json()).mailJobs.length, 0);
  await ownerContext.close(); await secondContext.close();
  assert.deepEqual(errors, []);
  assert.equal(supabase.auth.control.confirmationEmails, 0);
  console.log("Passed immediate signup and dashboard navigation without confirmation emails, signup-policy guard, duplicate denial, signup validation, private empty workspaces, separate business writes, preserved original workspace, cross-business record/report denial, token-scoped n8n routes and rotation, assistant isolation, desktop/mobile layout. Auth and files were simulated; no real accounts or emails created.");
} finally {
  await browser?.close();
  if (server.pid) server.kill("SIGTERM");
  await supabase.close(); log.end();
}
