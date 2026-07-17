import { Shield, Star, Heart, Award } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { DRIVER_PRO_LABELS, type DriverProTier } from "@shared/driverProTier";

export interface DriverTrustInfo {
  trustScore: number;
  matchReason: string;
  isFavorite?: boolean;
  separationDegrees?: number;
}

interface ExplainableMatchCardProps {
  driverName: string;
  trust?: DriverTrustInfo;
  eta?: string;
  fare?: string;
  selected?: boolean;
  onSelect?: () => void;
  onFavorite?: () => void;
  isFavorite?: boolean;
  className?: string;
  proTier?: DriverProTier;
}

/** C6 — Explainable driver match card with trust score. */
export function ExplainableMatchCard({
  driverName,
  trust,
  eta,
  fare,
  selected,
  onSelect,
  onFavorite,
  isFavorite,
  className,
  proTier,
}: ExplainableMatchCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full text-left rounded-2xl border p-3 transition-colors",
        selected ? "border-blue-500 bg-blue-50" : "border-gray-100 bg-white hover:bg-gray-50",
        className,
      )}
      data-testid="explainable-match-card"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-sm text-gray-900 truncate">{driverName}</p>
            {trust?.isFavorite || isFavorite ? (
              <Heart className="w-3.5 h-3.5 text-red-500 fill-red-500 shrink-0" />
            ) : null}
          </div>
          {trust?.matchReason && (
            <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
              <Shield className="w-3 h-3 mt-0.5 shrink-0 text-blue-600" />
              <span>{trust.matchReason}</span>
            </p>
          )}
          <div className="flex flex-wrap gap-2 mt-2">
            {trust?.trustScore != null && (
              <Badge
                variant="secondary"
                className="text-[10px]"
                title="Higher trust means stronger ride history, neighbor verification, and community ratings."
              >
                Trust {trust.trustScore}
              </Badge>
            )}
            {proTier && proTier !== "community" && (
              <Badge className="text-[10px] bg-amber-100 text-amber-900 border-amber-200" variant="outline">
                <Award className="w-3 h-3 mr-0.5 inline" />
                {DRIVER_PRO_LABELS[proTier]}
              </Badge>
            )}
            {eta && <span className="text-xs text-gray-500">{eta}</span>}
            {fare && <span className="text-xs font-semibold text-gray-900">{fare}</span>}
          </div>
        </div>
        {onFavorite && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFavorite();
            }}
            className="p-1.5 rounded-full hover:bg-gray-100"
            aria-label={isFavorite ? "Remove favorite" : "Add favorite"}
            data-testid="btn-toggle-favorite-driver"
          >
            <Star className={cn("w-4 h-4", isFavorite ? "text-yellow-500 fill-yellow-500" : "text-gray-400")} />
          </button>
        )}
      </div>
    </button>
  );
}
