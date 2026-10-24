import template from './workflow-template.json' with { type: 'json' };
import { createHash } from 'node:crypto';
import { ConnectionError, type ConnectionConfig } from './config.ts';
import type { BusinessConnection } from './store.ts';
import { addInboxReporting } from './workflow-inbox.mjs';
export const leadHeaders = template.leadHeaders;
export const reviewHeaders = template.reviewHeaders;
// JSON is generated from reviewed source. Parameters retain n8n's heterogeneous
// schema; all customer-provided values below are inert Set-node data, never JS.
type Node = { id: string; name: string; type: string; parameters: Record<string, any>; webhookId?: string; credentials?: Record<string, { id: string; name: string }> };
export function businessFormId(workspace: string) {
  const h = createHash('sha256').update('customerlead-self-service-form:' + workspace).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function provisionedWorkflow(data: BusinessConnection, workspace: string, config: ConnectionConfig, reporting = true) {
  if (!data.email || !data.spreadsheetId || !data.gmailCredentialId || !data.sheetsCredentialId || !data.crmCredentialId) throw new ConnectionError('not-ready');
  const workflow = structuredClone(template.workflow), nodes = workflow.nodes as Node[];
  const settings = nodes.find(n => n.name === 'Business connection')!.parameters.assignments.assignments;
  const values: Record<string, string> = { businessEmail: data.email, workspaceId: workspace, crmBaseUrl: config.origin, spreadsheetId: data.spreadsheetId, geminiModel: config.geminiModel };
  for (const setting of settings) if (values[setting.name]) setting.value = values[setting.name];
  const ids = { gmail: data.gmailCredentialId, sheets: data.sheetsCredentialId, crm: data.crmCredentialId, gemini: config.geminiCredentialId };
  for (const binding of template.roles) {
    const node = nodes.find(n => n.name === binding.node)!;
    node.credentials = { ...node.credentials, [binding.type]: { id: ids[binding.role as keyof typeof ids], name: 'CustomerLead ' + binding.role } };
  }
  if (reporting) addInboxReporting(workflow, data.crmCredentialId);
  for (const node of nodes) {
    if (node.type.endsWith('.formTrigger')) node.webhookId = businessFormId(workspace);
    if (typeof node.parameters.url === 'string') node.parameters.url = node.parameters.url.replaceAll('https://crm.example.invalid', config.origin);
    const assignments = node.parameters.assignments?.assignments;
    if (Array.isArray(assignments)) for (const setting of assignments) {
      if (setting.name === 'owner_email') setting.value = data.email;
      if (setting.name === 'business_name') setting.value = data.businessName;
    }
  }
  return { name: 'CustomerLead business ' + workspace, nodes, connections: workflow.connections, settings: workflow.settings };
}
