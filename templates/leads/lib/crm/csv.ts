const headers = [
  "Name",
  "Email",
  "Phone",
  "Service",
  "Message",
  "Status",
  "Priority",
  "Owner",
  "Consent",
  "Notes",
];
export function escapeCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[\s]*[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}
export function exportCSV(rows: Record<string, unknown>[]) {
  return (
    "\uFEFF" +
    [
      headers.map(escapeCell).join(","),
      ...rows.map((r) =>
        headers.map((h) => escapeCell(r[h.toLowerCase()])).join(","),
      ),
    ].join("\r\n")
  );
}
export function parseCSV(input: string): Record<string, unknown>[] {
  if (input.length > 2_000_000)
    throw new Error("Choose a CSV smaller than 2 MB.");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  const s = input.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      if (quoted && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (!quoted && cell.length)
        throw new Error("Invalid CSV quoting.");
      else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("A quoted CSV field is not closed.");
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  if (rows.length < 2)
    throw new Error("The CSV needs a header and at least one lead.");
  if (rows.length > 1001)
    throw new Error("Import up to 1,000 leads at a time.");
  const aliases: Record<string, string> = {
    "email address": "email",
    "full name": "name",
    "phone number": "phone",
    "service needed": "service",
  };
  const keys = rows[0].map(
    (k) => aliases[k.trim().toLowerCase()] || k.trim().toLowerCase(),
  );
  if (!["name", "email", "service", "message"].every((k) => keys.includes(k)))
    throw new Error(
      "Required columns: Name, Email, Service, Message. Export a CSV for the full format.",
    );
  return rows.slice(1).map((values, index) => {
    if (values.length !== keys.length)
      throw new Error(
        `Row ${index + 2} has ${values.length} columns; expected ${keys.length}.`,
      );
    const item: Record<string, unknown> = {};
    keys.forEach((k, i) => {
      if (headers.some((h) => h.toLowerCase() === k))
        item[k] = values[i].trim();
    });
    item.consent = ["true", "yes"].includes(String(item.consent).toLowerCase());
    return item;
  });
}
