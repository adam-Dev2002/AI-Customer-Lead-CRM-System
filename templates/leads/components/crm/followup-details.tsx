"use client";

import { useCRM } from "./provider";
import { EmptyState, Modal } from "./shared";
import { FollowUpEditor } from "./followup-editor";

export function FollowUpDetails({ leadId, onClose }: { leadId: string | null; onClose: () => void }) {
  const { data } = useCRM();
  const lead = data.leads.find(item => item.id === leadId);
  return <Modal open={!!leadId} onOpenChange={open => { if (!open) onClose(); }} title="Follow-up details" description="Preview the email, record permission, schedule and approve this follow-up here." wide>
    {lead ? <FollowUpEditor key={lead.id} leadId={lead.id} onClose={onClose} /> : <EmptyState title="Follow-up unavailable" description="This inquiry may have been removed. Close this view and refresh the list." />}
  </Modal>;
}
