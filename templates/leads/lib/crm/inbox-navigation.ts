export const inboxViews = ["inquiries", "replies", "outgoing"] as const;
export type InboxView = (typeof inboxViews)[number];

export function readInboxView(value: string | null): InboxView {
  return inboxViews.find((view) => view === value) || "inquiries";
}

export function inboxHref(
  view: InboxView = "inquiries",
  leadId?: string | null,
  draftId?: string | null,
): string {
  const params = new URLSearchParams();
  if (view !== "inquiries") params.set("view", view);
  if (leadId) params.set("lead", leadId);
  if (draftId) params.set("draft", draftId);
  const search = params.toString();
  return `/inbox${search ? `?${search}` : ""}`;
}
