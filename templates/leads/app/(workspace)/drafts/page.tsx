import { redirect } from "next/navigation";
import { inboxHref } from "@/lib/crm/inbox-navigation";

// Preserve bookmarks and older activity links after combining reply review with Inbox.
export default async function LegacyDraftsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  redirect(
    inboxHref(
      "replies",
      typeof params.lead === "string" ? params.lead : undefined,
      typeof params.draft === "string" ? params.draft : undefined,
    ),
  );
}
