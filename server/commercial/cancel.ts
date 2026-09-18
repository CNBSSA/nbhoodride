/**
 * Cancelling a commercial job from the desk.
 *
 * A member who may book may also cancel, whoever booked it. What it costs is
 * the organization's own agreement (shared/commercialTerms.ts), not the
 * rider ladder: nothing while no driver holds the job, nothing at or beyond
 * the free window, the late fee inside it. The fee is written to the job so
 * the statement carries it, and the driver who held the job is paid their
 * share of it at once, as on a rider's late cancel (server/commercial/driverPay.ts).
 * A job already on the road cannot be cancelled here: the desk calls PG Ride.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { commercialJobs, organizations, rides, type Ride } from "@shared/schema";
import { orgTerms, organizationCancellationFee } from "@shared/commercialTerms";
import { CommercialError } from "./organizations";
import { storage } from "../storage";
import { payDriverForLateCancel } from "./driverPay";
import { opsAlert, formatOpsAlert } from "../telegramOps";

export interface CancelResult {
  ride: Ride;
  cancellationFee: string;
  reason: string;
  /** The driver who had the job, if any, so the caller can tell them. */
  driverId: string | null;
  /** What the driver was credited of the fee, now; 0 when nothing was due. */
  driverCut: number;
}

export async function cancelJob(organizationId: string, jobId: string, actorUserId: string, reason: string, now: Date = new Date()): Promise<CancelResult> {
  const [row] = await db
    .select({ job: commercialJobs, ride: rides, org: organizations })
    .from(commercialJobs)
    .innerJoin(rides, eq(rides.id, commercialJobs.rideId))
    .innerJoin(organizations, eq(organizations.id, commercialJobs.organizationId))
    .where(and(eq(commercialJobs.id, jobId), eq(commercialJobs.organizationId, organizationId)));
  if (!row) throw new CommercialError("Job not found.", 404);
  const { ride } = row;
  if (ride.status === "in_progress") throw new CommercialError("This job is on the road. Call PG Ride to change it.", 409);
  if (ride.status === "completed" || ride.status === "cancelled" || ride.status === "no_show") {
    throw new CommercialError(`This job is already ${(ride.status ?? "").replace("_", " ")}.`, 409);
  }

  const charged = organizationCancellationFee({ scheduledAt: ride.scheduledAt, driverId: ride.driverId }, orgTerms(row.org.terms), now);
  const feeText = charged.fee.toFixed(2);

  const [updated] = await db.update(rides).set({
    status: "cancelled",
    cancellationReason: String(reason || "Cancelled by the organization").slice(0, 300),
    cancellationFee: feeText,
    cancelledBy: actorUserId,
    cancelledByRole: "rider",
    updatedAt: now,
  } as any).where(eq(rides.id, ride.id)).returning();
  await db.update(commercialJobs).set({ cancellationFee: feeText }).where(eq(commercialJobs.id, jobId));
  // An open approval link is closed so nobody answers for a job that will
  // not happen (shared/recipientApproval.ts).
  const { onCommercialRideEnded } = await import("./recipientApproval");
  await onCommercialRideEnded(ride.id, "the job was cancelled").catch((err) => console.error("[recipient-pay] cancel hook failed:", err));

  // The driver held this job and lost the slot: their share of the fee is
  // theirs now, never waiting on the statement. A failure here does not
  // undo the cancel; it is paged so the driver is not quietly unpaid.
  let driverCut = 0;
  if (charged.fee > 0 && ride.driverId) {
    try {
      driverCut = (await payDriverForLateCancel(storage, updated, charged.fee)).driverCut;
    } catch (payErr) {
      console.error(`[commercial] DRIVER NOT PAID for late cancel of ride ${ride.id}:`, payErr);
      opsAlert(formatOpsAlert("💸 Driver not paid for a late cancel", [
        ["Ride", ride.id.slice(0, 8)],
        ["Driver", ride.driverId],
        ["Fee", `$${feeText}`],
        ["Reason", String((payErr as any)?.message ?? payErr).slice(0, 200)],
        ["Fix", "Credit the driver by hand in the admin wallet panel"],
      ]));
    }
  }

  return { ride: updated, cancellationFee: feeText, reason: charged.reason, driverId: ride.driverId ?? null, driverCut };
}
