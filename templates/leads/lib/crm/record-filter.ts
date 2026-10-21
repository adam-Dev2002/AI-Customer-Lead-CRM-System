/** Each filter selects one exact value; "all" leaves that group unrestricted. */
export function matchesSelection(selection: string, value: string): boolean {
  return selection === "all" || selection === value;
}

// Older multi-value links resolve to one visible, valid selection.
export function readSingleSelection(values: readonly string[], allowed: readonly string[]): string {
  return values.find(value => value === "all" || allowed.includes(value)) || "all";
}
