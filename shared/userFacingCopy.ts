/** Canonical user-facing wallet + payment copy (USER_FRIENDLINESS_ASSESSMENT). */
import { BRAND } from "./branding";
import { SUPPORT_CONTACTS } from "./supportContacts";

// Card-only (lean) payment copy. Wallet/stored-value wording was removed so
// nothing a rider or payment reviewer sees implies an in-app wallet, stored
// balance, or top-up. (These strings render in payment UI; the wallet-specific
// screens they used to serve are hidden when the wallet feature is disabled.)
export const PG_CARD = {
  name: "card",
  subtitle: "Card payment",
  fullLabel: "Card payment",
  payLine: "Charged to your card",
  confirmLine: "Charged to your card when you confirm",
  lowBalanceTitle: "Payment couldn't be completed",
  lowBalanceBody:
    "We couldn't charge your card for this ride. Please check your payment method and try again.",
  landingFeature: "Pay securely by card — no surge pricing",
  profileMethods: "Card on file",
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
    return "We couldn't charge your card for this ride. Please check your payment method and try again.";
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
  email: SUPPORT_CONTACTS.email,
  phoneDisplay: SUPPORT_CONTACTS.phoneDisplay,
  phoneTel: SUPPORT_CONTACTS.phoneTel,
  phoneSms: SUPPORT_CONTACTS.phoneSms,
  channelsNote: SUPPORT_CONTACTS.channelsNote,
  faqHint: "Ask the PG Ride assistant in the Book tab for quick answers.",
} as const;
