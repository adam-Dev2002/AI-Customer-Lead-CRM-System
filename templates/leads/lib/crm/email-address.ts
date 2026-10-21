export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isEmailAddress(value: string): boolean {
  return (
    value.length <= 254 &&
    /^[^\s@<>,;:"\\()[\]]+@[^\s@<>,;:"\\()[\]]+\.[^\s@<>,;:"\\()[\]]+$/.test(value)
  );
}
