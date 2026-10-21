import { isEmailAddress, normalizeEmail } from "./email-address.ts";

// Shared mail and delivery services identify the provider, not the sender's business.
const sharedMailDomains = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "rocketmail.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "mail.com",
  "gmx.com",
  "gmx.net",
  "fastmail.com",
  "hey.com",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
  "qq.com",
  "163.com",
  "126.com",
  "sendgrid.net",
  "amazonses.com",
  "mandrillapp.com",
  "mailchimpapp.net",
  "wixemails.com",
  "onmicrosoft.com",
  "example.com",
  "example.net",
  "example.org",
]);
const privateSuffixes = new Set([
  "localhost",
  "local",
  "internal",
  "invalid",
  "test",
  "example",
  "onion",
  "arpa",
  "alt",
  "lan",
  "home",
]);

export function companyLogoDomain(value: string): string {
  const domain = value.trim().toLowerCase();
  if (domain.length > 253 || !domain.includes(".")) return "";
  const labels = domain.split(".");
  if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return "";
  const suffix = labels[labels.length - 1];
  if (privateSuffixes.has(suffix) || !/^(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/.test(suffix)) return "";
  if (labels.some((_, index) => sharedMailDomains.has(labels.slice(index).join(".")))) return "";
  // Regional versions of the major shared inbox providers are not company identities either.
  if (
    /^(?:[^.]+\.)*(?:yahoo|hotmail|outlook|live|gmx)\.(?:[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(
      domain,
    )
  )
    return "";
  return domain;
}

export function senderCompanyDomain(email: string): string {
  const normalized = normalizeEmail(email);
  return isEmailAddress(normalized) ? companyLogoDomain(normalized.split("@")[1]) : "";
}

export function senderLogoUrl(email: string): string {
  const domain = senderCompanyDomain(email);
  return domain ? `/api/crm/company-logo?domain=${encodeURIComponent(domain)}` : "";
}
