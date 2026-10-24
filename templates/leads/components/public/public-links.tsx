import Link from 'next/link';
import { publicInformationLinks } from '@/lib/public-site';
import { cn } from '@/lib/utils';

export function PublicLinks({ className, label = 'Product information' }: { className?: string; label?: string }) {
  return <nav aria-label={label} className={cn('flex flex-wrap gap-x-5 gap-y-3 text-xs text-muted-foreground', className)}>
    {publicInformationLinks.map(link => <Link key={link.href} href={link.href} className="rounded-sm underline-offset-4 hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">{link.label}</Link>)}
  </nav>;
}
