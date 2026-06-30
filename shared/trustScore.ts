/** Trust score weights — MASTER_PLAN §25. */

export interface TrustScoreInput {
  rideCount: number;
  isFavorite: boolean;
  avgRating: number;
  isVerifiedNeighbor: boolean;
  hasOwnership: boolean;
  separationDegrees: number;
}

export function computeTrustScore(input: TrustScoreInput): number {
  const history = Math.min(40, input.rideCount * 8);
  const favorite = input.isFavorite ? 15 : 0;
  const rating = Math.max(0, Math.min(25, (input.avgRating - 3) * 12.5));
  const verified = input.isVerifiedNeighbor ? 10 : 0;
  const ownership = input.hasOwnership ? 5 : 0;
  const proximity =
    input.separationDegrees === 1 ? 10 : input.separationDegrees === 2 ? 5 : 0;
  return Math.round(
    Math.min(100, history + favorite + rating + verified + ownership + proximity),
  );
}

export function buildMatchReason(opts: {
  trustScore: number;
  rideCount: number;
  isFavorite: boolean;
  separationDegrees: number;
  isVerifiedNeighbor: boolean;
}): string {
  const parts: string[] = [];
  if (opts.isFavorite) parts.push("Your favorite driver");
  else if (opts.rideCount > 0) parts.push(`You've ridden together ${opts.rideCount} time${opts.rideCount === 1 ? "" : "s"}`);
  else if (opts.separationDegrees === 2) parts.push("Connected through your community");
  else if (opts.isVerifiedNeighbor) parts.push("Verified neighbor driver");
  else parts.push("Nearest available verified driver");
  parts.push(`Trust score ${opts.trustScore}`);
  return parts.join(" · ");
}

export function passesSeparationFilter(
  separationDegrees: number,
  maxAllowed: number,
): boolean {
  if (maxAllowed <= 0) return true;
  if (separationDegrees === 0) return maxAllowed >= 0;
  return separationDegrees <= maxAllowed;
}

export function rankDriversByTrustAndEta<
  T extends { distanceMiles: number; isOnline: boolean; trustScore: number },
>(drivers: T[]): T[] {
  return [...drivers].sort((a, b) => {
    if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
    const trustDiff = b.trustScore - a.trustScore;
    if (Math.abs(trustDiff) >= 10) return trustDiff;
    return a.distanceMiles - b.distanceMiles;
  });
}
