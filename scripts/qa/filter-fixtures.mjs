// Isolated fixtures only. Never install these records in the real workspace.
export const followUpExpected = {
  all: ["draft-due", "draft-future", "approved-due", "approved-future", "changed-recipient", "changed-time", "withdrawn", "no-permission", "reserved", "sent", "cancelled", "unscheduled", "uncertain"],
  due: ["draft-due", "approved-due", "changed-recipient", "changed-time", "withdrawn", "no-permission"],
  review: ["draft-due", "draft-future", "changed-recipient", "changed-time", "withdrawn", "no-permission"],
  attention: ["reserved", "uncertain"],
  Pending: ["draft-due", "draft-future", "approved-due", "approved-future", "changed-recipient", "changed-time", "withdrawn", "no-permission"],
  Reserved: ["reserved"], Sent: ["sent"], Skipped: ["cancelled", "unscheduled"], "Needs Review": ["uncertain"],
};

export function followUpFilterFixtures(template, now = Date.now()) {
  const past = new Date(now - 3600000).toISOString(), future = new Date(now + 3600000).toISOString();
  return followUpExpected.all.map(id => {
    const lead = { ...template, id, name: `Filter ${id}`, email: `${id}@example.com`, service: "Filter QA", photoUrl: undefined,
      followUpState: "Pending", followUpDue: id.endsWith("future") ? future : past, followUpSentAt: "", followUpEmail: undefined };
    if (["approved-due", "approved-future", "changed-recipient", "changed-time", "withdrawn"].includes(id))
      lead.followUpEmail = { subject: "Reviewed follow-up", body: "Please let us know if you still need our help.", revision: 2, updatedAt: past,
        approvedAt: id === "withdrawn" ? "" : past, approvedTo: id === "changed-recipient" ? "previous@example.com" : lead.email,
        approvedDue: id === "changed-time" ? future : lead.followUpDue };
    if (id === "no-permission") lead.consent = false;
    const states = { reserved: "Reserved", sent: "Sent", cancelled: "Skipped", unscheduled: "Skipped", uncertain: "Needs Review" };
    if (states[id]) lead.followUpState = states[id];
    if (id === "unscheduled") lead.followUpDue = "";
    if (id === "sent") lead.followUpSentAt = past;
    return lead;
  });
}
