import type { ReactNode } from 'react';
import { FileText, ShieldCheck } from 'lucide-react';
import type { PublicSite } from '@/lib/public-site';

export type PolicySection = { id: string; title: string; content: ReactNode };
export const publicTextLink = 'break-words text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

export function PolicyPage({ site, kind, title, description, sections }: { site: PublicSite; kind: 'privacy' | 'terms'; title: string; description: string; sections: PolicySection[] }) {
  const Icon = kind === 'privacy' ? ShieldCheck : FileText;
  return <>
    <div className="mb-9 max-w-2xl"><span className="mb-5 inline-flex size-11 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 text-primary"><Icon aria-hidden="true" className="size-5" /></span><p className="mb-2 text-xs font-medium uppercase tracking-widest text-primary">{site.contactComplete ? 'CustomerLead CRM' : 'Draft for review'}</p><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1><p className="mt-4 text-sm leading-7 text-muted-foreground">{description}</p><p className="mt-4 text-xs text-muted-foreground">{site.contactComplete ? 'Last updated' : 'Draft prepared'} {site.updated}</p></div>
    <div className="grid items-start gap-6 lg:grid-cols-[14rem_1fr]">
      <nav aria-label="On this page" className="rounded-xl border bg-card p-5 lg:sticky lg:top-6"><p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">On this page</p><ol className="space-y-3">{sections.map((section, index) => <li key={section.id}><a href={`#${section.id}`} className="flex gap-2 text-sm leading-6 text-muted-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"><span className="w-5 shrink-0 text-xs leading-6 text-primary">{String(index + 1).padStart(2, '0')}</span>{section.title}</a></li>)}</ol></nav>
      <article className="min-w-0 divide-y overflow-hidden rounded-2xl border bg-card shadow-xl shadow-primary/5">{sections.map(section => <section key={section.id} id={section.id} className="scroll-mt-6 p-6 sm:p-8"><h2 className="mb-4 text-lg font-semibold tracking-tight">{section.title}</h2><div className="space-y-4 text-sm leading-7 text-muted-foreground [&_li]:pl-1 [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">{section.content}</div></section>)}</article>
    </div>
  </>;
}

export function PolicyContact({ site }: { site: PublicSite }) {
  return <><p>{site.operatorName ? `${site.name} is operated by ${site.operatorName}.` : 'The operator’s public identity is being finalized for this preview.'}</p>{site.supportEmail ? <p>For support, privacy questions, access, correction, export or deletion requests, email <a className={publicTextLink} href={`mailto:${site.supportEmail}`}>{site.supportEmail}</a>. Include your workspace name and request, and avoid sending passwords, access tokens or unnecessary customer information. We need to verify that you are authorized to make the request.</p> : <p>A public support and privacy-request email has not been published yet. Existing users can contact the person who provided their workspace access. These draft pages should not be treated as a completed public-launch policy.</p>}</>;
}
