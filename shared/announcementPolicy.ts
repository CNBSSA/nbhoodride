/**
 * Who an operational announcement reaches, and what counts as a valid one.
 * Shared so the admin UI can preview exactly what the server will do.
 */

export const ANNOUNCEMENT_AUDIENCES = ["all", "riders", "drivers", "specific"] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

export const ANNOUNCEMENT_TITLE_MAX = 120;
export const ANNOUNCEMENT_BODY_MAX = 1000;

export interface AnnouncementInput {
  title?: unknown;
  body?: unknown;
  audience?: unknown;
  targetUserIds?: unknown;
}

export type AnnouncementCheck =
  | {
      valid: true;
      title: string;
      body: string;
      audience: AnnouncementAudience;
      targetUserIds: string[];
    }
  | { valid: false; error: string };

export function checkAnnouncement(input: AnnouncementInput): AnnouncementCheck {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  const audience = input.audience as AnnouncementAudience;

  if (!title) return { valid: false, error: "A title is required." };
  if (title.length > ANNOUNCEMENT_TITLE_MAX) {
    return { valid: false, error: `Title must be ${ANNOUNCEMENT_TITLE_MAX} characters or fewer.` };
  }
  if (!body) return { valid: false, error: "A message is required." };
  if (body.length > ANNOUNCEMENT_BODY_MAX) {
    return { valid: false, error: `Message must be ${ANNOUNCEMENT_BODY_MAX} characters or fewer.` };
  }
  if (!ANNOUNCEMENT_AUDIENCES.includes(audience)) {
    return { valid: false, error: "Choose who should receive this announcement." };
  }

  let targetUserIds: string[] = [];
  if (audience === "specific") {
    const raw = Array.isArray(input.targetUserIds) ? input.targetUserIds : [];
    targetUserIds = Array.from(
      new Set(raw.filter((id): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim())),
    );
    if (targetUserIds.length === 0) {
      return { valid: false, error: "Select at least one person to send this to." };
    }
  }

  return { valid: true, title, body, audience, targetUserIds };
}

/** Does this account belong to the chosen audience? */
export function matchesAudience(
  user: { isDriver?: boolean | null; isSuspended?: boolean | null; deletedAt?: Date | string | null },
  audience: AnnouncementAudience,
): boolean {
  // Deleted and suspended accounts never receive announcements: the first no
  // longer exists, and the second is not an active participant.
  if (user.deletedAt) return false;
  if (user.isSuspended) return false;
  if (audience === "all" || audience === "specific") return true;
  if (audience === "drivers") return Boolean(user.isDriver);
  if (audience === "riders") return !user.isDriver;
  return false;
}
