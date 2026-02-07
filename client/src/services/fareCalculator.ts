export interface FareCalculation {
  baseFare: number;
  timeCharge: number;
  distanceCharge: number;
  surgeAdjustment: number;
  subtotal: number;
  total: number;
  formula: string;
  rates: RateCardRates;
}

export interface RateCardRates {
  minimumFare: number;
  baseFare: number;
  perMinuteRate: number;
  perMileRate: number;
  surgeAdjustment: number;
}

export const SUGGESTED_RATES: RateCardRates = {
  minimumFare: 7.65,
  baseFare: 4.00,
  perMinuteRate: 0.29,
  perMileRate: 0.90,
  surgeAdjustment: 0,
};

export function calculateFareWithRates(
  distanceMiles: number,
  durationMinutes: number,
  rates: RateCardRates = SUGGESTED_RATES
): FareCalculation {
  const baseFare = rates.baseFare;
  const timeCharge = rates.perMinuteRate * durationMinutes;
  const distanceCharge = rates.perMileRate * distanceMiles;
  const surgeAdjustment = rates.surgeAdjustment;
  const subtotal = baseFare + timeCharge + distanceCharge + surgeAdjustment;
  const total = Math.max(rates.minimumFare, Math.min(100, subtotal));

  const formula = `Base $${rates.baseFare.toFixed(2)} + ($${rates.perMinuteRate}/min × ${durationMinutes} min) + ($${rates.perMileRate}/mi × ${distanceMiles} mi)`;

  return {
    baseFare: round2(baseFare),
    timeCharge: round2(timeCharge),
    distanceCharge: round2(distanceCharge),
    surgeAdjustment: round2(surgeAdjustment),
    subtotal: round2(subtotal),
    total: round2(total),
    formula,
    rates,
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export const FareUtils = {
  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  },

  formatFareRange(min: number, max: number): string {
    if (min === max) {
      return this.formatCurrency(min);
    }
    return `${this.formatCurrency(min)} - ${this.formatCurrency(max)}`;
  },

  suggestTipAmounts(fareAmount: number): number[] {
    return [
      Math.round(fareAmount * 0.15 * 100) / 100,
      Math.round(fareAmount * 0.18 * 100) / 100,
      Math.round(fareAmount * 0.20 * 100) / 100,
    ];
  }
};
