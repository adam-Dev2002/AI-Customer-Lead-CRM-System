import { contactEmail, safePhotoUrl } from "./contact-photos.ts";
import { readPrivateFile } from "./private-files.ts";
import path from "node:path";
import { createHash } from "node:crypto";

type Person = {
  emailAddresses?: { value?: string }[];
  photos?: { url?: string; default?: boolean; metadata?: { primary?: boolean } }[];
};
type PhotoResult = {
  status: "available" | "partial" | "not_configured" | "unavailable";
  photos: Record<string, string>;
};

export function googlePersonPhoto(person: Person) {
  return [...(person.photos || [])]
    .sort((a, b) => Number(!!b.metadata?.primary) - Number(!!a.metadata?.primary))
    .filter(photo => !photo.default)
    .map(photo => safePhotoUrl(photo.url))
    .find(Boolean) || "";
}

// Separate read-only Contacts authorization. Gmail access does not grant this scope.
export function createGoogleContactPhotoReader(
  env: Record<string, string | undefined> = process.env,
  request: typeof fetch = fetch,
  now: () => number = Date.now,
) {
  let cached: PhotoResult = { status: "not_configured", photos: {} };
  let expiresAt = 0;
  let pending: Promise<PhotoResult> | undefined;
  const checkedEmails = new Set<string>();
  async function load(): Promise<PhotoResult> {
    const clientId = env.GOOGLE_CONTACTS_CLIENT_ID;
    const clientSecret = env.GOOGLE_CONTACTS_CLIENT_SECRET;
    const refreshToken = env.GOOGLE_CONTACTS_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken)
      return { status: "not_configured", photos: {} };
    try {
      const tokenResponse = await request("https://oauth2.googleapis.com/token", {
        method: "POST", cache: "no-store", signal: AbortSignal.timeout(5000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret,
          refresh_token: refreshToken, grant_type: "refresh_token" }),
      });
      if (!tokenResponse.ok) throw new Error("Contacts authorization unavailable.");
      const token = await tokenResponse.json();
      if (typeof token.access_token !== "string" || !token.access_token)
        throw new Error("Contacts authorization unavailable.");
      const signal = AbortSignal.timeout(15000);
      const headers = { Authorization: `Bearer ${token.access_token}` };
      async function readContacts(other: boolean) {
        const photos: Record<string, string> = {};
        let pageToken = "";
        const seen = new Set<string>();
        do {
          const url = new URL(other ? "https://people.googleapis.com/v1/otherContacts" : "https://people.googleapis.com/v1/people/me/connections");
          url.search = new URLSearchParams({ [other ? "readMask" : "personFields"]: "emailAddresses,photos", pageSize: "1000",
            ...(pageToken ? { pageToken } : {}) }).toString();
          if (other) {
            url.searchParams.append("sources", "READ_SOURCE_TYPE_CONTACT");
            url.searchParams.append("sources", "READ_SOURCE_TYPE_PROFILE");
          }
          const response = await request(url, { cache: "no-store", signal, headers });
          if (!response.ok) throw new Error("Contacts photos unavailable.");
          const body = await response.json();
          for (const person of (other ? body.otherContacts || [] : body.connections || []) as Person[]) {
            const photo = googlePersonPhoto(person);
            if (!photo) continue;
            for (const item of person.emailAddresses || []) {
              const email = contactEmail(item.value);
              if (email && !photos[email]) photos[email] = photo;
            }
          }
          pageToken = typeof body.nextPageToken === "string" ? body.nextPageToken : "";
          if (pageToken && seen.has(pageToken)) throw new Error("Repeated Contacts page.");
          seen.add(pageToken);
        } while (pageToken);
        return photos;
      }
      // Saved contacts and automatically collected email contacts are separate Google sources.
      const [contacts, others] = await Promise.allSettled([readContacts(false), readContacts(true)]);
      if (contacts.status === "rejected" && others.status === "rejected") throw new Error("Contacts unavailable.");
      const photos = { ...(others.status === "fulfilled" ? others.value : {}), ...(contacts.status === "fulfilled" ? contacts.value : {}) };
      try {
        const response = await request("https://openidconnect.googleapis.com/v1/userinfo", { cache: "no-store", signal, headers });
        if (response.ok) {
          const profile = await response.json();
          const photo = safePhotoUrl(profile.picture), email = contactEmail(profile.email);
          if (email && profile.email_verified === true && photo) photos[email] = photo;
        }
      } catch { /* The owner's profile photo is optional. */ }
      return { status: contacts.status === "fulfilled" && others.status === "fulfilled" ? "available" : "partial", photos };
    } catch {
      // Never expose Google's response, OAuth tokens, or credential errors to the browser.
      return { status: "unavailable", photos: cached.photos };
    }
  }
  return async function readKnownPhotos(emails: string[]): Promise<PhotoResult> {
    const normalized = [...new Set(emails.map(contactEmail).filter(Boolean))];
    // A newly captured sender gets a fresh lookup instead of waiting for the full cache TTL.
    if (now() >= expiresAt || (cached.status === "available" && normalized.some(email => !checkedEmails.has(email)))) {
      if (!pending) pending = load().then(result => {
        cached = result;
        expiresAt = now() + (result.status === "available" ? 6 * 3600000 : 300000);
        return result;
      }).finally(() => { pending = undefined; });
      await pending;
      for (const email of normalized) checkedEmails.add(email);
    }
    const photos: Record<string, string> = {};
    for (const raw of emails) {
      const email = contactEmail(raw);
      if (cached.photos[email]) photos[email] = cached.photos[email];
    }
    return { status: cached.status, photos };
  };
}

type PhotoConfiguration = { clientId: string; clientSecret: string; refreshToken: string; accountEmail?: string };
export async function photoConfiguration(env: Record<string, string | undefined> = process.env): Promise<PhotoConfiguration | null> {
  if (env.GOOGLE_CONTACTS_CLIENT_ID && env.GOOGLE_CONTACTS_CLIENT_SECRET && env.GOOGLE_CONTACTS_REFRESH_TOKEN)
    return { clientId: env.GOOGLE_CONTACTS_CLIENT_ID, clientSecret: env.GOOGLE_CONTACTS_CLIENT_SECRET, refreshToken: env.GOOGLE_CONTACTS_REFRESH_TOKEN };
  const directory = env.CRM_DATA_DIR || path.join(process.cwd(), ".data");
  try {
    const config = JSON.parse((await readPrivateFile("config/google-contact-photos.json", directory)).toString("utf8"));
    if (config.version !== 1 || ![config.clientId, config.clientSecret, config.refreshToken, config.accountEmail].every(value => typeof value === "string" && value)) return null;
    return config;
  } catch { return null; }
}

const runtime = globalThis as typeof globalThis & {
  __googleContactPhotosV2?: { signature: string; reader: ReturnType<typeof createGoogleContactPhotoReader> };
};
export async function readGoogleContactPhotos(emails: string[], expectedAccount = ""): Promise<PhotoResult> {
  const config = await photoConfiguration();
  if (!config) return { status: "not_configured", photos: {} };
  if (config.accountEmail && expectedAccount && contactEmail(config.accountEmail) !== contactEmail(expectedAccount))
    return { status: "unavailable", photos: {} };
  const signature = createHash("sha256").update(JSON.stringify(config)).digest("hex");
  if (runtime.__googleContactPhotosV2?.signature !== signature)
    runtime.__googleContactPhotosV2 = { signature, reader: createGoogleContactPhotoReader({ GOOGLE_CONTACTS_CLIENT_ID: config.clientId, GOOGLE_CONTACTS_CLIENT_SECRET: config.clientSecret, GOOGLE_CONTACTS_REFRESH_TOKEN: config.refreshToken }) };
  return runtime.__googleContactPhotosV2.reader(emails);
}
