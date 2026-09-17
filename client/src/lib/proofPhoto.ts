/**
 * Proof-of-delivery photos: shrink on the phone, upload through PG Ride's
 * own database-backed object store (the server verifies owner and type
 * before a photo counts), and keep a copy on the phone when there is no
 * signal at the door so the driver can still complete and the photo follows.
 *
 * The queue is per driver on this phone, reuses an upload that already went
 * through, gives up on a definite refusal (4xx) instead of retrying it for a
 * day, and refuses to pretend it saved a photo it could not keep.
 */
import { apiRequest } from "@/lib/queryClient";

/** A phone camera shot is 3–8 MB; the desk needs to see a parcel at a door. ~200–400 KB. */
export async function shrinkPhoto(file: Blob, maxEdge = 1280, quality = 0.72): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    return blob ?? file;
  } catch {
    return file; // HEIC the browser cannot decode, or no canvas: send what we have
  }
}

export class UploadRefused extends Error { constructor(public status: number) { super(`Upload refused (${status})`); } }

/** Upload through the database store. Returns the URL the server will accept as a proof. */
export async function uploadProofPhoto(blob: Blob): Promise<string> {
  const res = await apiRequest("POST", "/api/objects/upload?store=db", {});
  const { uploadURL } = await res.json();
  const put = await fetch(uploadURL, { method: "PUT", body: blob, headers: { "Content-Type": blob.type || "image/jpeg" }, credentials: "include" });
  if (!put.ok) throw new UploadRefused(put.status);
  return uploadURL;
}

// ── The queue: a photo that could not upload at the door ──
const KEY = "pgride:proofPhotos";
interface Queued { userId: string; rideId: string; dataUrl: string; uploadedUrl?: string; queuedAt: number }
const DAY = 86_400_000;

function readQueue(): Queued[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}
function writeQueue(q: Queued[]): boolean {
  try {
    const text = JSON.stringify(q);
    localStorage.setItem(KEY, text);
    return localStorage.getItem(KEY) === text;
  } catch { return false; }
}
const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(blob); });
const fromDataUrl = async (dataUrl: string) => (await fetch(dataUrl)).blob();

/** Keep a photo on this phone for this driver. Throws when the phone cannot hold it: the caller must not say it did. */
export async function queueProofPhoto(userId: string, rideId: string, blob: Blob): Promise<void> {
  const q = readQueue().filter((e) => !(e.userId === userId && e.rideId === rideId));
  q.push({ userId, rideId, dataUrl: await toDataUrl(blob), queuedAt: Date.now() });
  if (!writeQueue(q)) throw new Error("This phone has no room to keep the photo. Try again when you have signal.");
}

export function queuedProofCount(userId: string): number { return readQueue().filter((e) => e.userId === userId).length; }

export interface FlushResult { sent: number; dropped: Array<{ rideId: string; reason: string }> }

/**
 * Try this driver's queued photos once. A photo older than a day, or one the
 * server definitely refused, is dropped and reported; a network failure or a
 * server error keeps it for next time. Other drivers' photos are left alone.
 */
export async function flushProofPhotos(userId: string): Promise<FlushResult> {
  const q = readQueue();
  const result: FlushResult = { sent: 0, dropped: [] };
  if (q.length === 0) return result;
  const remaining: Queued[] = [];
  for (const entry of q) {
    if (entry.userId !== userId) { remaining.push(entry); continue; }
    if (Date.now() - entry.queuedAt > DAY) { result.dropped.push({ rideId: entry.rideId, reason: "older than a day" }); continue; }
    try {
      const photoUrl = entry.uploadedUrl ?? await uploadProofPhoto(await fromDataUrl(entry.dataUrl));
      entry.uploadedUrl = photoUrl;
      const res = await apiRequest("POST", `/api/driver/rides/${entry.rideId}/proof`, { photoUrl });
      if (res.ok) { result.sent += 1; continue; }
      if (res.status >= 400 && res.status < 500) {
        const body = await res.json().catch(() => ({}));
        result.dropped.push({ rideId: entry.rideId, reason: body?.message ?? `refused (${res.status})` });
        continue;
      }
      remaining.push(entry);
    } catch (err) {
      if (err instanceof UploadRefused && err.status >= 400 && err.status < 500) { result.dropped.push({ rideId: entry.rideId, reason: `upload refused (${err.status})` }); continue; }
      remaining.push(entry);
    }
  }
  writeQueue(remaining);
  return result;
}
