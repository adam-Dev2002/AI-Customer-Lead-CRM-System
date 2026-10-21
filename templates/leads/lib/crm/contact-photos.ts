import type { Lead } from "./types";

export function contactEmail(value = "") {
  return value.trim().toLowerCase();
}

// Photos come from a trusted integration, never from an email's HTML body.
export function safePhotoUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return "";
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!host.includes(".") || host.endsWith(".localhost") || host.endsWith(".local") ||
      host.includes(":") || /^[\d.]+$/.test(host)) return "";
    return url.href;
  } catch {
    return "";
  }
}

export function personInitials(name: string, email = "") {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = words.length > 1
    ? Array.from(words[0])[0] + Array.from(words[words.length - 1])[0]
    : Array.from(words[0] || email.trim())[0];
  return (initials || "?").toLocaleUpperCase();
}

export function savedContactPhotos(leads: Pick<Lead, "email" | "photoUrl" | "updatedAt">[]) {
  const photos: Record<string, string> = {};
  for (const lead of [...leads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const email = contactEmail(lead.email), photo = safePhotoUrl(lead.photoUrl);
    if (email && photo && !photos[email]) photos[email] = photo;
  }
  return photos;
}
