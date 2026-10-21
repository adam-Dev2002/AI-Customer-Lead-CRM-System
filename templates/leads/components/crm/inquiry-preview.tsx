import Link from "next/link";
import { Sparkles } from "lucide-react";
import type { Lead } from "@/lib/crm/types";
import { inquiryPreview } from "@/lib/crm/inquiry-preview";
import { cn } from "@/lib/utils";

export function InquiryPreview({ lead, compact = false, href }: { lead: Lead; compact?: boolean; href?: string }) {
  const preview = inquiryPreview(lead);
  return <div data-inquiry-preview className="min-w-0 space-y-1.5 whitespace-normal break-words [overflow-wrap:anywhere]">
    <p className="text-xs font-medium leading-5 text-foreground">{preview.title}</p>
    {preview.text && <p className={cn("text-xs leading-5 text-muted-foreground", compact ? "line-clamp-2" : "line-clamp-3")}>{preview.text}</p>}
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
      {preview.isSummary && <span className="inline-flex items-center gap-1 text-muted-foreground"><Sparkles className="size-3" aria-hidden="true" />AI summary</span>}
      {href && <Link href={href} className="font-medium text-primary underline-offset-2 hover:underline">Read inquiry<span className="sr-only"> from {lead.name}</span></Link>}
    </div>
  </div>;
}
