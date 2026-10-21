"use client";
import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { RecordSort, SortChoice, SortDirection } from "@/lib/crm/record-sort";
import { NativeSelect } from "./shared";

export function useRecordSort(key: string, direction: SortDirection, onChange?: () => void) {
  const [sort, setSort] = useState<RecordSort>({ key, direction });
  function changeSort(next: RecordSort) { setSort(next); onChange?.(); }
  return { sort, changeSort, resetSort: () => changeSort({ key, direction }) };
}

export type RecordFilter = { label: string; value: string; defaultValue?: string; displayValue?: string; onRemove: () => void };

export function sortFilter(sort: RecordSort, options: readonly SortChoice[], defaultValue: string, onRemove: () => void): RecordFilter {
  const option = options.find(option => option.key === sort.key);
  const direction = sort.direction === "asc" ? option?.ascLabel || "A to Z" : option?.descLabel || "Z to A";
  return { label: "Order", value: `${sort.key}:${sort.direction}`, defaultValue, displayValue: `${option?.label || sort.key}, ${direction.toLowerCase()}`, onRemove };
}

export function RecordFilters({ search, children, filters = [], hasSearch = false, onClear, compact = false }: {
  search: ReactNode; children: ReactNode; filters?: RecordFilter[]; hasSearch?: boolean; onClear: () => void; compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false), id = useId();
  const active = filters.filter(filter => filter.value !== (filter.defaultValue ?? "all"));
  return <div role="group" aria-label="Filters and sorting" className="crm-filter-bar border-b p-4">
    <div className={cn("flex flex-wrap items-end gap-2", compact && "[&>div:first-child]:basis-full")}>
      <div className="min-w-0 basis-full sm:max-w-sm sm:flex-1 [&>label]:w-full">{search}</div>
      <Button type="button" variant="outline" className="h-9" aria-label="Advanced filters" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>
        <SlidersHorizontal className="size-3.5" aria-hidden="true" />Advanced filters
        {active.length > 0 && <span className="rounded-full bg-primary/10 px-1.5 text-[10px] text-primary">{active.length}</span>}
        <ChevronDown className={cn("size-3.5 transition-transform motion-reduce:transition-none", expanded && "rotate-180")} aria-hidden="true" />
      </Button>
      {(expanded || active.length > 0 || hasSearch) && <Button type="button" variant="ghost" size="sm" onClick={onClear} className="h-9"><X className="size-3.5" aria-hidden="true" />Clear filters</Button>}
    </div>
    {active.length > 0 && <div aria-label="Applied filters" className="mt-3 flex flex-wrap gap-2">
      {active.map(filter => <button key={filter.label} type="button" onClick={filter.onRemove} aria-label={`Remove ${filter.label} filter`}
        className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-primary/5 px-2 py-1 text-xs text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring">
        <span className="min-w-0 truncate" title={filter.displayValue ?? filter.value}>{filter.label}: {filter.displayValue ?? filter.value}</span><X className="size-3 shrink-0" aria-hidden="true" />
      </button>)}
    </div>}
    <div id={id} hidden={!expanded} className="mt-4 border-t pt-4">
      <div className={compact ? "grid gap-3" : "flex flex-wrap items-end gap-3"}>{children}</div>
    </div>
  </div>;
}

export function FilterSelect({ label, value, onValueChange, className, ...props }: Omit<ComponentProps<"select">, "value" | "onChange" | "multiple"> & {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  const id = useId();
  return <label htmlFor={id} className="flex min-w-0 flex-col gap-1.5 text-xs text-muted-foreground">
    <span>{label}</span>
    <NativeSelect {...props} id={id} value={value} onChange={event => onValueChange(event.target.value)} className={cn("w-full max-w-full", className)} />
  </label>;
}

export function SearchFilter(props: ComponentProps<"input">) {
  const id = useId();
  return <label htmlFor={id} className="flex w-full min-w-0 flex-col gap-1.5 text-xs text-muted-foreground sm:w-64">
    <span>Search</span><span className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 size-4" aria-hidden="true" />
      <Input {...props} id={id} className={cn("pl-9", props.className)} />
    </span>
  </label>;
}

export function SortControls({ sort, options, onChange }: { sort: RecordSort; options: readonly SortChoice[]; onChange: (sort: RecordSort) => void }) {
  const option = options.find(option => option.key === sort.key);
  const directionLabel = sort.direction === "asc" ? option?.ascLabel || "A to Z" : option?.descLabel || "Z to A";
  const Icon = sort.direction === "asc" ? ArrowUp : ArrowDown;
  return <div className="flex min-w-0 flex-wrap items-end gap-2">
    <FilterSelect label="Sort by" aria-label="Sort by" value={sort.key} onValueChange={value => {
      const next = options.find(option => option.key === value)!;
      onChange({ key: next.key, direction: next.defaultDirection || "asc" });
    }}>{options.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</FilterSelect>
    <Button type="button" variant="outline" className="h-9" aria-label={`Sort direction: ${directionLabel}`} onClick={() => onChange({ ...sort, direction: sort.direction === "asc" ? "desc" : "asc" })}>
      <Icon className="size-3.5" aria-hidden="true" />{directionLabel}
    </Button>
  </div>;
}

export function SortableTableHead({ label, sortKey, sort, onSort, defaultDirection = "asc", className }: {
  label: string; sortKey: string; sort: RecordSort; onSort: (sort: RecordSort) => void; defaultDirection?: SortDirection; className?: string;
}) {
  const active = sort.key === sortKey;
  const Icon = active ? sort.direction === "asc" ? ArrowUp : ArrowDown : ArrowUpDown;
  const next = active ? sort.direction === "asc" ? "desc" : "asc" : defaultDirection;
  return <TableHead scope="col" className={className} aria-sort={active ? sort.direction === "asc" ? "ascending" : "descending" : "none"}>
    <button type="button" aria-label={`Sort by ${label}`} title={`Sort ${label}: ${next === "asc" ? "ascending" : "descending"}`} onClick={() => onSort({ key: sortKey, direction: next })}
      className="-mx-1 inline-flex min-h-10 items-center gap-2 rounded px-1 text-left hover:text-primary focus-visible:outline-2 focus-visible:outline-ring">
      {label}<Icon aria-hidden="true" className={cn("size-3.5 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
    </button>
  </TableHead>;
}
