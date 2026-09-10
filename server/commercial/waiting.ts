/**
 * Waiting at the door, and no-shows, priced by the organization's terms.
 *
 * Called from the driver's completion and no-show routes once the ride row
 * is final. A completed job's waiting is the time between the driver's
 * "I'm here" and "we're moving", less the free minutes; a no-show costs the
 * organization its no-show fee instead of the rider's. Both land on the
 * commercial_jobs row the statement reads.
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import { commercialJobs, organizations, rides } from "@shared/schema";
import { orgTerms, waitingCharge } from "@shared/commercialTerms";

async function jobAndTerms(rideId: string) {
  const [row] = await db.select({ job: commercialJobs, ride: rides, org: organizations })
    .from(commercialJobs)
    .innerJoin(rides, eq(rides.id, commercialJobs.rideId))
    .innerJoin(organizations, eq(organizations.id, commercialJobs.organizationId))
    .where(eq(commercialJobs.rideId, rideId));
  return row ? { ...row, terms: orgTerms(row.org.terms) } : null;
}

/** After completion: write waiting minutes and fee. No-op for rides that are not commercial jobs. */
export async function recordWaitingForCompletedRide(rideId: string): Promise<{ waitMinutes: number; waitFee: number } | null> {
  const row = await jobAndTerms(rideId);
  if (!row) return null;
  const charge = waitingCharge({ arrivedAt: row.ride.arrivedAt, startedAt: row.ride.startedAt }, row.terms);
  await db.update(commercialJobs)
    .set({ waitMinutes: charge.waitMinutes, waitFee: charge.waitFee.toFixed(2) })
    .where(eq(commercialJobs.id, row.job.id));
  if (charge.waitFee > 0) console.log(`[commercial] waiting :: ${row.org.name} | job ${row.job.jobNumber} | ${charge.waitMinutes} min at the door, ${charge.billableMinutes} billable, $${charge.waitFee.toFixed(2)}`);
  return { waitMinutes: charge.waitMinutes, waitFee: charge.waitFee };
}

/** After a driver reports a no-show: the organization's no-show fee, on the job. */
export async function recordNoShowForRide(rideId: string): Promise<number | null> {
  const row = await jobAndTerms(rideId);
  if (!row) return null;
  const fee = row.terms.noShowFee;
  await db.update(commercialJobs).set({ cancellationFee: fee.toFixed(2) }).where(eq(commercialJobs.id, row.job.id));
  await db.update(rides).set({ cancellationFee: fee.toFixed(2) } as any).where(eq(rides.id, rideId));
  console.log(`[commercial] no-show :: ${row.org.name} | job ${row.job.jobNumber} | fee $${fee.toFixed(2)}`);
  return fee;
}
