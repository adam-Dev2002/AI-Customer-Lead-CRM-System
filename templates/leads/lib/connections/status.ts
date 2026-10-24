export interface PublicConnectionStatus {
  available: boolean; owner: boolean; managed: boolean;
  phase: 'not-connected' | 'authorizing' | 'setting-up' | 'ready' | 'active' | 'paused' | 'attention' | 'unavailable';
  step: string; email: string; spreadsheetUrl: string; message: string;
  pending: boolean; canRetry: boolean;
  workerOnline?: boolean;
}
export function oauthResultMessage(code: string | null) {
  if (!code) return '';
  if (code === 'google-denied') return 'Google access was not approved. Choose Connect Google to try again.';
  if (code === 'google-permissions') return 'Approve the requested Gmail and spreadsheet permissions to finish connecting.';
  if (code === 'oauth-invalid') return 'This connection link expired or was already used. Choose Connect Google to start again.';
  return 'Google connection setup could not finish. Please try again or contact support.';
}
