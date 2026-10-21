// Pure patch: retain the complete live graph, IDs, credential references and
// report-sending support. Only the follow-up claim and email fields change.
export const approvedFollowUpClaim = "={{ {action:'claim',leadId:$json.Lead_ID,email:$json.Email,followUpDue:$json.Follow_Up_Due_UTC,executionId:$execution.id,capabilities:['approved-followups-v1']} }}";
export const approvedFollowUpFields = {
  sendTo: "={{ $('Claim consented follow-up').item.json.email }}",
  subject: "={{ $('Claim consented follow-up').item.json.subject }}",
  message: "={{ $('Claim consented follow-up').item.json.body }}",
};
export function installFollowUpReview(workflow) {
  const claim = workflow.nodes.find(node => node.name === "Claim consented follow-up");
  const send = workflow.nodes.find(node => node.name === "GMAIL — Send Consented Follow-Up");
  if (!claim || !send || !claim.parameters.url.endsWith("/api/n8n/followups") || send.parameters.emailType !== "text")
    throw Error("The expected atomic follow-up sender was not found.");
  claim.parameters.jsonBody = approvedFollowUpClaim;
  Object.assign(send.parameters, approvedFollowUpFields);
  return workflow;
}
