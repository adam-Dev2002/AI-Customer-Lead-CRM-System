import { LeadDetailPage } from "@/components/crm/lead-detail-page";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LeadDetailPage id={id} />;
}
