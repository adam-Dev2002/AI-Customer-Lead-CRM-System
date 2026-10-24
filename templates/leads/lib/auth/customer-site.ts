// These older public projects share the repo but do not have the selected CRM's
// complete Production settings. Send browser pages to the chosen public site.
export const customerSiteOrigin = 'https://ai-customer-lead-crm-system-oyh1.vercel.app';
const previousHosts = new Set([
  'ai-customer-lead-crm-system.vercel.app',
  'ai-customer-lead-crm-system-1hmk.vercel.app',
]);

export function customerPageRedirect(url: URL, host: string | null, method = 'GET') {
  if (!['GET', 'HEAD'].includes(method) || /^\/(?:api|_next)(?:\/|$)/.test(url.pathname)) return null;
  try {
    const authority = new URL('https://' + (host || url.host));
    if (authority.username || authority.password || authority.pathname !== '/' || authority.search || authority.hash || !previousHosts.has(authority.hostname)) return null;
    const destination = new URL(customerSiteOrigin);
    // Set fields individually: a path beginning // must never become a new host.
    destination.pathname = url.pathname;
    destination.search = url.search;
    return destination;
  } catch { return null; }
}
