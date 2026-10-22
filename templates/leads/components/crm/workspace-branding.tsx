"use client";
import { useEffect } from "react";
import { useCRM } from "./provider";
import { businessLogo, defaultBusinessLogo } from "@/lib/crm/business-logo";

export function WorkspaceBranding() {
  const { data } = useCRM();
  const logo = businessLogo(data.settings.businessLogo);
  const fallback = data.settings.brandPreset === "generic" ? "/brand/customerlead.svg" : defaultBusinessLogo;
  useEffect(() => {
    const icons = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]');
    icons.forEach(icon => { icon.href = logo || fallback; icon.type = logo ? "image/webp" : fallback.endsWith("svg") ? "image/svg+xml" : "image/png"; icon.removeAttribute("sizes"); });
  }, [logo, fallback]);
  return null;
}
