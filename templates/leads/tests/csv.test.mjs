import test from "node:test";
import assert from "node:assert/strict";
import { parseCSV, exportCSV, escapeCell } from "../lib/crm/csv.ts";
test("CSV handles quoted commas, double quotes, newlines, and explicit consent", () => {
  const csv =
    'Name,Email,Service,Message,Consent\r\n"Jane, Smith",jane@example.com,Plumbing,"A leak in the \"\"kitchen\"\"\nand bathroom",Yes';
  const rows = parseCSV(csv);
  assert.equal(rows[0].name, "Jane, Smith");
  assert.equal(rows[0].message, 'A leak in the "kitchen"\nand bathroom');
  assert.equal(rows[0].consent, true);
});
test("missing or negative consent is never inferred as permission", () => {
  assert.equal(
    parseCSV(
      "Name,Email,Service,Message\nJane,jane@example.com,Plumbing,A leak",
    )[0].consent,
    false,
  );
  assert.equal(
    parseCSV(
      "Name,Email,Service,Message,Consent\nJane,jane@example.com,Plumbing,A leak,No",
    )[0].consent,
    false,
  );
});
test("CSV rejects incomplete rows and unclosed quoted fields", () => {
  assert.throws(
    () => parseCSV("Name,Email,Service,Message\nJane,jane@example.com"),
    /columns/,
  );
  assert.throws(
    () =>
      parseCSV(
        'Name,Email,Service,Message\n"Jane,jane@example.com,Plumbing,Leak',
      ),
    /not closed/,
  );
});
test("export escapes spreadsheet formulas and survives a round trip", () => {
  assert.equal(escapeCell("=HYPERLINK(1)"), '"\'=HYPERLINK(1)"');
  const original = {
    name: "Jane Smith",
    email: "jane@example.com",
    service: "Drain, kitchen",
    message: 'A "small" leak\nPlease help',
    consent: "Yes",
  };
  const result = parseCSV(exportCSV([original]))[0];
  assert.equal(result.message, original.message);
  assert.equal(result.service, original.service);
  assert.equal(result.consent, true);
});
