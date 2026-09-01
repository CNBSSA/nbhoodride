/**
 * VAPID public-key decoding and validation, shared by the push client and the
 * server.
 *
 * A VAPID application server key is a P-256 public key in uncompressed form:
 * exactly 65 bytes beginning with 0x04, base64url-encoded (87 chars). Browsers
 * reject anything else with a bare "InvalidAccessError: The provided
 * applicationServerKey is not valid", which says nothing about what is wrong —
 * so we check the shape ourselves and explain it.
 *
 * The decoder is dependency-free (no atob/Buffer) so the same code runs in the
 * browser, in Node, and under vitest.
 */

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export const VAPID_PUBLIC_KEY_BYTES = 65;

export type VapidKeyCheck =
  | { valid: true; bytes: Uint8Array }
  | { valid: false; error: string };

/** Decode base64url (or standard base64) to bytes. Returns null if malformed. */
export function decodeBase64Url(input: string): Uint8Array | null {
  const normalized = input.trim().replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (normalized.length === 0) return null;
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of normalized) {
    const value = B64_ALPHABET.indexOf(ch);
    if (value === -1) return null; // stray character — not valid base64
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/**
 * Validate a configured VAPID public key and return its bytes. The error text
 * is written to be shown to whoever configured it — it names the likely cause
 * (private key pasted, value truncated, quotes copied along) rather than just
 * saying "invalid".
 */
export function checkVapidPublicKey(raw: string | undefined | null): VapidKeyCheck {
  const key = (raw ?? "").trim();
  if (!key) return { valid: false, error: "No VAPID public key configured." };
  if (/^["'].*["']$/.test(key)) {
    return { valid: false, error: "VAPID public key has surrounding quotes — store the bare value." };
  }
  const bytes = decodeBase64Url(key);
  if (!bytes) {
    return { valid: false, error: "VAPID public key is not valid base64url." };
  }
  if (bytes.length === 32) {
    return {
      valid: false,
      error: "This is a VAPID PRIVATE key (32 bytes), not the public key. Use the 87-character public key.",
    };
  }
  if (bytes.length !== VAPID_PUBLIC_KEY_BYTES) {
    return {
      valid: false,
      error: `VAPID public key must decode to ${VAPID_PUBLIC_KEY_BYTES} bytes, got ${bytes.length} — the value looks truncated or altered.`,
    };
  }
  if (bytes[0] !== 0x04) {
    return {
      valid: false,
      error: "VAPID public key is not an uncompressed P-256 point (must start with 0x04).",
    };
  }
  return { valid: true, bytes };
}
