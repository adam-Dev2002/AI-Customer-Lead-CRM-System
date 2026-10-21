import test from "node:test";
import assert from "node:assert/strict";
import { contactEmail, personInitials, safePhotoUrl, savedContactPhotos } from "../lib/crm/contact-photos.ts";
import { createGoogleContactPhotoReader, googlePersonPhoto, photoConfiguration } from "../lib/crm/google-contact-photos.ts";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSeed } from "../lib/crm/seed.ts";
import { applyAutomationEvent, applyMutation } from "../lib/crm/domain.ts";

const photo = "https://lh3.googleusercontent.com/customer-photo";
const now = "2026-10-20T02:00:00.000Z";
const env = { GOOGLE_CONTACTS_CLIENT_ID: "test-client", GOOGLE_CONTACTS_CLIENT_SECRET: "test-secret", GOOGLE_CONTACTS_REFRESH_TOKEN: "test-refresh" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("customer identities use exact normalized emails and consistent initials", () => {
  assert.equal(contactEmail(" Customer@Example.COM "), "customer@example.com");
  assert.equal(personInitials("  Elvie   Mariano "), "EM");
  assert.equal(personInitials("Mary Delle Cascabel"), "MC");
  assert.equal(personInitials("Élodie"), "É");
  assert.equal(personInitials("", "customer@example.com"), "C");
  assert.equal(personInitials("   "), "?");
  const photos = savedContactPhotos([
    { email: " customer@example.com ", photoUrl: photo, updatedAt: "2026-10-19" },
    { email: "CUSTOMER@EXAMPLE.COM", photoUrl: `${photo}-new`, updatedAt: "2026-10-20" },
    { email: "other@example.com", updatedAt: "2026-10-20" },
  ]);
  assert.deepEqual(photos, { "customer@example.com": `${photo}-new` });
});

test("photo sources reject scripts, insecure links, credentials and local addresses", () => {
  assert.equal(safePhotoUrl(photo), photo);
  for (const value of ["javascript:alert(1)", "data:image/svg+xml,test", "http://example.com/photo", "//example.com/photo", "https://secret@example.com/photo", "https://localhost/photo", "https://127.0.0.1/photo", "https://[::1]/photo", "https://machine.local/photo", "x".repeat(2049), {}, null])
    assert.equal(safePhotoUrl(value), "");
});

test("authenticated inquiry photos survive refresh, clear explicitly and never follow a changed email", () => {
  const data = createSeed(new Date(now));
  data.leads = []; data.drafts = []; data.syncChanges = [];
  let sequence = 0;
  const makeId = () => `photo-test-${++sequence}`;
  const base = { Lead_ID: "PHOTO-LEAD", Name: "Photo Customer", Email: "customer@example.com", Service: "Sink repair", Message: "Please repair my sink.", Source: "Gmail" };
  const receive = patch => applyAutomationEvent(data, { eventId: makeId(), type: "lead.upsert", data: { ...base, ...patch } }, now, makeId);
  receive({ Photo_URL: photo });
  assert.equal(data.leads[0].photoUrl, photo);
  receive({});
  assert.equal(data.leads[0].photoUrl, photo);
  receive({ Photo_URL: "" });
  assert.equal(data.leads[0].photoUrl, undefined);
  receive({ Photo_URL: photo });
  receive({ Email: "different@example.com" });
  assert.equal(data.leads[0].photoUrl, undefined);
  receive({ Photo_URL: photo });
  applyMutation(data, { action: "lead.update", payload: { id: base.Lead_ID, notes: "Keep photo" } }, now, makeId);
  assert.equal(data.leads[0].photoUrl, photo);
  applyMutation(data, { action: "lead.update", payload: { id: base.Lead_ID, email: "changed@example.com" } }, now, makeId);
  assert.equal(data.leads[0].photoUrl, undefined);
});

test("Google placeholder photos are ignored and a primary real photo is preferred", () => {
  assert.equal(googlePersonPhoto({ photos: [{ url: photo, default: true }] }), "");
  assert.equal(googlePersonPhoto({ photos: [{ url: `${photo}-secondary` }, { url: photo, metadata: { primary: true } }] }), photo);
});

test("unconfigured Contacts does not make any network requests", async () => {
  const read = createGoogleContactPhotoReader({}, () => { throw new Error("Unexpected request"); });
  assert.deepEqual(await read(["customer@example.com"]), { status: "not_configured", photos: {} });
});

test("Google reads all pages, returns only known exact emails, coalesces and caches reads", async () => {
  const calls = [];
  let time = 1000;
  const read = createGoogleContactPhotoReader(env, async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    if (url.hostname === "oauth2.googleapis.com") return json({ access_token: "test-access" });
    assert.equal(init.headers.Authorization, "Bearer test-access");
    if (url.hostname === "openidconnect.googleapis.com") return json({ email: "owner@example.com", email_verified: true, picture: `${photo}-owner` });
    if (url.pathname === "/v1/otherContacts") {
      assert.equal(url.searchParams.get("readMask"), "emailAddresses,photos");
      assert.deepEqual(url.searchParams.getAll("sources"), ["READ_SOURCE_TYPE_CONTACT", "READ_SOURCE_TYPE_PROFILE"]);
      return json({ otherContacts: [] });
    }
    assert.equal(url.searchParams.get("personFields"), "emailAddresses,photos");
    assert.equal(init.method, undefined); // Contacts requests only read.
    return url.searchParams.has("pageToken")
      ? json({ connections: [{ emailAddresses: [{ value: "second@example.com" }], photos: [{ url: `${photo}-second` }] }] })
      : json({ connections: [
        { emailAddresses: [{ value: " Customer@Example.com " }], photos: [{ url: photo }] },
        { emailAddresses: [{ value: "private@example.com" }], photos: [{ url: `${photo}-private` }] },
        { emailAddresses: [{ value: "customer@example.com.evil" }], photos: [{ url: `${photo}-wrong` }] },
      ], nextPageToken: "page2" });
  }, () => time);
  const [a, b] = await Promise.all([read(["CUSTOMER@example.com", "second@example.com"]), read(["second@example.com"])]);
  assert.deepEqual(a, { status: "available", photos: { "customer@example.com": photo, "second@example.com": `${photo}-second` } });
  assert.deepEqual(b.photos, { "second@example.com": `${photo}-second` });
  assert.equal(calls.length, 5);
  await read(["customer@example.com"]);
  assert.equal(calls.length, 5);
  await read(["new-sender@example.com"]);
  assert.equal(calls.length, 10, "a new sender must not wait six hours for photo lookup");
  time += 6 * 3600000;
  await read(["customer@example.com"]);
  assert.equal(calls.length, 15);
});

test("denied Contacts authorization is quiet, backs off and never exposes tokens", async () => {
  let calls = 0;
  const read = createGoogleContactPhotoReader(env, async () => { calls++; return json({ error: "test-secret" }, 403); });
  const result = await read(["customer@example.com"]);
  assert.deepEqual(result, { status: "unavailable", photos: {} });
  await read(["customer@example.com"]);
  assert.equal(calls, 1);
  assert(!JSON.stringify(result).includes("test-secret"));
});

test("email-only contacts and the verified account profile supply real photos", async () => {
  const read = createGoogleContactPhotoReader(env, async input => {
    const url = new URL(input);
    if (url.hostname === "oauth2.googleapis.com") return json({ access_token: "test-access" });
    if (url.hostname === "openidconnect.googleapis.com") return json({ email: "owner@example.com", email_verified: true, picture: `${photo}-owner` });
    if (url.pathname.endsWith("connections")) return json({ connections: [] });
    return json({ otherContacts: [
      { emailAddresses: [{ value: "sender@example.com" }], photos: [{ url: photo, default: false }] },
      { emailAddresses: [{ value: "placeholder@example.com" }], photos: [{ url: `${photo}-default`, default: true }] },
      { emailAddresses: [{ value: "private@example.com" }], photos: [{ url: `${photo}-private` }] },
    ] });
  });
  assert.deepEqual(await read(["SENDER@example.com", "owner@example.com", "placeholder@example.com"]), {
    status: "available", photos: { "sender@example.com": photo, "owner@example.com": `${photo}-owner` },
  });
});

test("a denied source preserves photos from the other source and reports partial access", async () => {
  const read = createGoogleContactPhotoReader(env, async input => {
    const url = new URL(input);
    if (url.hostname === "oauth2.googleapis.com") return json({ access_token: "test-access" });
    if (url.pathname.endsWith("connections")) return json({ error: "scope denied" }, 403);
    if (url.hostname === "openidconnect.googleapis.com") return json({ email: "wrong@example.com", email_verified: false, picture: photo });
    return json({ otherContacts: [{ emailAddresses: [{ value: "sender@example.com" }], photos: [{ url: photo }] }] });
  });
  assert.deepEqual(await read(["sender@example.com", "wrong@example.com"]), { status: "partial", photos: { "sender@example.com": photo } });
});

test("private setup configuration loads from the isolated CRM data directory without env changes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "crm-photos-"));
  const config = { version: 1, clientId: "test-client", clientSecret: "test-secret", refreshToken: "test-refresh", accountEmail: "owner@example.com" };
  try {
    assert.equal(await photoConfiguration({ CRM_DATA_DIR: directory }), null);
    await writeFile(path.join(directory, "google-contact-photos.json"), JSON.stringify(config));
    assert.deepEqual(await photoConfiguration({ CRM_DATA_DIR: directory }), config);
    await writeFile(path.join(directory, "google-contact-photos.json"), "invalid");
    assert.equal(await photoConfiguration({ CRM_DATA_DIR: directory }), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
