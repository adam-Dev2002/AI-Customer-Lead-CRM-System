import { cloudRPC } from '../crm/cloud-store.ts';
import { ConnectionError, openConnection, sealConnection, type ConnectionConfig } from './config.ts';
export interface GoogleToken { access_token: string; refresh_token: string; expires_at: number; scope: string; token_type: string }
export interface BusinessConnection {
  version: 1; id: string; userId: string; businessName: string;
  phase: 'authorizing' | 'setting-up' | 'ready' | 'active' | 'paused' | 'attention';
  oauth?: { hash: string; verifier: string; expires: number };
  google?: GoogleToken; email?: string; labelsReady?: boolean;
  spreadsheetId?: string; gmailCredentialId?: string; sheetsCredentialId?: string;
  crmToken?: string; crmCredentialId?: string; tokenRegistered?: boolean;
  workflowId?: string; formId?: string; verifiedAt?: string;
  pending?: { operation: string; startedAt: string; jobId?: string }; error?: string;
}
export type ConnectionRecord = { revision: number; data: BusinessConnection | null };
export interface ConnectionRepository { read(): Promise<ConnectionRecord>; save(record: ConnectionRecord, data: BusinessConnection): Promise<ConnectionRecord> }
export function connectionRepository(workspace: string, config: ConnectionConfig): ConnectionRepository {
  return {
    async read() {
      const row = await cloudRPC('crm_connection_read', { p_workspace_id: workspace });
      if (!row || !Number.isSafeInteger(row.revision)) throw new ConnectionError('setup-unavailable');
      return { revision: row.revision, data: row.payload ? openConnection<BusinessConnection>(row.payload, workspace, config.encryptionKey) : null };
    },
    async save(record, data) {
      const result = await cloudRPC('crm_connection_save', { p_workspace_id: workspace, p_revision: record.revision, p_payload: sealConnection(data, workspace, config.encryptionKey) });
      if (!result?.applied || !Number.isSafeInteger(result.revision)) throw new ConnectionError('connection-busy');
      return { revision: result.revision, data };
    },
  };
}
export function nextConnectionStep(data: BusinessConnection) {
  if (!data.google || !data.email) return 'google';
  if (!data.labelsReady) return 'labels';
  if (!data.spreadsheetId) return 'spreadsheet';
  if (!data.gmailCredentialId) return 'gmail-credential';
  if (!data.sheetsCredentialId) return 'sheets-credential';
  if (!data.crmCredentialId) return 'crm-credential';
  if (!data.tokenRegistered) return 'register';
  if (!data.workflowId) return 'workflow';
  if (!data.verifiedAt) return 'verify';
  return 'complete';
}
