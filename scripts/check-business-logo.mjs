import { chromium } from "../.local-tools/browser-testing/node_modules/playwright-core/index.mjs";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, createWriteStream, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { startSupabaseMock } from "./qa/supabase-mock.mjs";

const root = fileURLToPath(new URL("../", import.meta.url)), app = path.join(root, "templates/leads");
const sharp = createRequire(path.join(app, "package.json"))("sharp");
const output = path.join(root, ".local-preview/business-logo"); mkdirSync(output, { recursive: true });
const base = "http://127.0.0.1:3002", supabase = await startSupabaseMock(), dataDir = path.join(output, `qa-${randomUUID()}`);
const log = createWriteStream(path.join(output, "server.log")), token = randomUUID();
const server = spawn(process.execPath, [path.join(app, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3002"], { cwd: app, windowsHide: true, env: { ...process.env, CRM_NEXT_DIST_DIR: ".next-qa", CRM_STORAGE_BACKEND: "local", SUPABASE_SECRET_KEY: "", CRM_DATA_DIR: dataDir, NEXT_PUBLIC_SUPABASE_URL: supabase.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabase.key, N8N_WEBHOOK_SECRET: token, GEMINI_ASSISTANT_API_KEY: "", GEMINI_ASSISTANT_CONFIG_FILE: path.join(dataDir, "not-configured.json") }, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.pipe(log); server.stderr.pipe(log);
const fixture = await sharp({ create: { width: 320, height: 200, channels: 4, background: { r: 25, g: 95, b: 225, alpha: 0.8 } } }).png().toBuffer();
const errors = [];
let browser, page;
async function login(target, email = supabase.owner.email) {
  await target.goto(base + "/login");
  await target.getByLabel("Email address", { exact: true }).fill(email);
  await target.getByLabel("Password", { exact: true }).fill(supabase.password);
  await target.getByRole("button", { name: "Sign in", exact: true }).click();
  await target.getByRole("heading", { name: "Your business, at a glance" }).waitFor();
}
async function isCustom(target) {
  await target.waitForFunction(() => [...document.querySelectorAll("[data-brand-logo] img")].some(image => image.getAttribute("src")?.startsWith("data:image/webp;base64,") && image.complete && image.naturalWidth > 0));
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 45; attempt++) {
    try { if ((await fetch(base + "/login", { signal: AbortSignal.timeout(3000) })).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert(ready, "QA server did not start");
  for (const method of ["POST", "DELETE"]) assert.equal((await fetch(base + "/api/crm/logo", { method, headers: { Origin: base, "Content-Type": "image/png" }, body: method === "POST" ? fixture : undefined })).status, 401);
  browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" });
  page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await login(page);
  const cookie = (await context.cookies()).map(item => `${item.name}=${item.value}`).join("; ");
  const api = (route, options = {}) => fetch(base + route, { ...options, headers: { Cookie: cookie, Origin: base, ...options.headers } });
  const before = await (await api("/api/crm")).json();
  await page.goto(base + "/settings");
  await page.getByRole("heading", { name: "Business logo", exact: true }).waitFor();
  await page.getByLabel("Upload business logo", { exact: true }).setInputFiles({ name: "company.png", mimeType: "image/png", buffer: fixture });
  assert.equal((await (await api("/api/crm")).json()).settings.businessLogo, undefined, "preview must not save automatically");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Save logo", exact: true }).count(), 0);
  await page.getByLabel("Upload business logo", { exact: true }).setInputFiles({ name: "bad.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg />") });
  await page.getByRole("alert").filter({ hasText: "Choose a PNG, JPG or WebP" }).waitFor();
  await page.getByLabel("Upload business logo", { exact: true }).setInputFiles({ name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(2 * 1024 * 1024 + 1) });
  await page.getByRole("alert").filter({ hasText: "smaller than 2 MB" }).waitFor();
  assert.equal((await api("/api/crm/logo", { method: "POST", headers: { "Content-Type": "image/png" }, body: Buffer.from("<svg />") })).status, 415);
  assert.equal((await api("/api/crm/logo", { method: "POST", headers: { "Content-Type": "image/png", Origin: "https://foreign.test" }, body: fixture })).status, 403);
  await page.getByLabel("Upload business logo", { exact: true }).setInputFiles({ name: "company.png", mimeType: "image/png", buffer: fixture });
  await page.getByRole("button", { name: "Save logo", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Your business logo was saved" }).waitFor();
  await isCustom(page);
  assert(await page.getByRole("button", { name: "Save settings", exact: true }).isDisabled(), "logo save must not dirty unrelated settings");
  const saved = await (await api("/api/crm")).json();
  assert(saved.settings.businessLogo.startsWith("data:image/webp;base64,"));
  assert.deepEqual({ ...saved.settings, businessLogo: undefined }, { ...before.settings, businessLogo: undefined });
  for (const group of ["leads", "drafts", "tasks", "mailJobs", "syncChanges"]) assert.deepEqual(saved[group], before[group]);
  await page.waitForFunction(() => document.querySelector('link[rel="icon"]')?.getAttribute("href")?.startsWith("data:image/webp;base64,"));
  await page.screenshot({ path: path.join(output, "settings-desktop.png"), fullPage: true });
  for (const route of ["/", "/leads", "/inbox", "/drafts", "/contacts", "/settings"]) { await page.goto(base + route); await isCustom(page); }
  assert.equal((await (await api("/api/crm")).json()).settings.businessLogo, saved.settings.businessLogo);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
  await isCustom(page);
  const html = await (await fetch(base + "/login")).text();
  assert(!html.includes("Olivia Chen"), "public branding must not expose customer records");
  assert.equal((await context.request.get(base + "/api/crm")).status(), 401);
  await page.screenshot({ path: path.join(output, "login-custom-desktop.png"), fullPage: true });
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem("theme", "dark"));
  await page.goto(base + "/settings");
  await isCustom(page);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(output, "settings-mobile-dark.png"), fullPage: true });
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  const sidebar = page.getByRole("dialog");
  assert((await sidebar.locator("[data-brand-logo] img").getAttribute("src")).startsWith("data:image/webp;base64,"));
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Restore default", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Default logo restored" }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll("[data-brand-logo] img")].every(image => !image.getAttribute("src")?.startsWith("data:")));
  const restored = await (await api("/api/crm")).json();
  assert.equal(restored.settings.businessLogo, "");
  assert.deepEqual({ ...restored.settings, businessLogo: undefined }, { ...before.settings, businessLogo: undefined });
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await login(memberPage, supabase.member.email);
  await memberPage.goto(base + "/settings");
  await memberPage.getByText("Ask a workspace owner to change the business logo.", { exact: true }).waitFor();
  assert.equal(await memberPage.getByLabel("Upload business logo", { exact: true }).count(), 0);
  const memberCookie = (await memberContext.cookies()).map(item => `${item.name}=${item.value}`).join("; ");
  for (const method of ["POST", "DELETE"]) assert.equal((await fetch(base + "/api/crm/logo", { method, headers: { Cookie: memberCookie, Origin: base, "Content-Type": "image/png" }, body: method === "POST" ? fixture : undefined })).status, 403);
  assert.equal((await fetch(base + "/api/n8n/health", { headers: { Authorization: "Bearer " + token } })).status, 200);
  assert.deepEqual(errors, []);
  console.log("Passed: owner-only logo upload, preview/cancel, validation, persistence, sidebar/mobile/sign-in/favicon consistency, default restore, cross-site/signed-out/member rejection and preserved records/settings/sync queue. Isolated data only.");
} catch (error) {
  await page?.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  if (server.pid) { if (process.platform === "win32") { try { execFileSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch {} } else server.kill("SIGTERM"); }
  await supabase.close(); log.end();
}
