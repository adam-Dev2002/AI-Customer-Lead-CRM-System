import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, Mail } from 'lucide-react';
import { BrandLogo } from '@/components/crm/brand-logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { PublicLinks } from './public-links';
import type { PublicSite } from '@/lib/public-site';

export function PublicShell({ site, children }: { site: PublicSite; children: ReactNode }) {
  return <div className="relative flex min-h-svh flex-col overflow-x-clip bg-sidebar">
    <a href="#public-content" className="sr-only z-50 rounded-md bg-card px-4 py-3 text-sm text-primary focus:not-sr-only focus:absolute focus:left-4 focus:top-4">Skip to content</a>
    <div aria-hidden="true" className="pointer-events-none absolute -left-48 -top-56 size-[40rem] rounded-full bg-primary/10 blur-3xl" />
    <header className="relative border-b bg-card/85">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <Link href="/about" className="flex items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
          <BrandLogo generic /><span><span className="block text-sm font-semibold">{site.name}</span><span className="block text-xs text-muted-foreground">Support & leads</span></span>
        </Link>
        <PublicLinks label="Public pages" className="order-3 w-full border-t pt-4 sm:order-none sm:ml-auto sm:w-auto sm:border-0 sm:pt-0" />
        <div className="ml-auto flex items-center gap-2 sm:ml-2 sm:gap-3"><ThemeToggle /><Button asChild size="sm"><Link href="/login">Sign in<ArrowRight aria-hidden="true" /></Link></Button></div>
      </div>
    </header>
    <main id="public-content" className="relative mx-auto w-full max-w-6xl flex-1 px-5 py-10 sm:px-8 sm:py-14">
      {!site.contactComplete && <div role="note" className="mb-8 rounded-xl border bg-card px-4 py-3 text-xs leading-6 text-muted-foreground"><span className="font-medium text-foreground">Public preview.</span> The privacy policy and terms are drafts. Operator and public support contact details are being finalized.</div>}
      {children}
    </main>
    <footer className="relative border-t bg-card">
      <div className="mx-auto flex max-w-6xl flex-col justify-between gap-5 px-5 py-7 sm:px-8 md:flex-row md:items-center">
        <div><p className="text-sm font-medium">{site.name}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{site.operatorName ? `Operated by ${site.operatorName}.` : 'A workspace for customer inquiries, replies and follow-ups.'}</p></div>
        <div className="space-y-3"><PublicLinks label="Footer information" />{site.supportEmail && <a className="inline-flex items-center gap-2 break-all text-xs text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring" href={`mailto:${site.supportEmail}`}><Mail aria-hidden="true" className="size-3.5 shrink-0" />{site.supportEmail}</a>}</div>
      </div>
    </footer>
  </div>;
}
