import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { normalizeLogo, readLogoUpload } from "../lib/crm/logo-upload.ts";
import { businessLogo, maximumLogoBytes } from "../lib/crm/business-logo.ts";

test("uploaded logos preserve aspect ratio/transparency and are stored as small raster images", async () => {
  const original = await sharp({ create: { width: 640, height: 320, channels: 4, background: { r: 25, g: 100, b: 230, alpha: 0.4 } } }).png().toBuffer();
  const result = await normalizeLogo(original, "image/png");
  assert.equal(businessLogo(result), result);
  const metadata = await sharp(Buffer.from(result.split(",")[1], "base64")).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 256);
  assert.equal(metadata.height, 128);
  assert.equal(metadata.hasAlpha, true);
});

test("JPEG logos are correctly oriented and private image metadata is removed", async () => {
  const original = await sharp({ create: { width: 600, height: 300, channels: 3, background: "blue" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const result = await normalizeLogo(original, "image/jpeg");
  const metadata = await sharp(Buffer.from(result.split(",")[1], "base64")).metadata();
  assert.equal(metadata.width, 128);
  assert.equal(metadata.height, 256);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
});

test("uploads reject oversized, mislabeled, vector, corrupt and excessive-dimension files", async () => {
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: "blue" } }).png().toBuffer();
  await assert.rejects(normalizeLogo(Buffer.alloc(maximumLogoBytes + 1), "image/png"), error => error.status === 413);
  await assert.rejects(normalizeLogo(png, "image/jpeg"), error => error.status === 415);
  await assert.rejects(normalizeLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "image/png"), error => error.status === 415);
  await assert.rejects(normalizeLogo(png.subarray(0, 15), "image/png"), error => error.status === 400);
  const largeDimensions = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: "blue" } }).png().toBuffer();
  await assert.rejects(normalizeLogo(largeDimensions, "image/png"), error => error.status === 400);
  assert.equal(businessLogo("data:image/svg+xml;base64,PHN2Zz4="), "");
  assert.equal(businessLogo("https://external.example/logo.png"), "");
});

test("chunked uploads are limited even without a Content-Length header", async () => {
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(maximumLogoBytes)); controller.enqueue(new Uint8Array(1)); controller.close(); } });
  await assert.rejects(readLogoUpload(new Request("https://crm.example/api/crm/logo", { method: "POST", duplex: "half", headers: { "Content-Type": "image/png" }, body })), error => error.status === 413);
  await assert.rejects(readLogoUpload(new Request("https://crm.example/api/crm/logo", { method: "POST", headers: { "Content-Type": "image/svg+xml" }, body: "<svg />" })), error => error.status === 415);
});

test("valid raw WebP uploads decode before saving", async () => {
  const image = await sharp({ create: { width: 48, height: 48, channels: 3, background: "green" } }).webp().toBuffer();
  const result = await readLogoUpload(new Request("https://crm.example/api/crm/logo", { method: "POST", headers: { "Content-Type": "image/webp" }, body: image }));
  assert.equal(businessLogo(result), result);
});
