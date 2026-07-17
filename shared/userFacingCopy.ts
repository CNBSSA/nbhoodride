/** Canonical user-facing wallet + payment copy (USER_FRIENDLINESS_ASSESSMENT). */
import { BRAND } from "./branding";

export const PG_CARD = {
  name: "PG Card",
  subtitle: "In-app wallet",
  fullLabel: "PG Card (in-app wallet)",
  payLine: "Paid from your PG Card",
  confirmLine: "Charged to your PG Card when you confirm",
  lowBalanceTitle: "Add funds to your PG Card",
  lowBalanceBody:
    "Your PG Card balance is lower than this fare. Add funds in Profile before booking, or use a welcome promo ride if you have one left.",
  landingFeature: "Pay with your PG Card — no surge pricing",
  profileMethods: "PG Card balance + optional card top-up",
} as const;

export const PG_EXPANDED = `${BRAND.pgMeans} (${BRAND.appName})`;

export function humanizePaymentStatus(status: string | null | undefined): string {
  if (!status) return "Unknown";
  const s = status.toLowerCase().replace(/_/g, " ");
  const map: Record<string, string> = {
    completed: "Paid",
    paid: "Paid",
    pending: "Processing",
    authorized: "Authorized — not yet captured",
    failed: "Payment failed",
    refunded: "Refunded",
    cancelled: "Cancelled",
    "pending payment": "Awaiting payment",
  };
  return map[s] ?? s.charAt(0).toUpperCase() + s.slice(1);
}

export function parseBookingErrorMessage(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("balance") || m.includes("insufficient") || m.includes("funds")) {
    return "Your PG Card balance is too low for this ride. Add funds in Profile and try again.";
  }
  if (m.includes("driver") && (m.includes("unavailable") || m.includes("not found"))) {
    return "That driver is no longer available. Pick another driver or try again in a moment.";
  }
  if (m.includes("approve") || m.includes("pending approval")) {
    return "Your account still needs administrator approval before you can book.";
  }
  if (m.includes("verify") && m.includes("email")) {
    return "Please verify your email before booking. Use Resend verification on the login page.";
  }
  if (m.includes("geocode") || m.includes("address") || m.includes("destination")) {
    return "We couldn't use that destination. Try picking an address from the suggestions list.";
  }
  return message || "Unable to book your ride. Please try again.";
}

export const CALM_MODE_DESCRIPTIONS: Record<string, string> = {
  off: "Standard notifications and prompts.",
  focus: "Fewer distractions; only essential ride updates.",
  calm: "Quieter alerts and a simpler home screen feel.",
  social: "Highlights community and shared-ride options.",
  family: "Prioritizes family tracking and guardian links.",
};

export const SUPPORT = {
  email: "support@peoplegoverned.com",
  faqHint: "Ask the PG Ride assistant in the Book tab for quick answers.",
} as const;
