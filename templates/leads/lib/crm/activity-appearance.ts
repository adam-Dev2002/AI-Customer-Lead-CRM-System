import { activityCopy } from "./customer-copy.ts";
import type { Activity } from "./types.ts";

export type ActivityTone = "blue" | "emerald" | "amber" | "violet" | "rose";

// Use the recorded outcome first. Older entries also have recognizable titles
// but no status; their colors must survive the customer-facing copy rewrite.
export function activityAppearance(activity: Activity) {
  const { title, status, type } = activity;
  let tone: ActivityTone;
  if (status === "failed") tone = "rose";
  else if (status === "skipped") tone = "amber";
  else if (status === "running") tone = "blue";
  else if (status === "success") tone = "emerald";
  else if (/^Automation execution failed$|^n8n update .*failed$|delivery needs review$/i.test(title)) tone = "rose";
  else if (/^Email screened out$|^Email skipped$|^Form inquiry not captured$|\b(cancelled|withdrawn)\b/i.test(title)) tone = "amber";
  else if (/\b(queued|reserved)\b/i.test(title)) tone = "blue";
  else if (/\b(saved|approved|completed|sent)\b/i.test(title) || /^n8n update /i.test(title)) tone = "emerald";
  else if (type === "draft" || type === "settings") tone = "violet";
  else if (type === "followup") tone = "amber";
  else tone = "blue";
  return { ...activityCopy(activity), tone };
}
