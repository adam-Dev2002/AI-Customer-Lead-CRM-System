// Documentation pictures only: isolated sample records, mock login, no live integrations.
// Run from the repository root: node --experimental-strip-types scripts/capture-setup-docs.mjs
// Requires installed app dependencies and Playwright Chromium (or Chrome on Windows).
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, createWriteStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createSeed } from "../templates/leads/lib/crm/seed.ts";
import { startSupabaseMock } from "./qa/supabase-mock.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const app = path.join(root, "templates/leads");
const { chromium } = await import(pathToFileURL(path.join(app, "node_modules/playwright-core/index.mjs")).href);
const images = path.join(root, "docs/images/setup");
const run = randomUUID();
const privateDirectory = path.join(root, ".local-preview", `docs-${run}`);
mkdirSync(privateDirectory, { recursive: true });
mkdirSync(images, { recursive: true });
const dataDirectory = path.join(privateDirectory, "data");
mkdirSync(dataDirectory);
const data = createSeed();
Object.assign(data.settings, {
  businessName: "ClearFlow Demo Plumbing", ownerName: "Demo Owner", ownerEmail: "owner@example.com",
  automaticEmailsEnabled: false, businessFacts: "Fictional demonstration business. No appointments or prices are confirmed.",
  replySignature: "Kind regards,\nClearFlow Demo Plumbing",
});
for (const lead of data.leads) lead.owner = "Demo Owner";
for (const draft of data.drafts) draft.body = draft.body.replaceAll("5S Plumbing", "ClearFlow Demo Plumbing");
assert(data.leads.every(lead => lead.isSample && lead.email.endsWith("@example.com")));
assert(data.mailJobs.length === 0);
writeFileSync(path.join(dataDirectory, "crm.json"), JSON.stringify(data));
writeFileSync(path.join(dataDirectory, "customer-form.json"), JSON.stringify({
  version: 1, url: "https://forms.example.com/form/demo-inquiry",
}));
const mock = await startSupabaseMock();
const configPath = path.join(app, "tsconfig.json");
const originalConfig = readFileSync(configPath, "utf8");
const dist = `.next-qa/docs-${run}`;
const log = createWriteStream(path.join(privateDirectory, "server.log"));
const base = "http://127.0.0.1:3002";
const server = spawn(process.execPath, [path.join(app, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3002"], {
  cwd: app, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", CRM_STORAGE_BACKEND: "local", CRM_DATA_DIR: dataDirectory,
    CRM_NEXT_DIST_DIR: dist, SUPABASE_URL: "", SUPABASE_SECRET_KEY: "", N8N_WEBHOOK_SECRET: randomUUID(),
    NEXT_PUBLIC_SUPABASE_URL: mock.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: mock.key,
    CRM_CUSTOMER_FORM_URL: "", GEMINI_ASSISTANT_API_KEY: "", GOOGLE_CONTACTS_CLIENT_ID: "",
    GOOGLE_CONTACTS_CLIENT_SECRET: "", GOOGLE_CONTACTS_REFRESH_TOKEN: "" },
});
server.stdout.pipe(log); server.stderr.pipe(log);
let browser;
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base + "/login", { signal: AbortSignal.timeout(3000) })).ok) { ready = true; break; } } catch {}
    if (server.exitCode !== null) throw new Error("Documentation server stopped. Check its private log.");
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert(ready, "Documentation server did not start.");
  const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
  browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  // Prevent browser requests to any external account, photo or analytics service.
  await context.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto(base + "/login");
  await page.getByLabel("Email address", { exact: true }).fill(mock.owner.email);
  await page.getByLabel("Password", { exact: true }).fill(mock.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("heading", { name: "Your business, at a glance" }).waitFor();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const shots = [
    ["/", "dashboard"], ["/leads", "leads"], ["/inbox", "inbox"],
    [`/drafts?lead=${data.drafts[0].leadId}&draft=${data.drafts[0].id}`, "reply-review"],
    ["/follow-ups", "follow-ups"], ["/settings", "settings"],
  ];
  for (const [route, name] of shots) {
    await page.goto(base + route);
    await page.locator("#main-content h1").waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    assert(!(await page.locator("body").innerText()).includes("adamromas"));
    await page.screenshot({ path: path.join(images, name + ".png") });
  }
  await page.goto(base + "/settings#customer-form");
  await page.locator("#customer-form").scrollIntoViewIfNeeded();
  await page.locator("#customer-form input").waitFor();
  assert.equal(await page.locator("#customer-form input").inputValue(), "https://forms.example.com/form/demo-inquiry");
  await page.locator("#customer-form").screenshot({ path: path.join(images, "customer-form-link.png") });
  console.log("Captured seven pictures from an isolated fictional workspace. No live email or cloud storage was used.");
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else server.kill("SIGTERM");
  }
  await mock.close();
  // Next may add a generated types path. Restore only that known generated change.
  const current = JSON.parse(readFileSync(configPath, "utf8"));
  current.include = current.include.filter(item => !item.startsWith(dist + "/"));
  assert.deepEqual(current, JSON.parse(originalConfig), "Unexpected tsconfig edit; inspect before restoring.");
  writeFileSync(configPath, originalConfig);
}
