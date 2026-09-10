/**
 * Cancelling a commercial job from the desk.
 *
 * A member who may book may also cancel, whoever booked it. A job that has
 * not started cancels under the same ladder riders get today
 * (calculateCancellationFee: free while waiting for a driver, free more than
 * two hours before a scheduled pickup, a small fee close to departure) and
 * the fee is written to the job so the statement carries it. A job already
 * on the road cannot be cancelled here: the desk calls PG Ride. Slice 3
 * replaces the ladder with the organization's own terms.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { commercialJobs, rides, type Ride } from "@shared/schema";
import { calculateCancellationFee } from "../rideWorkflowService";
import { CommercialError } from "./organizations";

export interface CancelResult {
  ride: Ride;
  cancellationFee: string;
  /** The driver who had the job, if any, so the caller can tell them. */
  driverId: string | null;
}

export async function cancelJob(organizationId: string, jobId: string, actorUserId: string, reason: string, now: Date = new Date()): Promise<CancelResult> {
  const [row] = await db
    .select({ job: commercialJobs, ride: rides })
    .from(commercialJobs)
    .innerJoin(rides, eq(rides.id, commercialJobs.rideId))
    .where(and(eq(commercialJobs.id, jobId), eq(commercialJobs.organizationId, organizationId)));
  if (!row) throw new CommercialError("Job not found.", 404);
  const { ride } = row;
  if (ride.status === "in_progress") throw new CommercialError("This job is on the road. Call PG Ride to change it.", 409);
  if (ride.status === "completed" || ride.status === "cancelled" || ride.status === "no_show") {
    throw new CommercialError(`This job is already ${ride.status.replace("_", " ")}.`, 409);
  }

  const fee = calculateCancellationFee(ride, now).fee;
  const feeText = (Number.isFinite(fee) && fee > 0 ? fee : 0).toFixed(2);

  const [updated] = await db.update(rides).set({
    status: "cancelled",
    cancellationReason: String(reason || "Cancelled by the organization").slice(0, 300),
    cancellationFee: feeText,
    cancelledBy: actorUserId,
    cancelledByRole: "rider",
    updatedAt: now,
  } as any).where(eq(rides.id, ride.id)).returning();
  await db.update(commercialJobs).set({ cancellationFee: feeText }).where(eq(commercialJobs.id, jobId));

  return { ride: updated, cancellationFee: feeText, driverId: ride.driverId ?? null };
}
