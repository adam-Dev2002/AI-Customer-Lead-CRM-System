export const defaultBusinessLogo = "/brand/clearflow-plumbing.png";
export const maximumLogoBytes = 2 * 1024 * 1024;
export const maximumSavedLogoLength = 400_000;
export const logoContentTypes = ["image/png", "image/jpeg", "image/webp"] as const;

export function businessLogo(value: unknown): string {
  return typeof value === "string" && value.length <= maximumSavedLogoLength && /^data:image\/webp;base64,UklGR[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : "";
}
