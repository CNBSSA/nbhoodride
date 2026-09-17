/**
 * Proof-of-delivery photos: shrink on the phone, upload through PG Ride's
 * own object store, and keep a copy on the phone when there is no signal at
 * the door so the driver can still complete and the photo follows.
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

/** Upload through the same door as driver documents. Returns the URL the server will accept as a proof. */
export async function uploadProofPhoto(blob: Blob): Promise<string> {
  const res = await apiRequest("POST", "/api/objects/upload", {});
  const { uploadURL } = await res.json();
  const put = await fetch(uploadURL, { method: "PUT", body: blob, headers: { "Content-Type": blob.type || "image/jpeg" }, credentials: "include" });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  return uploadURL;
}

// ── The queue: a photo that could not upload at the door ──
const KEY = "pgride:proofPhotos";
interface Queued { rideId: string; dataUrl: string; queuedAt: number }
const DAY = 86_400_000;

function readQueue(): Queued[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}
function writeQueue(q: Queued[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(q)); } catch {}
}
const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(blob); });
const fromDataUrl = async (dataUrl: string) => (await fetch(dataUrl)).blob();

export async function queueProofPhoto(rideId: string, blob: Blob): Promise<void> {
  const q = readQueue().filter((e) => e.rideId !== rideId);
  q.push({ rideId, dataUrl: await toDataUrl(blob), queuedAt: Date.now() });
  writeQueue(q);
}

export function queuedProofCount(): number { return readQueue().length; }

/** Try every queued photo once; a photo older than a day is dropped. Returns how many went through. */
export async function flushProofPhotos(): Promise<number> {
  const q = readQueue();
  if (q.length === 0) return 0;
  let sent = 0;
  const remaining: Queued[] = [];
  for (const entry of q) {
    if (Date.now() - entry.queuedAt > DAY) continue;
    try {
      const photoUrl = await uploadProofPhoto(await fromDataUrl(entry.dataUrl));
      const res = await apiRequest("POST", `/api/driver/rides/${entry.rideId}/proof`, { photoUrl });
      if (!res.ok) throw new Error(String(res.status));
      sent += 1;
    } catch {
      remaining.push(entry);
    }
  }
  writeQueue(remaining);
  return sent;
}
