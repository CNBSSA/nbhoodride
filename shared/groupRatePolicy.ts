/**
 * Coworker group rate — what happens when the group shrinks.
 *
 * Every seat in a coworker group is 30% off once at least two seats are
 * taken. Until now the rate never came back off: three coworkers booked,
 * two cancelled, and the one left rode alone at the group rate. The rule:
 *
 *   - The group rate holds while at least GROUP_RATE_MIN_RIDERS seats are
 *     taken.
 *   - If the group drops below that BEFORE the driver has confirmed, each
 *     remaining rider is re-quoted at their solo fare, told immediately,
 *     and may cancel free for GROUP_REQUOTE_FREE_CANCEL_MINUTES.
 *   - Once the driver has confirmed, the card is already authorized at the
 *     group rate and that fare is locked; a later cancellation by someone
 *     else does not change it.
 *   - Every remaining rider is told whenever a coworker leaves, even when
 *     the rate does not change.
 *
 * Shared by the server (cancel path, fee ladder) and the copy in the
 * Terms and on the business page.
 */

export const GROUP_RATE_MIN_RIDERS = 2;
export const GROUP_REQUOTE_FREE_CANCEL_MINUTES = 30;

/** One sentence, used verbatim in the Terms and on the business page. */
export const GROUP_RATE_POLICY_SENTENCE =
  `The coworker group rate holds while at least ${GROUP_RATE_MIN_RIDERS} seats are taken; if the group drops to one rider before the driver confirms, that rider is re-quoted at the solo fare, told immediately, and may cancel free for ${GROUP_REQUOTE_FREE_CANCEL_MINUTES} minutes; once the driver has confirmed, every fare is locked.`;

export function groupRateHolds(activeSeats: number): boolean {
  return activeSeats >= GROUP_RATE_MIN_RIDERS;
}

export function freeCancelWindowOpen(ride: { freeCancelUntil?: Date | string | null }, now: Date = new Date()): boolean {
  if (!ride.freeCancelUntil) return false;
  const until = new Date(ride.freeCancelUntil).getTime();
  return Number.isFinite(until) && now.getTime() < until;
}

export interface SeatChangeNotice {
  title: string;
  body: string;
}

const money = (n: number | string) => `$${Number(n).toFixed(2)}`;

/** What a remaining rider is told when a coworker leaves the group. */
export function seatChangeNotice(input: {
  remaining: number;
  requoted: boolean;
  fare: number | string;
  locked?: boolean;
}): SeatChangeNotice {
  if (input.requoted) {
    return {
      title: "Your coworker group is down to you",
      body: `A coworker cancelled, so the group rate no longer applies. Your fare is now the solo rate, ${money(input.fare)}. Not what you planned? You can cancel free for the next ${GROUP_REQUOTE_FREE_CANCEL_MINUTES} minutes.`,
    };
  }
  if (input.remaining < GROUP_RATE_MIN_RIDERS && input.locked) {
    return {
      title: "A coworker cancelled",
      body: `You are the only rider left, but your driver has already confirmed, so your fare stays ${money(input.fare)}.`,
    };
  }
  return {
    title: "A coworker cancelled",
    body: `${input.remaining} rider${input.remaining === 1 ? "" : "s"} still in the group. Your fare is unchanged at ${money(input.fare)}.`,
  };
}
