import type { Lead } from "./types.ts";

export type SortDirection = "asc" | "desc";
export type RecordSort = { key: string; direction: SortDirection };
export type SortValue = string | number | boolean | null | undefined;
export type SortChoice = {
  key: string;
  label: string;
  defaultDirection?: SortDirection;
  ascLabel?: string;
  descLabel?: string;
};
export type SortOption<T> = SortChoice & { value: (row: T) => SortValue };

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const missing = (value: SortValue) => value == null || value === "" || (typeof value === "number" && !Number.isFinite(value));

/** Copy and sort the entire result set before taking a page. Empty values stay last. */
export function sortRecords<T>(rows: readonly T[], sort: RecordSort, options: readonly SortOption<T>[]): T[] {
  const option = options.find(option => option.key === sort.key);
  if (!option) return [...rows];
  const multiplier = sort.direction === "asc" ? 1 : -1;
  return rows.map((row, index) => ({ row, index, value: option.value(row) })).sort((a, b) => {
    const aMissing = missing(a.value), bMissing = missing(b.value);
    if (aMissing || bMissing) return aMissing === bMissing ? a.index - b.index : aMissing ? 1 : -1;
    const result = typeof a.value === "string" || typeof b.value === "string"
      ? collator.compare(String(a.value), String(b.value))
      : Number(a.value) - Number(b.value);
    return result * multiplier || a.index - b.index;
  }).map(item => item.row);
}

export const dateSortValue = (value: string | undefined) => value ? Date.parse(value) : null;
export const prioritySortValue = (value: string) => ({ Low: 0, Normal: 1, High: 2, Urgent: 3 })[value];
export const dateSortLabels = { defaultDirection: "desc" as const, ascLabel: "Oldest first", descLabel: "Newest first" };
export const dueSortLabels = { ascLabel: "Earliest first", descLabel: "Latest first" };
export const prioritySortLabels = { defaultDirection: "desc" as const, ascLabel: "Low to urgent", descLabel: "Urgent to low" };

export const leadSortOptions: readonly SortOption<Lead>[] = [
  { key: "createdAt", label: "Date", value: l => dateSortValue(l.createdAt), ...dateSortLabels },
  { key: "name", label: "Lead name", value: l => l.name },
  { key: "email", label: "Email", value: l => l.email },
  { key: "service", label: "Inquiry", value: l => l.service },
  { key: "status", label: "Status", value: l => l.status },
  { key: "priority", label: "Priority", value: l => prioritySortValue(l.priority), ...prioritySortLabels },
  { key: "source", label: "Source", value: l => l.source },
  { key: "owner", label: "Owner", value: l => l.owner },
];

export const followUpSortOptions: readonly SortOption<Lead>[] = [
  { key: "due", label: "Due time", value: l => dateSortValue(l.followUpDue), ...dueSortLabels },
  { key: "name", label: "Customer", value: l => l.name },
  { key: "service", label: "Inquiry", value: l => l.service },
  { key: "priority", label: "Priority", value: l => prioritySortValue(l.priority), ...prioritySortLabels },
  { key: "consent", label: "Consent", value: l => l.consent, ascLabel: "No permission first", descLabel: "Permission first" },
  { key: "status", label: "Lead status", value: l => l.status },
  { key: "state", label: "Follow-up state", value: l => l.followUpState },
];
