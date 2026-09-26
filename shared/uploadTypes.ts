/**
 * What a file uploaded to PG Ride's own store may be.
 *
 * Driver documents and proof-of-delivery photos are reviewed by an operator
 * or a desk in their own signed-in session, so a stored file is never
 * trusted for what its uploader SAID it was: the phone's picker only
 * suggests image/PDF, and the upload carried whatever Content-Type the
 * request named (corporate audit #340). The bytes decide. A file is a
 * photo or a PDF by its signature, is stored under that type and no other,
 * and anything else — an SVG, an HTML page, a script named .jpg — is
 * refused at the door with a reason the uploader can act on.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type UploadKind = "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "image/heic" | "application/pdf";

export const UPLOAD_KIND_LABELS: Record<UploadKind, string> = {
  "image/jpeg": "JPEG photo",
  "image/png": "PNG image",
  "image/webp": "WebP image",
  "image/gif": "GIF image",
  "image/heic": "HEIC photo",
  "application/pdf": "PDF",
};

export const UPLOAD_REFUSED_MESSAGE = "Only photos (JPEG, PNG, WebP, GIF, HEIC) and PDF files can be uploaded.";

const ascii = (bytes: Uint8Array, start: number, len: number) => {
  let s = "";
  for (let i = start; i < Math.min(bytes.length, start + len); i++) s += String.fromCharCode(bytes[i]);
  return s;
};

/** The file's own signature: what it is, whatever it was called. */
export function sniffUploadKind(bytes: Uint8Array): UploadKind | null {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  const gif = ascii(bytes, 0, 6);
  if (gif === "GIF87a" || gif === "GIF89a") return "image/gif";
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (/^(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1)$/.test(brand)) return "image/heic";
    return null;
  }
  if (ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

export interface UploadJudgement {
  ok: boolean;
  /** The type the file is stored and served under: what the bytes are. */
  contentType?: UploadKind;
  /** Why it was refused, in words the uploader can act on. */
  reason?: string;
  /** What the request said, kept for the log. */
  declared: string;
}

/**
 * Accept or refuse an upload from its bytes. The declared type is recorded,
 * never believed: a PNG sent as image/jpeg is stored as a PNG; an HTML page
 * sent as image/png is refused.
 */
export function judgeUpload(bytes: Uint8Array | null | undefined, declaredType: string | null | undefined, maxBytes: number = MAX_UPLOAD_BYTES): UploadJudgement {
  const declared = String(declaredType ?? "").split(";")[0].trim().toLowerCase() || "application/octet-stream";
  if (!bytes || bytes.length === 0) return { ok: false, reason: "Empty upload", declared };
  if (bytes.length > maxBytes) return { ok: false, reason: `File is larger than ${Math.round(maxBytes / 1048576)}MB`, declared };
  const kind = sniffUploadKind(bytes);
  if (!kind) return { ok: false, reason: UPLOAD_REFUSED_MESSAGE, declared };
  return { ok: true, contentType: kind, declared };
}

/** Headers every stored file is served with, whichever store holds it. */
export function safeServeHeaders(contentType: string, id: string): Record<string, string> {
  const inline = /^(image\/(jpeg|png|webp|gif|heic)|application\/pdf)$/i.test(contentType);
  const headers: Record<string, string> = {
    "Content-Type": inline ? contentType : "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
    "Cache-Control": "private, max-age=3600",
  };
  if (!inline) headers["Content-Disposition"] = `attachment; filename="${id}"`;
  return headers;
}
