import { dateFormatter } from "./date-format.ts";

export function inquiryGrowth(
  leads: readonly { createdAt: string }[],
  days: number,
  timezone: string,
  now = Date.now(),
) {
  const key = dateFormatter("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const label = dateFormatter("en", {
    timeZone: timezone, month: "short", day: "numeric",
  });
  const counts = new Map<string, number>();
  for (const lead of leads) {
    const date = new Date(lead.createdAt);
    if (!Number.isFinite(date.getTime())) continue;
    const day = key.format(date);
    counts.set(day, (counts.get(day) || 0) + 1);
  }
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(now - (days - 1 - index) * 86400000);
    return { day: label.format(day), leads: counts.get(key.format(day)) || 0 };
  });
}
