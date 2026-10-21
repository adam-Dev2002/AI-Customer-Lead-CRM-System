"use client";
import { useEffect } from "react";
import { useCRM } from "./provider";
import { businessLogo, defaultBusinessLogo } from "@/lib/crm/business-logo";

export function WorkspaceBranding() {
  const { data } = useCRM();
  const logo = businessLogo(data.settings.businessLogo);
  useEffect(() => {
    const icons = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]');
    icons.forEach(icon => { icon.href = logo || defaultBusinessLogo; icon.type = logo ? "image/webp" : "image/png"; icon.removeAttribute("sizes"); });
  }, [logo]);
  return null;
}
