import sharp from "sharp";
import { parse } from "tldts";
import { companyLogoDomain } from "./sender-logo.ts";

const maximumImageBytes = 128 * 1024;
const day = 24 * 60 * 60 * 1000;

export function companyWebsiteDomain(senderDomain: string): string {
  const domain = companyLogoDomain(senderDomain);
  if (!domain) return "";
  const parsed = parse(domain, { allowPrivateDomains: true, detectSpecialUse: true });
  if (parsed.isIp || parsed.isSpecialUse || (!parsed.isIcann && !parsed.isPrivate)) return "";
  return companyLogoDomain(parsed.domain || "");
}

async function readIcon(response: Response): Promise<Buffer | null> {
  // Missing icons return a generic globe with HTTP 404. Never show it as a company logo.
  if (
    !response.ok ||
    response.headers.get("content-type")?.split(";")[0] !== "image/png" ||
    Number(response.headers.get("content-length")) > maximumImageBytes
  ) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumImageBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const input = Buffer.concat(chunks);
  if (!input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null;
  const image = sharp(input, { limitInputPixels: 1_048_576, failOn: "warning" });
  const metadata = await image.metadata();
  if (metadata.format !== "png" || (metadata.pages || 1) !== 1) return null;
  return image
    .rotate()
    .resize(64, 64, { fit: "inside", withoutEnlargement: true })
    .webp({ lossless: true })
    .toBuffer();
}

export function createCompanyLogoReader(request: typeof fetch = fetch, now = Date.now) {
  const cache = new Map<string, { image: Buffer | null; expiresAt: number }>();
  const pending = new Map<string, Promise<Buffer | null>>();

  return async function readCompanyLogo(senderDomain: string): Promise<Buffer | null> {
    const domain = companyWebsiteDomain(senderDomain);
    if (!domain) return null;
    const cached = cache.get(domain);
    if (cached && cached.expiresAt > now()) {
      cache.delete(domain);
      cache.set(domain, cached);
      return cached.image;
    }
    const inFlight = pending.get(domain);
    if (inFlight) return inFlight;
    if (pending.size >= 32) return null;

    const task = (async () => {
      let image: Buffer | null = null;
      try {
        // Fixed Google origin: never fetch a sender-controlled URL, email HTML or tracking pixel.
        // Only the public website domain is sent; no email address, message or OAuth token.
        const signal = AbortSignal.timeout(5000);
        for (const host of [domain, `www.${domain}`]) {
          const url = new URL("https://t3.gstatic.com/faviconV2");
          url.search = new URLSearchParams({
            client: "SOCIAL",
            type: "FAVICON",
            fallback_opts: "TYPE,SIZE,URL",
            url: `https://${host}`,
            size: "64",
          }).toString();
          const response = await request(url, {
            redirect: "error",
            credentials: "omit",
            cache: "no-store",
            signal,
          });
          image = await readIcon(response);
          // Some businesses publish their icon only on their www homepage.
          if (image || response.status !== 404) break;
        }
      } catch {
        /* An unavailable company icon must not prevent reading the inquiry. */
      }
      cache.delete(domain);
      cache.set(domain, { image, expiresAt: now() + (image ? day : 5 * 60 * 1000) });
      if (cache.size > 500) cache.delete(cache.keys().next().value!);
      return image;
    })();
    pending.set(domain, task);
    try {
      return await task;
    } finally {
      pending.delete(domain);
    }
  };
}

const state = globalThis as typeof globalThis & {
  __crmCompanyLogosV1?: ReturnType<typeof createCompanyLogoReader>;
};
export const readCompanyLogo = (state.__crmCompanyLogosV1 ??= createCompanyLogoReader());
