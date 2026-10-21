import { chromium } from "playwright-core";

export async function launchReportBrowser() {
  if (process.env.VERCEL || process.env.CRM_REPORT_SERVERLESS === "1") {
    const { default: binary } = await import("@sparticuz/chromium");
    return chromium.launch({ executablePath: await binary.executablePath(), args: binary.args, headless: true, timeout: 30000 });
  }
  return chromium.launch({ executablePath: process.env.CRM_REPORT_BROWSER_EXECUTABLE || (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : "/usr/bin/chromium"), headless: true, timeout: 20000 });
}
