import { getMobilityIntentPurgeCutoff } from "@shared/mobilityIntentRetention";
import type { IStorage } from "../storage";

/** Delete mobility_intents older than the retention window (privacy / PR #46 follow-up). */
export async function purgeExpiredMobilityIntents(storage: IStorage): Promise<number> {
  const cutoff = getMobilityIntentPurgeCutoff();
  return storage.purgeMobilityIntentsOlderThan(cutoff);
}
