import { dateFormatter } from "./date-format.ts";

export function matchesPeriod(value: string, period: string, timezone: string, now = new Date()) {
  if (!["today", "month", "week", "30days"].includes(period)) return true;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() > now.getTime()) return false;
  if (period === "week" || period === "30days")
    return date.getTime() >= now.getTime() - (period === "week" ? 7 : 30) * 86400000;
  const formatter = dateFormatter("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const key = (day: Date) => formatter.format(day);
  return period === "today" ? key(date) === key(now) : key(date).slice(0, 7) === key(now).slice(0, 7);
}

