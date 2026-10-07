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

/**
 * An email shown to someone who may not be its owner: enough to recognise,
 * not enough to read (code review 2026-10-06). "festus@gmail.com" reads
 * "fe***@gmail.com".
 */
export function maskEmail(email: string | null | undefined): string {
  const addr = String(email ?? "").trim();
  const at = addr.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = addr.slice(0, at);
  return `${local.slice(0, Math.min(2, Math.max(1, local.length - 1)))}***${addr.slice(at)}`;
}

/** Why an invitation to an organization that is not open cannot be made or used (code review 2026-10-06). */
export function organizationNotOpenForInvitations(organizationName: string, status: string | null | undefined, side: "invite" | "accept"): string | null {
  if (status === "active") return null;
  if (side === "invite") {
    return status === "paused"
      ? `${organizationName} is paused. People can be invited again once PG Ride resumes the account.`
      : `PG Ride has not approved ${organizationName} yet. People can be invited once the account is approved.`;
  }
  return `${organizationName} is not open for new members right now. Ask whoever invited you to try again once the account is approved.`;
}

/** What an existing account's invitee who is not signed in as that account is told (code review 2026-10-06). */
export function signInToAcceptText(email: string): string {
  return `Sign in as ${maskEmail(email)} to accept this invitation.`;
}
