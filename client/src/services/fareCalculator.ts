export interface FareCalculation {
  timeCharge: number;
  distanceCharge: number;
  subtotal: number;
  driverDiscount: number;
  discountAmount: number;
  total: number;
  formula: string;
}

export interface FareRates {
  timeRatePerHour: number;
  mileRate: number;
  minimumFare: number;
  maximumFare?: number;
}

// PG County standard rates
export const PG_COUNTY_RATES: FareRates = {
  timeRatePerHour: 18, // $18 per hour
  mileRate: 1.50, // $1.50 per mile
  minimumFare: 5.00, // $5 minimum
  maximumFare: 100.00, // $100 maximum for safety
};

export class FareCalculator {
  private rates: FareRates;

  constructor(rates: FareRates = PG_COUNTY_RATES) {
    this.rates = rates;
  }

  /**
   * Calculate fare based on distance and time
   * @param distanceMiles - Distance in miles
   * @param durationMinutes - Duration in minutes
   * @param driverDiscountPercent - Driver discount percentage (0-100)
   * @returns Detailed fare calculation
   */
  calculateFare(
    distanceMiles: number,
    durationMinutes: number,
    driverDiscountPercent: number = 0
  ): FareCalculation {
    // Validate inputs
    if (distanceMiles < 0 || durationMinutes < 0) {
      throw new Error("Distance and duration must be positive numbers");
    }

    if (driverDiscountPercent < 0 || driverDiscountPercent > 100) {
      throw new Error("Driver discount must be between 0 and 100 percent");
    }

    // Convert minutes to hours for time calculation
    const durationHours = durationMinutes / 60;

    // Calculate base charges
    const timeCharge = this.rates.timeRatePerHour * durationHours;
    const distanceCharge = this.rates.mileRate * distanceMiles;
    const subtotal = timeCharge + distanceCharge;

    // Apply driver discount
    const discountAmount = subtotal * (driverDiscountPercent / 100);
    let total = subtotal - discountAmount;

    // Apply minimum fare
    if (total < this.rates.minimumFare) {
      total = this.rates.minimumFare;
    }

    // Apply maximum fare if set
    if (this.rates.maximumFare && total > this.rates.maximumFare) {
      total = this.rates.maximumFare;
    }

    // Generate formula string
    const formula = this.generateFormulaString(
      durationHours,
      distanceMiles,
      driverDiscountPercent
    );

    return {
      timeCharge: this.roundToTwo(timeCharge),
      distanceCharge: this.roundToTwo(distanceCharge),
      subtotal: this.roundToTwo(subtotal),
      driverDiscount: driverDiscountPercent,
      discountAmount: this.roundToTwo(discountAmount),
      total: this.roundToTwo(total),
      formula
    };
  }

  /**
   * Estimate fare with basic inputs
   * @param distanceMiles - Distance in miles
   * @param averageSpeedMph - Average speed for time estimation (default: 25 mph)
   * @param driverDiscountPercent - Driver discount percentage
   * @returns Fare calculation
   */
  estimateFare(
    distanceMiles: number,
    averageSpeedMph: number = 25,
    driverDiscountPercent: number = 0
  ): FareCalculation {
    const estimatedDurationMinutes = (distanceMiles / averageSpeedMph) * 60;
    return this.calculateFare(distanceMiles, estimatedDurationMinutes, driverDiscountPercent);
  }

  /**
   * Get fare range for a given distance
   * @param distanceMiles - Distance in miles
   * @returns Object with minimum and maximum estimated fares
   */
  getFareRange(distanceMiles: number): { min: number; max: number } {
    // Estimate for fast trip (35 mph average)
    const fastTrip = this.estimateFare(distanceMiles, 35);
    
    // Estimate for slow trip (15 mph average, traffic)
    const slowTrip = this.estimateFare(distanceMiles, 15);

    return {
      min: Math.min(fastTrip.total, slowTrip.total),
      max: Math.max(fastTrip.total, slowTrip.total)
    };
  }

  /**
   * Calculate driver earnings after platform commission
   * @param fareTotal - Total fare amount
   * @param commissionPercent - Platform commission percentage
   * @returns Driver earnings
   */
  calculateDriverEarnings(fareTotal: number, commissionPercent: number = 0): number {
    // Currently cash-only, so no commission
    const commission = fareTotal * (commissionPercent / 100);
    return this.roundToTwo(fareTotal - commission);
  }

  /**
   * Validate a fare calculation against business rules
   * @param calculation - Fare calculation to validate
   * @returns Validation result with any issues
   */
  validateFare(calculation: FareCalculation): { isValid: boolean; issues: string[] } {
    const issues: string[] = [];

    if (calculation.total < this.rates.minimumFare) {
      issues.push(`Fare below minimum of $${this.rates.minimumFare}`);
    }

    if (this.rates.maximumFare && calculation.total > this.rates.maximumFare) {
      issues.push(`Fare exceeds maximum of $${this.rates.maximumFare}`);
    }

    if (calculation.driverDiscount > 50) {
      issues.push("Driver discount exceeds 50% maximum");
    }

    if (calculation.timeCharge < 0 || calculation.distanceCharge < 0) {
      issues.push("Invalid negative charges detected");
    }

    return {
      isValid: issues.length === 0,
      issues
    };
  }

  private generateFormulaString(
    durationHours: number,
    distanceMiles: number,
    discountPercent: number
  ): string {
    let formula = `($${this.rates.timeRatePerHour}/hour × ${durationHours.toFixed(2)} hours) + ($${this.rates.mileRate}/mile × ${distanceMiles} miles)`;
    
    if (discountPercent > 0) {
      formula += ` - ${discountPercent}% driver discount`;
    }

    return formula;
  }

  private roundToTwo(num: number): number {
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }

  // Static convenience methods
  static calculate(distanceMiles: number, durationMinutes: number, driverDiscountPercent: number = 0): FareCalculation {
    const calculator = new FareCalculator();
    return calculator.calculateFare(distanceMiles, durationMinutes, driverDiscountPercent);
  }

  static estimate(distanceMiles: number, averageSpeedMph: number = 25): FareCalculation {
    const calculator = new FareCalculator();
    return calculator.estimateFare(distanceMiles, averageSpeedMph);
  }

  static getRange(distanceMiles: number): { min: number; max: number } {
    const calculator = new FareCalculator();
    return calculator.getFareRange(distanceMiles);
  }
}

// Export default instance for convenience
export const fareCalculator = new FareCalculator();

// Utility functions
export const FareUtils = {
  // Format currency for display
  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  },

  // Format fare range for display
  formatFareRange(min: number, max: number): string {
    if (min === max) {
      return this.formatCurrency(min);
    }
    return `${this.formatCurrency(min)} - ${this.formatCurrency(max)}`;
  },

  // Calculate tip percentage
  calculateTipPercent(fareAmount: number, tipAmount: number): number {
    if (fareAmount <= 0) return 0;
    return Math.round((tipAmount / fareAmount) * 100);
  },

  // Suggest tip amounts based on fare
  suggestTipAmounts(fareAmount: number): number[] {
    const tips = [
      Math.round(fareAmount * 0.15 * 100) / 100, // 15%
      Math.round(fareAmount * 0.18 * 100) / 100, // 18%
      Math.round(fareAmount * 0.20 * 100) / 100, // 20%
    ];
    
    // Add a custom round number option
    const roundUp = Math.ceil(fareAmount + tips[1]);
    if (roundUp > tips[2] && roundUp - fareAmount <= fareAmount * 0.25) {
      tips.push(roundUp - fareAmount);
    }

    return tips;
  }
};
