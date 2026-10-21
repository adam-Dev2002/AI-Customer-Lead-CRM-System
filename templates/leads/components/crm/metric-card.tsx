import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type CRMTone = "violet" | "blue" | "emerald" | "amber" | "rose" | "neutral";

export function MetricCard({
  title, value, icon: Icon, tone = "violet", description, descriptionId,
  href, onClick, pressed, className,
}: {
  title: string;
  value: number | string;
  icon: LucideIcon;
  tone?: CRMTone;
  description?: string;
  descriptionId?: string;
  href?: string;
  onClick?: () => void;
  pressed?: boolean;
  className?: string;
}) {
  const classes = cn(
    "crm-stat-card min-w-0 rounded-xl border p-4 text-left sm:p-5",
    (href || onClick) && "crm-stat-action",
    className,
  );
  const content = <>
    <div className="flex min-h-9 items-start justify-between gap-3">
      <p className="min-w-0 pt-1 text-xs font-medium leading-5 text-muted-foreground">{title}</p>
      <span className="crm-stat-icon flex size-9 shrink-0 items-center justify-center rounded-xl">
        <Icon className="size-4" aria-hidden="true" />
      </span>
    </div>
    <p className="crm-stat-value mt-3 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
    {description && <p id={descriptionId} className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p>}
  </>;

  if (href) return <Link href={href} data-tone={tone} className={classes}>{content}</Link>;
  if (onClick) return <button type="button" data-tone={tone} className={classes}
    aria-label={`${title} ${value}`} aria-pressed={pressed}
    aria-describedby={descriptionId} onClick={onClick}>{content}</button>;
  return <div data-tone={tone} className={classes}>{content}</div>;
}
