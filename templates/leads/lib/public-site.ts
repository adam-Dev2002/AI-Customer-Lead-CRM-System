import { customerSiteOrigin } from './auth/customer-site.ts';

export const publicInformationLinks = [
  { href: '/about', label: 'About CustomerLead' },
  { href: '/privacy', label: 'Privacy policy' },
  { href: '/terms', label: 'Terms of service' },
] as const;

// Only these exact informational routes bypass workspace authentication.
export function isPublicInformationPage(pathname: string) {
  return publicInformationLinks.some(link => link.href === pathname);
}

export function publicSiteConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const operatorName = (env.CRM_PUBLIC_OPERATOR_NAME || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160);
  const candidate = (env.CRM_PUBLIC_SUPPORT_EMAIL || '').trim();
  // Published contact details must be explicitly supplied. Never derive them
  // from a tenant, an account email, private config, or a Google credential.
  const supportEmail = candidate.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(candidate) ? candidate : '';
  return {
    name: 'CustomerLead CRM',
    origin: customerSiteOrigin,
    operatorName,
    supportEmail,
    contactComplete: Boolean(operatorName && supportEmail),
    updated: '25 October 2026',
  };
}

export type PublicSite = ReturnType<typeof publicSiteConfiguration>;
