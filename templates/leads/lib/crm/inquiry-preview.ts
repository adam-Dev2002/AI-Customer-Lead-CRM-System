import type { Lead } from "./types.ts";

const entities: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", ndash: "–", mdash: "—", hellip: "…" };
export function inquiryText(value: string | undefined) {
  return (value || "").replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] !== "#") return entities[code.toLowerCase()] ?? entity;
    const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return point >= 32 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
  }).replace(/\s+/g, " ").trim();
}

/** Reuse the saved summary. Rendering a preview never calls AI or alters the inquiry. */
export function inquiryPreview(lead: Pick<Lead, "service" | "message" | "summary">) {
  const title = inquiryText(lead.service), message = inquiryText(lead.message), summary = inquiryText(lead.summary);
  const isSummary = !!summary && (!message || message.length > 180) && summary !== message && summary !== title;
  const text = isSummary ? summary : message;
  return { title: title || "Customer inquiry", text: text === title ? "" : text, isSummary };
}
