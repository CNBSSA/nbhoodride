export type SavedCardSummary = {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
};

export function formatMaskedCardLine(last4: string): string {
  const digits = last4.replace(/\D/g, "").slice(-4);
  const safe = digits.length === 4 ? digits : "••••";
  return `•••• •••• •••• ${safe}`;
}

export function formatCardBrandLabel(brand: string): string {
  const b = brand.trim().toLowerCase();
  if (!b) return "Card";
  return b.charAt(0).toUpperCase() + b.slice(1);
}

export function formatCardExpiry(expMonth: number, expYear: number): string {
  const mm = String(expMonth).padStart(2, "0");
  const yy = String(expYear).slice(-2);
  return `${mm}/${yy}`;
}
