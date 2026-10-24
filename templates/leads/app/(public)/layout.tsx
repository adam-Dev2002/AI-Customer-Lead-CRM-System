import type { Metadata } from 'next';
import { PublicShell } from '@/components/public/public-shell';
import { publicSiteConfiguration } from '@/lib/public-site';

export function generateMetadata(): Metadata {
  const site = publicSiteConfiguration();
  return {
    metadataBase: new URL(site.origin),
    title: { default: site.name, template: `%s | ${site.name}` },
    description: 'Organize customer inquiries, review suggested replies and manage follow-ups in your business workspace.',
    icons: { icon: [{ url: '/brand/customerlead.svg', type: 'image/svg+xml' }] },
    robots: { index: site.contactComplete, follow: true },
  };
}

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell site={publicSiteConfiguration()}>{children}</PublicShell>;
}
