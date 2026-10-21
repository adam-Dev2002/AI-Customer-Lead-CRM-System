import assert from "node:assert/strict";
import path from "node:path";
import { expandAdvancedFilters, recordFilterControl } from "./workspace-page.mjs";
import { followUpExpected, followUpFilterFixtures } from "./filter-fixtures.mjs";

export async function checkFilterOptions({ page, context, base, snapshot, output }) {
  const originalNavigation = {};
  for (const method of ['goto', 'reload']) {
    originalNavigation[method] = page[method];
    page[method] = async (...args) => {
      const result = await originalNavigation[method].apply(page, args);
      if (!new URL(page.url()).searchParams.has('lead')) await expandAdvancedFilters(page);
      return result;
    };
  }
  const storedBefore = await (await context.request.get(base + "/api/crm")).json();
  const now = Date.now(), view = structuredClone(snapshot);
  const template = snapshot.leads.find(lead => !lead.isSample) || snapshot.leads[0];
  view.leads = followUpFilterFixtures(template, now);
  view.settings.automaticEmailsEnabled = false;
  view.settings.customerFollowUps = false;
  const initial = structuredClone(view);
  const writes = [];
  await context.route("**/api/crm", async route => {
    if (route.request().method() === "GET") return route.fulfill({ contentType: "application/json", body: JSON.stringify(view) });
    writes.push(route.request().postData());
    return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Filter checks never change records." }) });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => localStorage.setItem("theme", "light"));
  await page.goto(base + "/follow-ups");
  await page.getByRole("button", { name: "All records 13", exact: true }).waitFor();
  const followSelect = () => recordFilterControl(page, "Follow-up state");
  const card = title => page.getByRole("button", { name: new RegExp(`^${title} \\d+$`) });
  async function assertRows(ids, kind = "followup") {
    if (kind === "followup") await page.getByRole("status").filter({ hasText: new RegExp(`^${ids.length} matching record`) }).waitFor();
    else await page.getByRole("heading", { name: new RegExp(`^Leads list ${ids.length}$`) }).waitFor();
    await page.getByText(`Page 1 of ${Math.max(1, Math.ceil(ids.length / 10))}`, { exact: true }).waitFor();
    const found = [];
    for (let index = 0; index < Math.max(1, Math.ceil(ids.length / 10)); index++) {
      // Wait for the actual rows too: two different filters can have the same
      // count, and navigation/pagination can commit after the dropdown event.
      await page.waitForFunction(({ expected, count, seen }) => {
        const names = [...document.querySelectorAll("tbody tr")].map(row => row.querySelector("span.block.font-medium")?.textContent.trim());
        return names.length === count && names.every(name => expected.includes(name) && !seen.includes(name));
      }, { expected: ids.map(id => `Filter ${id}`), count: Math.min(10, Math.max(0, ids.length - index * 10)), seen: found });
      found.push(...await page.locator("tbody tr").evaluateAll(rows => rows.map(row => row.querySelector("span.block.font-medium")?.textContent.trim())));
      if (index + 1 < Math.ceil(ids.length / 10)) {
        await page.getByRole("button", { name: "Next page", exact: true }).click();
        await page.getByText(`Page ${index + 2} of ${Math.ceil(ids.length / 10)}`, { exact: true }).waitFor();
      }
    }
    assert.deepEqual(found.sort(), ids.map(id => `Filter ${id}`).sort(), `${kind}: exact row identities`);
  }
  const counts = { "All records": 13, "Due for follow-up": 6, Pending: 8, "Awaiting approval": 6, Sent: 1, "Needs attention": 2 };
  for (const [title, count] of Object.entries(counts)) assert.equal(await card(title).locator(".crm-stat-value").innerText(), String(count), title);
  for (const [filter, ids] of Object.entries(followUpExpected)) {
    await followSelect().selectOption(filter);
    await page.waitForURL(url => (url.searchParams.get("state") || "all") === filter);
    await assertRows(ids);
    await page.reload();
    await page.waitForFunction(value => document.querySelector('select[aria-label="Follow-up state"]')?.value === value, filter);
    await assertRows(ids);
  }
  console.log("Passed: all nine follow-up filters select exact expected rows, retain selection after refresh, include all pages and match summary cards.");
  await page.goto(base + "/follow-ups?lead=draft-due&state=Pending");
  const details = page.getByRole("dialog", { name: "Follow-up details", exact: true });
  await details.getByRole("button", { name: "Close", exact: true }).click();
  await page.waitForURL(url => !url.searchParams.has("lead"));
  await expandAdvancedFilters(page);
  await followSelect().selectOption("Sent");
  await assertRows(["sent"]);
  assert.equal(await page.getByRole("dialog").count(), 0, "closing a Calendar/deep-link detail must not reopen it when filtering");

  // Search combines with state; zero results reset both search and state.
  await page.goto(base + "/follow-ups");
  await page.getByLabel("Search follow-ups", { exact: true }).fill("  FILTER APPROVED-DUE  ");
  await assertRows(["approved-due"]);
  assert.equal(await card("All records").locator(".crm-stat-value").innerText(), "1");
  assert.equal(await card("Awaiting approval").locator(".crm-stat-value").innerText(), "0");
  await followSelect().selectOption("Sent"); await assertRows([]);
  await page.getByRole("button", { name: "Show all follow-ups", exact: true }).click();
  await assertRows(followUpExpected.all);
  assert.equal(await page.getByLabel("Search follow-ups", { exact: true }).inputValue(), "");
  await page.goto(base + "/follow-ups?state=Sent");
  await assertRows(["sent"]);
  await page.getByRole("status").filter({ hasText: "1 matching record · 0 not scheduled" }).waitFor();
  await page.goto(base + "/follow-ups?state=unknown");
  await assertRows(followUpExpected.all);
  assert.equal(await followSelect().inputValue(), "all");

  // Read-only filter changes must not mutate state. Simulate a separate saved
  // approval arriving through the normal snapshot refresh, in the browser only.
  await page.goto(base + "/follow-ups?state=review");
  await assertRows(followUpExpected.review);
  const changed = view.leads.find(lead => lead.id === "draft-due");
  changed.followUpEmail = { subject: "Reviewed", body: "This is a separately approved QA email body.", revision: 2, updatedAt: new Date(now).toISOString(), approvedAt: new Date(now).toISOString(), approvedTo: changed.email, approvedDue: changed.followUpDue };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await assertRows(["draft-future", "changed-recipient", "changed-time", "withdrawn", "no-permission"]);
  assert.equal(await card("Due for follow-up").locator(".crm-stat-value").innerText(), "6");
  Object.assign(view, structuredClone(initial));
  await page.goto(base + "/follow-ups?state=due");
  await assertRows(followUpExpected.due);
  await page.clock.setSystemTime(new Date(now + 7200000));
  await page.getByRole("status").filter({ hasText: "8 matching records" }).waitFor({ timeout: 18000 });
  assert.equal(await card("Due for follow-up").locator(".crm-stat-value").innerText(), "8", "due dates update without navigation or a data change");
  await page.clock.setSystemTime(new Date(now));
  console.log("Passed: combined search, whitespace/case, reset, invalid URL, approval refresh and automatic due-time updates. No record changes.");

  // All lead stages and priorities, plus combinations, source/owner/date.
  const statuses = ["New", "Pending", "Contacted", "Qualified", "Won", "Lost", "Closed"], priorities = ["Low", "Normal", "High", "Urgent"];
  view.leads = statuses.flatMap((status, statusIndex) => priorities.map((priority, priorityIndex) => ({
    ...template, id: `${status}-${priority}`, name: `Filter ${status}-${priority}`, email: `${statusIndex}-${priorityIndex}@example.com`, status, priority,
    source: priorityIndex % 2 ? "Website" : "Gmail", owner: statusIndex % 2 ? "QA Two" : "QA One", message: "Isolated filter fixture.",
    createdAt: new Date(now - 86400000 * (priorityIndex * 10 + statusIndex)).toISOString(),
  })));
  const leadIds = leads => leads.map(lead => lead.id);
  await page.goto(base + "/leads");
  for (const status of ["all", ...statuses]) {
    await recordFilterControl(page, "Filter status").selectOption(status);
    await assertRows(leadIds(view.leads.filter(lead => status === "all" || lead.status === status)), "lead");
  }
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  for (const priority of ["all", ...priorities]) {
    await recordFilterControl(page, "Filter priority").selectOption(priority);
    await assertRows(leadIds(view.leads.filter(lead => priority === "all" || lead.priority === priority)), "lead");
  }
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await recordFilterControl(page, "Filter status").selectOption("Qualified");
  await recordFilterControl(page, "Filter priority").selectOption("High");
  await assertRows(["Qualified-High"], "lead");
  await recordFilterControl(page, "Filter priority").selectOption("Urgent");
  await assertRows(["Qualified-Urgent"], "lead");
  for (const [label, values, field] of [["Filter source", ["Gmail", "Website"], "source"], ["Filter owner", ["QA One", "QA Two"], "owner"]]) {
    for (const value of values) {
      await page.getByRole("button", { name: "Clear filters", exact: true }).click();
      await recordFilterControl(page, label).selectOption(value);
      await assertRows(leadIds(view.leads.filter(lead => lead[field] === value)), "lead");
    }
  }
  await page.goto(base + "/leads?status=invalid&priority=invalid");
  await assertRows(leadIds(view.leads), "lead");
  assert.equal(await recordFilterControl(page, "Filter status").inputValue(), "all");
  assert.equal(await recordFilterControl(page, "Filter priority").inputValue(), "all");
  await page.goto(base + "/leads?status=Won&priority=Urgent");
  await assertRows(["Won-Urgent"], "lead");
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await page.getByLabel("Filter leads", { exact: true }).fill("  FILTER NEW-HIGH  ");
  await assertRows(["New-High"], "lead");
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();

  // Date fixtures near Singapore day/month boundaries and a future date.
  const stamp = new Date("2026-11-01T01:00:00.000Z");
  await page.clock.setSystemTime(stamp);
  const dates = { today: "2026-10-31T16:01:00.000Z", yesterday: "2026-10-31T15:59:00.000Z", recent: "2026-10-28T00:00:00.000Z", older: "2026-10-10T00:00:00.000Z", old: "2026-09-01T00:00:00.000Z", future: "2026-11-02T01:00:00.000Z" };
  view.leads = Object.entries(dates).map(([id, createdAt]) => ({ ...template, id, name: `Filter ${id}`, createdAt }));
  await page.goto(base + "/leads");
  const dateExpected = { all: ["today", "yesterday", "recent", "older", "old", "future"], today: ["today"], week: ["today", "yesterday", "recent"], "30days": ["today", "yesterday", "recent", "older"], month: ["today"] };
  for (const [period, ids] of Object.entries(dateExpected)) {
    await recordFilterControl(page, "Filter date").selectOption(period); await assertRows(ids, "lead");
  }
  await page.clock.setSystemTime(new Date(now));
  console.log("Passed: every lead stage/priority, exact High vs Urgent, combined filters, source, owner, date periods, timezone boundaries, future exclusion, search, pagination and invalid URLs.");

  Object.assign(view, structuredClone(initial));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem("theme", "dark"));
  await page.goto(base + "/follow-ups");
  for (const [filter, ids] of Object.entries(followUpExpected)) {
    await followSelect().selectOption(filter);
    await page.waitForURL(url => (url.searchParams.get("state") || "all") === filter);
    await assertRows(ids);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.screenshot({ path: path.join(output, "filters-mobile-dark.png"), fullPage: true });
  assert.deepEqual(writes, [], "filtering must never request a save, approval or email send");
  await context.unroute("**/api/crm");
  const storedAfter = await (await context.request.get(base + "/api/crm")).json();
  for (const key of ["leads", "drafts", "mailJobs", "settings", "syncChanges"])
    assert.deepEqual(storedAfter[key], storedBefore[key], `${key} preserved`);
  console.log("Passed: all follow-up options on mobile dark; filters made no writes and preserved all saved records/preferences.");
  for (const method of ['goto', 'reload']) page[method] = originalNavigation[method];
}
