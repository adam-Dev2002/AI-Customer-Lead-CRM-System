import Image from "next/image";
import { businessLogo, defaultBusinessLogo } from "@/lib/crm/business-logo";
import { cn } from "@/lib/utils";

export function BrandLogo({ logo, className }: { logo?: string; className?: string }) {
  const customLogo = businessLogo(logo);
  return (
    <span data-brand-logo aria-hidden="true" className={cn("relative block size-9 shrink-0 overflow-hidden rounded-lg bg-white ring-1 ring-black/5", className)}>
      <Image
        src={customLogo || defaultBusinessLogo}
        alt=""
        width={customLogo ? 256 : 1254}
        height={customLogo ? 256 : 1254}
        sizes="50px"
        className={customLogo ? "size-full object-contain p-0.5" : "absolute left-[-19%] top-0 h-auto w-[138%] max-w-none"}
        priority
      />
    </span>
  );
}
