import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { companyLogoDomain, senderCompanyDomain, senderLogoUrl } from "../lib/crm/sender-logo.ts";
import { companyWebsiteDomain, createCompanyLogoReader } from "../lib/crm/company-logos.ts";

const png = await sharp({
  create: {
    width: 128,
    height: 64,
    channels: 4,
    background: { r: 100, g: 60, b: 230, alpha: 0.5 },
  },
})
  .png()
  .withMetadata()
  .toBuffer();
const icon = () => new Response(png, { headers: { "Content-Type": "image/png" } });

test("company domains use the exact sender address, normalize case and reject URLs or private hosts", () => {
  assert.equal(senderCompanyDomain(" News@DRAGONFI.PH "), "dragonfi.ph");
  assert.equal(senderLogoUrl("news@dragonfi.ph"), "/api/crm/company-logo?domain=dragonfi.ph");
  for (const email of [
    "Name <news@dragonfi.ph>",
    "user@company.com/path",
    "a@b.com:8080",
    "a@127.0.0.1",
    "a@intranet.local",
    "a@localhost",
    "a@company.invalid",
    "a@company.test",
    "a@internal.lan",
    "a@example.com",
    "a@sub.example.org",
    "a@-company.com",
    "a@company..com",
    "a@company.com?tracking=1",
    "a@b.com\r\nBcc: a@b.com",
  ]) {
    assert.equal(senderLogoUrl(email), "", email);
  }
  assert.equal(companyLogoDomain("https://company.com"), "");
});

test("shared inbox and bulk delivery domains do not display the provider as a company", () => {
  for (const domain of [
    "gmail.com",
    "googlemail.com",
    "outlook.com",
    "hotmail.co.uk",
    "yahoo.com.ph",
    "icloud.com",
    "proton.me",
    "gmx.de",
    "sub.sendgrid.net",
    "pb02.wixemails.com",
    "tenant.onmicrosoft.com",
  ]) {
    assert.equal(senderLogoUrl(`sender@${domain}`), "", domain);
  }
  assert.equal(senderCompanyDomain("owner@actual-company.com"), "actual-company.com");
});

test("public suffix rules find company websites without collapsing independent hosted businesses", () => {
  assert.equal(companyWebsiteDomain("invite.hirepavago.co"), "hirepavago.co");
  assert.equal(companyWebsiteDomain("mail.company.co.uk"), "company.co.uk");
  assert.equal(companyWebsiteDomain("mail.company.com.au"), "company.com.au");
  assert.equal(companyWebsiteDomain("mail.my-shop.github.io"), "my-shop.github.io");
  for (const domain of ["co.uk", "github.io", "company.unknownsuffix", "site.onion", "gmail.com"]) {
    assert.equal(companyWebsiteDomain(domain), "", domain);
  }
});

test("public logo reads coalesce, share a company cache across subdomains and strip metadata", async () => {
  let calls = 0,
    time = 0;
  const read = createCompanyLogoReader(
    async (url, init) => {
      calls++;
      assert.equal(url.origin, "https://t3.gstatic.com");
      assert.equal(url.searchParams.get("url"), "https://company.co.uk");
      assert(!url.href.includes("@"));
      assert.equal(init.redirect, "error");
      assert.equal(init.credentials, "omit");
      assert.equal(init.headers, undefined);
      assert(init.signal instanceof AbortSignal);
      return icon();
    },
    () => time,
  );
  const [first, second] = await Promise.all([read("mail.company.co.uk"), read("company.co.uk")]);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  const metadata = await sharp(first).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 64);
  assert.equal(metadata.height, 32);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
  assert.equal(metadata.hasAlpha, true);
  assert.deepEqual(await read("sales.company.co.uk"), first);
  assert.equal(calls, 1);
  time = 24 * 60 * 60 * 1000 + 1;
  await read("company.co.uk");
  assert.equal(calls, 2);
});

test("missing logos, redirects and unavailable services fall back quietly with a short negative cache", async () => {
  let time = 0,
    calls = 0,
    mode = "missing";
  const read = createCompanyLogoReader(
    async () => {
      calls++;
      if (mode === "missing")
        return new Response(png, { status: 404, headers: { "Content-Type": "image/png" } });
      if (mode === "offline") throw new TypeError("Network unavailable");
      return icon();
    },
    () => time,
  );
  assert.equal(await read("company.com"), null);
  assert.equal(await read("company.com"), null);
  assert.equal(calls, 2);
  mode = "offline";
  time += 300001;
  assert.equal(await read("company.com"), null);
  assert.equal(calls, 3);
  mode = "available";
  time += 300001;
  assert(await read("company.com"));
  assert.equal(calls, 4);
  const redirect = createCompanyLogoReader(
    async () =>
      new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1/private" },
      }),
  );
  assert.equal(await redirect("company.com"), null);
});

test("a www-only company website icon is used when its bare domain has none", async () => {
  const hosts = [];
  const read = createCompanyLogoReader(async (url) => {
    const host = new URL(url.searchParams.get("url")).hostname;
    hosts.push(host);
    return host.startsWith("www.") ? icon() : new Response(null, { status: 404 });
  });
  assert(await read("notifications.company.com"));
  assert.deepEqual(hosts, ["company.com", "www.company.com"]);
});

test("logo decoding rejects non-images, vectors, corrupt content and excessive pixels or response bytes", async () => {
  const tooLarge = await sharp({
    create: { width: 1100, height: 1100, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  const responses = [
    new Response("<svg><script /></svg>", { headers: { "Content-Type": "image/png" } }),
    new Response(png, { headers: { "Content-Type": "text/html" } }),
    new Response(png.subarray(0, 15), { headers: { "Content-Type": "image/png" } }),
    new Response(tooLarge, { headers: { "Content-Type": "image/png" } }),
    new Response(png, { headers: { "Content-Type": "image/png", "Content-Length": "9999999" } }),
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(128 * 1024));
          controller.enqueue(new Uint8Array(1));
          controller.close();
        },
      }),
      { headers: { "Content-Type": "image/png" } },
    ),
  ];
  for (const response of responses) {
    const read = createCompanyLogoReader(async () => response);
    assert.equal(await read("company.com"), null);
  }
});

test("excluded domains do not make an external request and the cache has a bounded lifetime and size", async () => {
  let calls = 0;
  const read = createCompanyLogoReader(async () => {
    calls++;
    return new Response(null, { status: 503 });
  });
  for (const domain of ["gmail.com", "localhost", "127.0.0.1", "example.com", "company.internal"]) {
    assert.equal(await read(domain), null);
  }
  assert.equal(calls, 0);
  for (let index = 0; index < 501; index++) await read(`company-${index}.com`);
  assert.equal(calls, 501);
  await read("company-0.com");
  assert.equal(calls, 502);
});
