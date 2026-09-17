/**
 * Someone who signs in through the business door (/org/login) wants the
 * portal, not the rider Home, next time the app opens on this device. The
 * portal's own "rider app" links clear it, so nobody is trapped. Stored
 * per device; nothing on the server changes.
 */
const KEY = "pgride:home";

export function rememberBusinessHome(): void {
  try { localStorage.setItem(KEY, "org"); } catch {}
}
export function forgetBusinessHome(): void {
  try { localStorage.removeItem(KEY); } catch {}
}
export function prefersBusinessHome(): boolean {
  try { return localStorage.getItem(KEY) === "org"; } catch { return false; }
}
