"use client";
import { ActionIcon } from "./action-icon";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ChartNoAxesCombined, Users, Sparkles, Clock3, ClipboardList } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { Button } from "@/components/ui/button";
import { useCRM } from "./provider";
import { LeadForm } from "./forms";
import { ImportExport, LeadTable } from "./leads-page";
import {
  Panel,
  matchesPeriod,
  EmptyState,
  useFormat,
  PersonAvatar,
} from "./shared";
import { followUpDue } from "@/lib/crm/followup-email";
import { leadStatuses } from "@/lib/crm/types";
import { inboxHref } from "@/lib/crm/inbox-navigation";
import { inquiryGrowth } from "@/lib/crm/inquiry-growth";
import { priorities } from "@/lib/crm/types";
import { leadSortOptions, sortRecords } from "@/lib/crm/record-sort";
import { matchesSelection } from "@/lib/crm/record-filter";
import { RecordFilters, FilterSelect, SearchFilter, SortControls, useRecordSort, sortFilter } from "./record-controls";

export function OverviewPage() {
  const { data } = useCRM(),
    format = useFormat();
  const [period, setPeriod] = useState("month"),
    [create, setCreate] = useState(false);
  const [query, setQuery] = useState(""), [status, setStatus] = useState("all"), [priority, setPriority] = useState("all");
  const { sort, changeSort, resetSort } = useRecordSort("createdAt", "desc");
  const leads = useMemo(() => data.leads.filter((l) =>
    matchesPeriod(l.createdAt, period, data.settings.timezone),
  ), [data.leads, period, data.settings.timezone]);
  const due = data.leads.filter((l) => followUpDue(l));
  const inquiryRows = sortRecords(leads.filter(l => matchesSelection(status, l.status) && matchesSelection(priority, l.priority) &&
    `${l.name} ${l.email} ${l.service} ${l.message} ${l.summary}`.toLowerCase().includes(query.trim().toLowerCase())), sort, leadSortOptions);
  const drafts = data.drafts.filter((d) => d.status === "Pending review");
  const cards = [
    {
      label: "Total leads",
      count: leads.length,
      detail: `${leads.filter((l) => l.status === "New").length} new inquiries in this period`,
      icon: ClipboardList,
      href: "/leads",
    },
    {
      label: "Open inquiries",
      count: data.leads.filter((l) =>
        ["New", "Pending", "Contacted", "Qualified"].includes(l.status),
      ).length,
      detail: "Across your entire workspace",
      icon: Users,
      href: "/leads",
    },
    {
      label: "Drafts to review",
      count: drafts.length,
      detail: "Waiting for your approval",
      icon: Sparkles,
      href: inboxHref("replies"),
    },
    {
      label: "Follow-ups due",
      count: due.length,
      detail: "Scheduled time reached; approval required",
      icon: Clock3,
      href: "/follow-ups",
    },
  ];
  const growthDays = period === "week" ? 7 : 30;
  const growth = useMemo(() => inquiryGrowth(leads, growthDays, data.settings.timezone),
    [leads, growthDays, data.settings.timezone]);
  const statusData = leadStatuses.map((status, i) => ({
    status,
    count: leads.filter((l) => l.status === status).length,
    color: [
      "#375dfb",
      "#8b6bf4",
      "#aa8ef9",
      "#34b78f",
      "#16a36a",
      "#f26f83",
      "#a0a5b1",
    ][i],
  }));
  const max = Math.max(1, ...statusData.map((s) => s.count));
  const attention = data.leads.filter((l) =>
    ["Needs Review", "Reserved"].includes(l.followUpState),
  );
  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="crm-page-heading">
          <h1 className="text-xl font-semibold tracking-tight">
            Your business, at a glance
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {format(new Date().toISOString())} <span className="mx-1">·</span>{" "}
            Here&apos;s what needs your attention.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ImportExport leads={leads} />
          <Button onClick={() => setCreate(true)}>
            <ActionIcon action="create" />
            Create new
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterSelect label="Date range"
          value={period}
          onValueChange={setPeriod}
          aria-label="Dashboard date range"
        >
          <option value="month">This month</option>
          <option value="week">Last 7 days</option>
          <option value="30days">Last 30 days</option>
        </FilterSelect>
        {data.leads.some((l) => l.isSample) && (
          <Link href="/help#local" className="text-xs text-muted-foreground">
            Sample inquiries included{" "}
            <ActionIcon action="view" className="ml-1 inline" />
          </Link>
        )}
      </div>
      <div className="grid grid-cols-2 divide-x divide-y overflow-hidden rounded-xl border bg-card xl:grid-cols-4 xl:divide-y-0">
        {cards.map((c, index) => (
          <Link
            key={c.label}
            href={c.href}
            data-tone={["blue", "emerald", "violet", "amber"][index]}
            className="crm-stat-card crm-interactive group px-5 py-5 sm:px-6"
          >
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <c.icon className="crm-tone-icon size-4" />
              {c.label}
              <ActionIcon action="view" className="ml-auto opacity-0 group-hover:opacity-100" />
            </p>
            <p className="crm-stat-value my-4 text-3xl font-semibold tracking-tight">
              {c.count}
            </p>
            <p className="text-[11px] text-muted-foreground">{c.detail}</p>
          </Link>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.7fr_1fr]">
        <Panel
          title="Inquiry growth"
          action={
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-[#6e3ff3]" />
              Leads received
            </span>
          }
        >
          <div className="p-5">
            <p className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
              <ChartNoAxesCombined className="size-4" />
              Daily inquiries · last {growth.length} days
            </p>
            <div className="h-[245px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={growth}
                  margin={{ top: 10, right: 5, left: -25, bottom: 0 }}
                >
                  <defs>
                    <linearGradient
                      id="inquiryGrowth"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor="#6e3ff3" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#6e3ff3" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="var(--border)"
                  />
                  <XAxis
                    dataKey="day"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    minTickGap={35}
                  />
                  <YAxis
                    allowDecimals={false}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="leads"
                    name="Inquiries"
                    stroke="#6e3ff3"
                    strokeWidth={2}
                    fill="url(#inquiryGrowth)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Panel>
        <Panel title="Leads by status">
          <div className="p-5">
            <div className="mb-6 flex items-end gap-2">
              <span className="text-3xl font-semibold">{leads.length}</span>
              <span className="pb-1 text-xs text-muted-foreground">
                in this period
              </span>
            </div>
            <div className="space-y-4">
              {statusData.map((s) => (
                <Link
                  href={`/leads?status=${s.status}`}
                  key={s.status}
                  className="flex items-center gap-3 text-xs"
                >
                  <span className="w-16 shrink-0 text-muted-foreground">
                    {s.status}
                  </span>
                  <span className="h-2.5 flex-1 overflow-hidden rounded bg-muted">
                    <span
                      className="block h-full rounded"
                      style={{
                        width: `${(s.count / max) * 100}%`,
                        background: s.color,
                      }}
                    />
                  </span>
                  <span className="w-5 text-right font-medium">{s.count}</span>
                </Link>
              ))}
            </div>
          </div>
        </Panel>
      </div>
      <Panel
        title="Recent inquiries"
        action={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/leads">
              <ActionIcon action="view" />
              View all
              
            </Link>
          </Button>
        }
      >
        <RecordFilters  onClear={() => { setQuery(""); setStatus("all"); setPriority("all"); resetSort(); }}
          search={<SearchFilter aria-label="Search overview inquiries" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search customer or service…" />}
          hasSearch={!!query.trim()}
          filters={[
            { label: "Status", value: status, onRemove: () => setStatus("all") },
            { label: "Priority", value: priority, onRemove: () => setPriority("all") },
            sortFilter(sort, leadSortOptions, "createdAt:desc", resetSort),
          ]}
        >
          <FilterSelect label="Status" aria-label="Overview inquiry status" value={status} onValueChange={value => setStatus(value)}><option value="all">All statuses</option>{leadStatuses.map(s => <option key={s}>{s}</option>)}</FilterSelect>
          <FilterSelect label="Priority" aria-label="Overview inquiry priority" value={priority} onValueChange={value => setPriority(value)}><option value="all">All priorities</option>{priorities.map(s => <option key={s}>{s}</option>)}</FilterSelect>
          
          <SortControls sort={sort} options={leadSortOptions.filter(option => !["email", "source", "owner"].includes(option.key))} onChange={changeSort} />
        </RecordFilters>
        <LeadTable leads={inquiryRows.slice(0, 5)} compact sort={sort} onSort={changeSort} />
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">Showing {Math.min(5, inquiryRows.length)} of {inquiryRows.length} matching inquiries in the selected period. Use View all for the full list.</p>
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="Upcoming tasks"
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link href="/tasks">
                <ActionIcon action="view" />
                View tasks
                
              </Link>
            </Button>
          }
        >
          {data.tasks
            .filter((t) => !t.completed)
            .slice(0, 3)
            .map((t) => (
              <Link
                href={t.leadId ? `/leads/${t.leadId}` : "/tasks"}
                key={t.id}
                className="flex items-center gap-3 border-b px-5 py-4 last:border-0"
              >
                <span className="size-3.5 rounded border" />
                <span className="flex-1 text-sm">{t.title}</span>
                <span className="text-[10px] text-muted-foreground">
                  {format(t.dueAt)}
                </span>
              </Link>
            ))}
          {!data.tasks.some((t) => !t.completed) && (
            <EmptyState
              title="All tasks complete"
              description="Add reminders from the Tasks page."
            />
          )}
        </Panel>
        <Panel
          title="Needs attention"
          action={
            <span className="rounded bg-muted px-2 py-1 text-[10px]">
              {attention.length}
            </span>
          }
        >
          {attention.slice(0, 3).map((l) => (
            <Link
              href={`/follow-ups?lead=${encodeURIComponent(l.id)}`}
              key={l.id}
              className="flex items-center justify-between gap-3 border-b px-5 py-4 last:border-0"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <PersonAvatar name={l.name} email={l.email} photoUrl={l.photoUrl} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{l.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Follow-up{" "}
                    {l.followUpState === "Reserved"
                      ? "being prepared — check delivery before trying again"
                      : "delivery needs review"}
                  </p>
                </div>
              </div>
              <ActionIcon action="view" className="text-muted-foreground" />
            </Link>
          ))}
          {!attention.length && (
            <EmptyState
              title="Everything looks clear"
              description="Follow-up issues will appear here."
            />
          )}
        </Panel>
      </div>
      <LeadForm open={create} onOpenChange={setCreate} />
    </div>
  );
}
