/**
 * Organization invitations — the desk's own front door.
 *
 * Until 2026-09-16 a person could only be added to an organization if they
 * already held a PG Ride rider account: the owner typed their email and the
 * server refused with "they need to sign up first". A booking clerk had to
 * go through the rider signup — phone, terms, the admin approval queue —
 * and then find "Open organization portal" under Profile.
 *
 * Now an owner invites an email. If no account exists, an invitation is
 * created and a link sent; the invitee sets a name, phone and password on
 * "Join <organization>" and lands in the portal as a member. The link is
 * single use, expires, and is pinned to that email. An existing account is
 * attached directly, as before.
 */

export const INVITATION_DAYS = 7;

export type InvitationState = "open" | "accepted" | "expired";

export function invitationExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITATION_DAYS * 86_400_000);
}

export function invitationState(inv: { acceptedAt?: Date | string | null; expiresAt: Date | string }, now: Date = new Date()): InvitationState {
  if (inv.acceptedAt) return "accepted";
  if (new Date(inv.expiresAt).getTime() <= now.getTime()) return "expired";
  return "open";
}

/** What the invitee is told when the link cannot be used. */
export function invitationRefusal(state: InvitationState, organizationName: string): string | null {
  if (state === "accepted") return `This invitation to ${organizationName} has already been used. Sign in instead.`;
  if (state === "expired") return `This invitation to ${organizationName} has expired. Ask them to send a new one.`;
  return null;
}

/** Where a business sign-in may land afterwards: the portal, never elsewhere. */
export function safePortalNext(next: string | null | undefined): string {
  if (typeof next !== "string") return "/org";
  if (!next.startsWith("/org")) return "/org";
  if (next.startsWith("//") || /[\r\n\\]/.test(next)) return "/org";
  return next.slice(0, 200);
}
