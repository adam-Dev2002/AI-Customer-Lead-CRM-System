export type InquiryFormLink = { url: string; access: "local" | "network" | "public" };

export function inquiryFormLink(value: unknown): InquiryFormLink | null {
  if (typeof value !== "string" || value.length > 2048 || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    const local = host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "0.0.0.0" || /^127\./.test(host);
    const network = /^10\.|^192\.168\.|^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
      || /^(fc|fd)[0-9a-f]{2}:|^fe[89ab][0-9a-f]:/i.test(host)
      || /\.(local|lan|internal|test|invalid)$/.test(host) || !host.includes(".") && !host.includes(":");
    return { url: url.href, access: local ? "local" : network ? "network" : "public" };
  } catch { return null; }
}
