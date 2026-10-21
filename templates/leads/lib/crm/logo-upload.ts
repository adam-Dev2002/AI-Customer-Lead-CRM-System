import sharp from "sharp";
import { logoContentTypes, maximumLogoBytes, maximumSavedLogoLength } from "./business-logo.ts";

export class LogoUploadError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export async function readLogoUpload(request: Request) {
  const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "";
  if (!logoContentTypes.some(allowed => allowed === type)) throw new LogoUploadError("Choose a PNG, JPG or WebP image.", 415);
  if (Number(request.headers.get("content-length")) > maximumLogoBytes) throw new LogoUploadError("Choose an image smaller than 2 MB.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new LogoUploadError("Choose an image to upload.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumLogoBytes) { await reader.cancel(); throw new LogoUploadError("Choose an image smaller than 2 MB.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) throw new LogoUploadError("Choose an image to upload.");
  return normalizeLogo(Buffer.concat(chunks), type);
}

export async function normalizeLogo(input: Buffer, contentType: string) {
  if (!input.length || input.length > maximumLogoBytes) throw new LogoUploadError("Choose an image smaller than 2 MB.", 413);
  const signatureMatches = contentType === "image/png" ? input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : contentType === "image/jpeg" ? input[0] === 255 && input[1] === 216 && input[2] === 255
    : contentType === "image/webp" && input.subarray(0, 4).toString() === "RIFF" && input.subarray(8, 12).toString() === "WEBP";
  if (!signatureMatches) throw new LogoUploadError("Choose a valid PNG, JPG or WebP image.", 415);
  try {
    const image = sharp(input, { limitInputPixels: 16_777_216, failOn: "warning" });
    const metadata = await image.metadata();
    const formats: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
    if (!metadata.format || formats[metadata.format] !== contentType || (metadata.pages || 1) !== 1) throw new LogoUploadError("Choose a still PNG, JPG or WebP image.", 415);
    // Decode and re-encode: retain the complete logo and transparency, remove metadata.
    const result = await image.rotate().resize({ width: 256, height: 256, fit: "inside", withoutEnlargement: true }).webp({ lossless: true }).toBuffer();
    const logo = `data:image/webp;base64,${result.toString("base64")}`;
    if (logo.length > maximumSavedLogoLength) throw new LogoUploadError("This image is too detailed. Choose a simpler logo.");
    return logo;
  } catch (error) {
    if (error instanceof LogoUploadError) throw error;
    throw new LogoUploadError("This image could not be opened. Choose a valid PNG, JPG or WebP image.");
  }
}
