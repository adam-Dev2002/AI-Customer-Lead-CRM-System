import { Users, FileText, Clock3, CheckSquare, Settings, Workflow } from "lucide-react";
import type { ActivityTone } from "@/lib/crm/activity-appearance";
import type { Activity } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

export const activityIcons = {
  lead: Users,
  draft: FileText,
  followup: Clock3,
  task: CheckSquare,
  settings: Settings,
  automation: Workflow,
};

export const activityColors = {
  blue: {
    text: "text-blue-700 dark:text-blue-300",
    mark: "border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300",
    dot: "bg-blue-500 dark:bg-blue-400",
  },
  emerald: {
    text: "text-emerald-700 dark:text-emerald-300",
    mark: "border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
    dot: "bg-emerald-500 dark:bg-emerald-400",
  },
  amber: {
    text: "text-amber-800 dark:text-amber-300",
    mark: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
    dot: "bg-amber-500 dark:bg-amber-400",
  },
  violet: {
    text: "text-violet-700 dark:text-violet-300",
    mark: "border-violet-200 bg-violet-50 text-violet-600 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300",
    dot: "bg-violet-500 dark:bg-violet-400",
  },
  rose: {
    text: "text-rose-700 dark:text-rose-300",
    mark: "border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300",
    dot: "bg-rose-500 dark:bg-rose-400",
  },
} satisfies Record<ActivityTone, { text: string; mark: string; dot: string }>;

export function ActivityMark({ type, tone, className }: {
  type: Activity["type"];
  tone: ActivityTone;
  className?: string;
}) {
  const Icon = activityIcons[type];
  return (
    <span aria-hidden="true" className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg border", activityColors[tone].mark, className)}>
      <Icon className="size-4 text-current" />
    </span>
  );
}
