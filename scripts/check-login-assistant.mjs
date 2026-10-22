import { chromium } from "../.local-tools/browser-testing/node_modules/playwright-core/index.mjs";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, createWriteStream, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { startSupabaseMock } from "./qa/supabase-mock.mjs";
import { waitForWorkspaceNavigation } from "./qa/workspace-page.mjs";

const root = fileURLToPath(new URL("../", import.meta.url)), app = path.join(root, "templates/leads");
const output = path.join(root, ".local-preview/login-assistant"); mkdirSync(output, { recursive: true });
const base = "http://127.0.0.1:3002", supabase = await startSupabaseMock(), dataDir = path.join(output, `qa-${randomUUID()}`);
const log = createWriteStream(path.join(output, "server.log"));
const token = randomUUID();
const server = spawn(process.execPath, [path.join(app, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3002"], { cwd: app, windowsHide: true, env: { ...process.env, CRM_NEXT_DIST_DIR: ".next-qa", CRM_STORAGE_BACKEND: "local", SUPABASE_SECRET_KEY: "", CRM_DATA_DIR: dataDir, NEXT_PUBLIC_SUPABASE_URL: supabase.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabase.key, N8N_WEBHOOK_SECRET: token, GEMINI_ASSISTANT_API_KEY: "", GEMINI_ASSISTANT_CONFIG_FILE: path.join(dataDir, "not-configured.json") }, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.pipe(log); server.stderr.pipe(log);
let browser;
const errors = [];
async function login(page, email = supabase.owner.email, password = supabase.password) {
  await page.goto(base + "/login");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
const post = (body, cookie = "", origin = base) => ({ method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, Origin: origin }, body: JSON.stringify(body) });
try {
  let ready = false;
  for (let attempt = 0; attempt < 45; attempt++) {
    try { if ((await fetch(base + "/login", { signal: AbortSignal.timeout(3000) })).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert(ready, "QA server did not start");
  for (const route of ["/", "/inbox", "/drafts", "/leads/test", "/settings"]) {
    const response = await fetch(base + route, { redirect: "manual" });
    assert.equal(response.status, 307); assert(new URL(response.headers.get("location"), base).pathname === "/login");
  }
  for (const route of ["/api/crm", "/api/crm/contact-photos"]) assert.equal((await fetch(base + route)).status, 401);
  assert.equal((await fetch(base + "/api/crm", post({ action: "lead.delete", payload: { id: "unknown" } }))).status, 401);
  assert.equal((await fetch(base + "/api/assistant", post({ question: "Read all records" }))).status, 401);
  assert.equal((await fetch(base + "/api/auth", post({ action: "login", email: supabase.owner.email, password: supabase.password }, "", "https://foreign.test"))).status, 403);
  assert.equal((await fetch(base + "/api/n8n/config")).status, 401);
  assert.equal((await fetch(base + "/api/n8n/config", { headers: { Authorization: "Bearer " + token } })).status, 200);
  console.log("Passed: signed-out pages redirect, CRM/photo/assistant APIs refuse access, cross-site login is refused, n8n retains independent authenticated access.");
  browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  waitForWorkspaceNavigation(page);
  await page.goto(base + "/login");
  await page.waitForFunction(() => Object.keys(document.querySelector("form") || {}).some(key => key.startsWith("__reactProps")));
  assert.equal(await page.getByRole("button", { name: "Ask assistant", exact: true }).count(), 0);
  assert.equal(await page.locator("[data-sidebar]").count(), 0);
  await page.screenshot({ path: path.join(output, "login-desktop.png"), fullPage: true });
  await login(page, supabase.owner.email, "wrong-password");
  await page.getByRole("alert").filter({ hasText: "Check your email and password" }).waitFor();
  await login(page, supabase.outsider.email);
  await page.getByRole("alert").filter({ hasText: "Confirm your email before opening your workspace" }).waitFor();
  assert.equal((await context.request.get(base + "/api/crm")).status(), 401);
  await login(page);
  await page.getByRole("heading", { name: "Your business, at a glance" }).waitFor();
  const cookie = (await context.cookies()).map(item => `${item.name}=${item.value}`).join("; ");
  assert.equal((await fetch(base + "/api/crm", { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(base + "/api/assistant", post({ question: "How many inquiries?" }, cookie))).status, 503, "isolated QA must not access the live Gemini key");
  assert.equal((await fetch(base + "/api/assistant", post({ question: "x".repeat(2001) }, cookie))).status, 400);
  assert.equal((await fetch(base + "/api/assistant", post({ question: "Anything" }, cookie, "https://foreign.test"))).status, 403);
  supabase.setOwnerAccess(false);
  assert.equal((await fetch(base + "/api/crm", { headers: { Cookie: cookie } })).status, 403);
  assert.equal((await fetch(base + "/api/crm/contact-photos", { headers: { Cookie: cookie } })).status, 403);
  assert.equal((await fetch(base + "/api/assistant", post({ question: "Anything" }, cookie))).status, 403);
  supabase.setOwnerAccess(true);
  const recordFile = path.join(dataDir, "crm.json"), before = JSON.parse(readFileSync(recordFile, "utf8"));
  let requests = 0, forceError = false;
  await context.route("**/api/assistant", async route => {
    requests++;
    if (forceError) return route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "The assistant is busy. Please try again later." }) });
    await new Promise(resolve => setTimeout(resolve, 450));
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ answer: "Approve the reply, then choose Send via Gmail and confirm. Approval alone does not send email.\n\n<script>window.injected = true</script>", sources: [{ id: "guide:5", title: "Send a customer reply", href: "/drafts" }], asOf: new Date().toISOString() }) });
  });
  await page.getByRole("button", { name: "Ask assistant", exact: true }).click();
  let panel = page.getByRole("dialog", { name: "Ask assistant", exact: true });
  await panel.getByRole("button", { name: "How do I send a reply?", exact: true }).click();
  await panel.getByRole("status").filter({ hasText: "Checking your workspace" }).waitFor();
  await panel.getByText("Records checked", { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => window.injected), undefined, "provider output must render as text");
  await page.screenshot({ path: path.join(output, "assistant-desktop.png"), fullPage: true });
  await panel.getByRole("link", { name: "Send a customer reply", exact: true }).click();
  await page.getByRole("tabpanel", { name: /^AI replies/ }).waitFor();
  await page.getByRole("button", { name: "Ask assistant", exact: true }).click();
  panel = page.getByRole("dialog", { name: "Ask assistant", exact: true });
  assert(await panel.getByText("Records checked", { exact: false }).count());
  forceError = true;
  await panel.getByRole("textbox", { name: "Ask a question" }).fill("Which inquiries need attention?");
  await panel.getByRole("button", { name: "Send question" }).click();
  await panel.getByRole("alert").filter({ hasText: "assistant is busy" }).waitFor();
  assert.equal(await panel.getByRole("textbox", { name: "Ask a question" }).inputValue(), "Which inquiries need attention?");
  await panel.getByRole("button", { name: "New chat" }).click();
  assert.equal(await panel.getByText("Records checked", { exact: false }).count(), 0);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem("theme", "dark")); await page.reload();
  await page.getByRole("tabpanel", { name: /^AI replies/ }).waitFor();
  await page.getByRole("button", { name: "Ask assistant", exact: true }).click();
  panel = page.getByRole("dialog", { name: "Ask assistant", exact: true });
  await page.waitForFunction(() => {
    const element = document.querySelector('[data-slot="sheet-content"][data-state="open"]');
    return element && Math.abs(element.getBoundingClientRect().left) < 1;
  });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert((await panel.boundingBox()).width <= 390);
  assert.equal(await panel.evaluate(element => getComputedStyle(element).animationName), "none", "reduced-motion drawer must not animate");
  await page.screenshot({ path: path.join(output, "assistant-mobile-dark.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Ask assistant", exact: true }).count(), 0);
  assert.equal((await context.request.get(base + "/api/crm")).status(), 401);
  assert.equal((await context.request.post(base + "/api/assistant", { data: { question: "Count" } })).status(), 401);
  await page.screenshot({ path: path.join(output, "login-mobile-dark.png"), fullPage: true });
  const after = JSON.parse(readFileSync(recordFile, "utf8"));
  for (const group of ["leads", "drafts", "tasks", "mailJobs", "settings"]) assert.deepEqual(after[group], before[group]);
  assert.equal(requests, 2); assert.deepEqual(errors, []);
  console.log("Passed: invalid password, unenrolled account, member access, revocation, chat loading/sources/errors/reset, safe text, keyboard close, mobile dark layout and sign-out. No customer records or delivery changed.");
} finally {
  await browser?.close();
  if (server.pid) { if (process.platform === "win32") { try { execFileSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch {} } else server.kill("SIGTERM"); }
  await supabase.close(); log.end();
}
