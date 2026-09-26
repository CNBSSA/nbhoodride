import { describe, it, expect } from "vitest";
import { sniffUploadKind, judgeUpload, safeServeHeaders, UPLOAD_REFUSED_MESSAGE } from "./uploadTypes";

const bytes = (...parts: Array<number[] | string>) => {
  const out: number[] = [];
  for (const p of parts) typeof p === "string" ? out.push(...Array.from(p, (c) => c.charCodeAt(0))) : out.push(...p);
  while (out.length < 16) out.push(0);
  return Uint8Array.from(out);
};
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0]);
const PNG = bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = bytes("RIFF", [0, 0, 0, 0], "WEBP");
const GIF = bytes("GIF89a");
const HEIC = bytes([0, 0, 0, 0x18], "ftyp", "heic");
const PDF = bytes("%PDF-1.4");
const HTML = bytes("<!doctype html><script>");
const SVG = bytes('<svg xmlns="http://www.w3.org/2000/svg">');
const MP4 = bytes([0, 0, 0, 0x18], "ftyp", "isom");

describe("sniffUploadKind", () => {
  it("knows a photo or a PDF by its signature", () => {
    expect(sniffUploadKind(JPEG)).toBe("image/jpeg");
    expect(sniffUploadKind(PNG)).toBe("image/png");
    expect(sniffUploadKind(WEBP)).toBe("image/webp");
    expect(sniffUploadKind(GIF)).toBe("image/gif");
    expect(sniffUploadKind(HEIC)).toBe("image/heic");
    expect(sniffUploadKind(PDF)).toBe("application/pdf");
  });
  it("refuses active or unknown formats whatever they are called", () => {
    expect(sniffUploadKind(HTML)).toBeNull();
    expect(sniffUploadKind(SVG)).toBeNull();
    expect(sniffUploadKind(MP4)).toBeNull();
    expect(sniffUploadKind(Uint8Array.from([0x89, 0x50]))).toBeNull();
    expect(sniffUploadKind(bytes("bytes-of-licence"))).toBeNull();
  });
});

describe("judgeUpload", () => {
  it("stores the file under what it is, not what was declared", () => {
    expect(judgeUpload(PNG, "image/jpeg")).toMatchObject({ ok: true, contentType: "image/png", declared: "image/jpeg" });
    expect(judgeUpload(PDF, "application/octet-stream")).toMatchObject({ ok: true, contentType: "application/pdf" });
    expect(judgeUpload(JPEG, "image/jpeg; charset=binary")).toMatchObject({ ok: true, contentType: "image/jpeg", declared: "image/jpeg" });
  });
  it("refuses a disguised page, an SVG, a script, an empty file and an oversize one", () => {
    expect(judgeUpload(HTML, "image/png")).toMatchObject({ ok: false, reason: UPLOAD_REFUSED_MESSAGE });
    expect(judgeUpload(SVG, "image/svg+xml").ok).toBe(false);
    expect(judgeUpload(bytes("#!/bin/sh"), "image/jpeg").ok).toBe(false);
    expect(judgeUpload(Uint8Array.from([]), "image/png")).toMatchObject({ ok: false, reason: "Empty upload" });
    expect(judgeUpload(null, "image/png").ok).toBe(false);
    expect(judgeUpload(PNG, "image/png", 8)).toMatchObject({ ok: false, reason: "File is larger than 0MB" });
  });
});

describe("safeServeHeaders", () => {
  it("shows a photo or PDF inline, sandboxed and unsniffable", () => {
    const h = safeServeHeaders("image/png", "abc");
    expect(h["Content-Type"]).toBe("image/png");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Content-Security-Policy"]).toBe("sandbox");
    expect(h["Content-Disposition"]).toBeUndefined();
  });
  it("anything else stored before the rule is a download under a neutral type", () => {
    const h = safeServeHeaders("text/html", "abc");
    expect(h["Content-Type"]).toBe("application/octet-stream");
    expect(h["Content-Disposition"]).toBe('attachment; filename="abc"');
    expect(safeServeHeaders("image/svg+xml", "x")["Content-Type"]).toBe("application/octet-stream");
  });
});
