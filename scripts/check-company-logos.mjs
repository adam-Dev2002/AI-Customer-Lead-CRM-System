import { chromium } from "../.local-tools/browser-testing/node_modules/playwright-core/index.mjs";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, createWriteStream, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { startSupabaseMock } from "./qa/supabase-mock.mjs";
import { createSeed } from "../templates/leads/lib/crm/seed.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const app = path.join(root, "templates/leads"),
  base = "http://127.0.0.1:3002";
const output = path.join(root, ".local-preview/company-logos");
const dataDir = path.join(output, `qa-${randomUUID()}`);
mkdirSync(dataDir, { recursive: true });
const supabase = await startSupabaseMock(),
  fixture = createSeed();
const people = [
  { name: "DragonFi QA", email: "qa@dragonfi.ph" },
  { name: "Make QA", email: "qa@make.com" },
  { name: "Personal QA", email: "qa@gmail.com" },
  { name: "Missing Logo", email: "qa@missing-logo-8675309.com" },
  {
    name: "Saved Photo",
    email: "photo@sparkhire.com",
    photoUrl: "https://images.example.test/person.png",
  },
  {
    name: "Broken Photo",
    email: "broken@pawpay.com",
    photoUrl: "https://images.example.test/broken.png",
  },
];
fixture.leads = people.map((person, index) => ({
  ...fixture.leads[index],
  ...person,
  id: `LOGO-QA-${index}`,
  source: "Gmail",
  service: `Logo QA inquiry ${index}`,
  isSample: true,
  consent: true,
  followUpState: "Pending",
  nextFollowUpAt: new Date(Date.now() + 86400000).toISOString(),
}));
fixture.drafts = people.map((_, index) => ({
  ...fixture.drafts[index % fixture.drafts.length],
  id: `LOGO-DRAFT-${index}`,
  leadId: `LOGO-QA-${index}`,
  status: "Pending review",
}));
fixture.tasks = [];
fixture.activities = [];
fixture.mailJobs = [];
fixture.syncChanges = [];
writeFileSync(path.join(dataDir, "crm.json"), JSON.stringify(fixture));
const log = createWriteStream(path.join(output, "server.log"));
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
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      CRM_NEXT_DIST_DIR: ".next-qa",
      CRM_STORAGE_BACKEND: "local", SUPABASE_SECRET_KEY: "", CRM_DATA_DIR: dataDir,
      NEXT_PUBLIC_SUPABASE_URL: supabase.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabase.key,
      GOOGLE_CONTACTS_CLIENT_ID: "",
      GOOGLE_CONTACTS_CLIENT_SECRET: "",
      GOOGLE_CONTACTS_REFRESH_TOKEN: "",
      GEMINI_ASSISTANT_API_KEY: "",
      GEMINI_ASSISTANT_CONFIG_FILE: path.join(dataDir, "not-configured.json"),
    },
  },
);
server.stdout.pipe(log);
server.stderr.pipe(log);
let browser, page;
const errors = [];
const photo =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#d1fae5"/><circle cx="32" cy="25" r="15" fill="#047857"/></svg>';
try {
  let ready = false;
  for (let attempt = 0; attempt < 45; attempt++) {
    try {
      if ((await fetch(base + "/login", { signal: AbortSignal.timeout(3000) })).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert(ready);
  assert.equal((await fetch(base + "/api/crm/company-logo?domain=dragonfi.ph")).status, 401);
  browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    reducedMotion: "reduce",
  });
  const network = [];
  context.on("request", (request) => network.push(request.url()));
  await context.route("**/api/crm/contact-photos", (route) =>
    route.fulfill({
      json: {
        status: "available",
        photos: { "qa@gmail.com": "https://images.example.test/google.png" },
      },
    }),
  );
  await context.route("https://images.example.test/**", (route) =>
    route.request().url().endsWith("broken.png")
      ? route.fulfill({ status: 404 })
      : route.fulfill({ contentType: "image/svg+xml", body: photo }),
  );
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + "/login");
  await page.getByLabel("Email address", { exact: true }).fill(supabase.owner.email);
  await page.getByLabel("Password", { exact: true }).fill(supabase.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("heading", { name: "Your business, at a glance" }).waitFor();
  const before = await (await context.request.get(base + "/api/crm")).json();
  for (const domain of ["dragonfi.ph", "make.com", "pawpay.com"]) {
    const response = await context.request.get(base + `/api/crm/company-logo?domain=${domain}`);
    assert.equal(response.status(), 200, domain);
    assert.equal(response.headers()["content-type"], "image/webp");
    assert(response.headers()["cache-control"].startsWith("private"));
    writeFileSync(path.join(output, domain + ".webp"), await response.body());
  }
  for (const domain of [
    "gmail.com",
    "127.0.0.1",
    "unrelated-company.com",
    "sparkhire.com.evil.com",
  ]) {
    assert.equal(
      (await context.request.get(base + `/api/crm/company-logo?domain=${domain}`)).status(),
      404,
    );
  }
  async function checkAvatars(route) {
    await page.goto(base + route);
    await page.getByRole("heading", { level: 1 }).waitFor();
    const panel = page.getByRole("tabpanel");
    const scope = await panel.count() ? panel : page;
    const avatar = (email) => scope.locator(`[data-person-email="${email}"]`).first();
    for (const email of ["qa@dragonfi.ph", "qa@make.com", "broken@pawpay.com"]) {
      await avatar(email).locator('img[data-avatar-kind="company"]').waitFor();
      assert.equal(
        await avatar(email)
          .locator("img")
          .evaluate((image) => getComputedStyle(image).objectFit),
        "contain",
      );
    }
    await avatar("qa@gmail.com").locator('img[data-avatar-kind="person"]').waitFor();
    await avatar("photo@sparkhire.com").locator('img[data-avatar-kind="person"]').waitFor();
    await avatar("qa@missing-logo-8675309.com").getByText("ML", { exact: true }).waitFor();
    assert.equal(await avatar("qa@missing-logo-8675309.com").locator("img").count(), 0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), route);
  }
  for (const route of ["/inbox", "/leads", "/drafts", "/contacts", "/follow-ups"]) {
    await checkAvatars(route);
    await page.screenshot({
      path: path.join(output, route.slice(1) + "-desktop.png"),
      fullPage: true,
    });
  }
  await page.goto(base + "/leads/LOGO-QA-0");
  await page
    .locator('[data-person-email="qa@dragonfi.ph"] img[data-avatar-kind="company"]')
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem("theme", "dark"));
  await checkAvatars("/inbox");
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.screenshot({ path: path.join(output, "inbox-mobile-dark.png"), fullPage: true });
  const after = await (await context.request.get(base + "/api/crm")).json();
  for (const field of ["leads", "drafts", "settings", "mailJobs", "syncChanges"])
    assert.deepEqual(after[field], before[field]);
  assert(!network.some((url) => /company-logo\?domain=(?:gmail\.com|sparkhire\.com)/.test(url)));
  assert(
    !network.some((url) => new URL(url).hostname.endsWith("gstatic.com")),
    "Browser must use the authenticated local image route",
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      authenticatedCompanyIcons: true,
      personalPhotoPriority: true,
      missingAndBrokenFallbacks: true,
      consistentPages: 6,
      mobileDark: true,
      recordsUnchanged: true,
      liveEmailsSent: 0,
    }),
  );
} catch (error) {
  await page
    ?.screenshot({ path: path.join(output, "failure.png"), fullPage: true })
    .catch(() => {});
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
