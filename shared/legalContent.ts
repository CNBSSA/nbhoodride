/**
 * Terms of Service and Privacy Policy — one source of truth.
 *
 * Rendered two ways from this data: by the app (client/src/pages/LegalPages.tsx,
 * with the in-app Back button) and by the server as plain HTML
 * (server/publicPages.ts) so a visitor or reviewer whose browser does not run
 * JavaScript — Stripe's website crawler, a search engine, a link unfurler —
 * reads the actual policy instead of an empty app shell.
 *
 * Keep the wording here in step with what the app actually does; the
 * cancellation ladder below is the one server/rideWorkflowService.ts charges.
 */

import { BRAND } from "./branding";

export const LEGAL_LAST_UPDATED = "September 8, 2026";
export const LEGAL_ENTITY_NAME = "Thrynova Insights LLC";

export interface LegalBullet {
  /** Optional bold lead-in, e.g. "Account information:" */
  label?: string;
  text: string;
}

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  bullets?: LegalBullet[];
  /** A closing paragraph after the bullets. */
  after?: string;
  /** Render the support contact links (phone, text, email) under this section. */
  contact?: boolean;
}

export const TERMS_SECTIONS: LegalSection[] = [
  {
    heading: "1. About PG Ride",
    paragraphs: [
      `PG Ride ("PG Ride," "we," "us," or "our") is a rideshare service operated by ${LEGAL_ENTITY_NAME} in Prince George's County, Maryland. We connect verified riders with background-checked drivers for local trips, and riders pay a per-ride fare by card. ${BRAND.foundedNote} By creating an account or using our services, you agree to these Terms of Service.`,
    ],
  },
  {
    heading: "2. Eligibility",
    paragraphs: [
      "You must be at least 18 years old and a resident of or have a valid reason to travel within Maryland. Accounts require administrator approval before becoming active. You must provide accurate information during registration.",
    ],
  },
  {
    heading: "3. Payments",
    paragraphs: [
      "Riders pay a per-ride fare charged to their payment card, processed securely by Stripe. When a driver accepts, the fare is authorized as a hold on the card and captured when the ride completes, or released if the ride is cancelled. There is no stored-value balance or prepaid wallet. No surge pricing is applied on PG Ride — fares are calculated transparently using distance and time only, and the fare shown before you confirm is the fare charged.",
    ],
  },
  {
    heading: "4. Promotional Ride Discounts",
    paragraphs: [
      "New riders receive up to 4 promotional ride discounts of $5 each, applied automatically to eligible fares after account approval. These discounts are for personal use only, are non-transferable, and expire 12 months from account creation. One promotion applies per ride. We reserve the right to revoke them for abuse or fraudulent activity.",
    ],
  },
  {
    heading: "5. Driver Requirements",
    paragraphs: [
      "Drivers must submit valid identification, a driver's license, vehicle registration, and proof of insurance for verification. Drivers must comply with all applicable Maryland traffic laws and maintain a valid license at all times while driving on the platform. Driver accounts may be suspended or permanently banned for safety violations, low ratings, or fraudulent conduct.",
    ],
  },
  {
    heading: "6. Cancellation Policy",
    paragraphs: [
      "Cancelling is free while your request is still waiting for a driver, and for 3 minutes after a driver accepts. After that a small fee compensates the driver for their time and fuel: $3.50 if you cancel 3 to 5 minutes after the driver accepted, $5.00 after 5 minutes, and $7.00 once the driver has arrived and is waiting. Scheduled rides cancel free more than 2 hours before departure. If the driver or PG Ride cancels, you are never charged.",
    ],
  },
  {
    heading: "7. SOS & Safety Features",
    paragraphs: [
      "PG Ride provides an SOS emergency feature for in-ride emergencies. This feature should only be used in genuine emergencies. Misuse of the SOS feature may result in account suspension. We are not a 911 service and are not responsible for emergency response times.",
    ],
  },
  {
    heading: "8. Prohibited Conduct",
    paragraphs: [
      "You may not: use the platform for illegal activity; harass or threaten other users or drivers; create fraudulent accounts; attempt to circumvent fare or payment systems; reverse-engineer the platform; or resell access to the platform.",
    ],
  },
  {
    heading: "9. Limitation of Liability",
    paragraphs: [
      "PG Ride is a technology platform connecting riders and drivers. We are not a transportation carrier. Drivers are independent contractors. To the maximum extent permitted by law, PG Ride is not liable for personal injury, property damage, or other losses arising from rides facilitated through our platform. Our maximum liability to you for any claim is limited to the amount paid through your account in the 30 days preceding the claim.",
    ],
  },
  {
    heading: "10. Dispute Resolution",
    paragraphs: [
      "Disputes between riders and drivers should first be reported through the in-app dispute system. We will review disputes within 5 business days. Our decision is final for amounts under $100. For larger disputes, parties may pursue mediation under Maryland law.",
    ],
  },
  {
    heading: "11. Changes to These Terms",
    paragraphs: [
      "We may update these Terms at any time. We will notify you of material changes via email or in-app notification. Continued use of the platform after changes constitutes acceptance of the new Terms.",
    ],
  },
  {
    heading: "12. Contact",
    paragraphs: [`For support, questions and enquiries, contact ${LEGAL_ENTITY_NAME} any of these ways:`],
    contact: true,
  },
];

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    heading: "1. Information We Collect",
    paragraphs: ["We collect the following information when you use PG Ride:"],
    bullets: [
      { label: "Account information:", text: "Name, email, phone number, and password (hashed)" },
      { label: "Location data:", text: "GPS coordinates during active rides and route tracking" },
      { label: "Payment information:", text: "Payment card on file and ride transaction history (card details handled by Stripe)" },
      { label: "Driver documents:", text: "License, registration, and insurance uploads for verification" },
      { label: "Ride data:", text: "Origin, destination, timestamps, fare, and driver/rider feedback" },
      { label: "Usage data:", text: "App interactions, feature usage, and in-app AI assistant conversations" },
    ],
  },
  {
    heading: "2. How We Use Your Information",
    bullets: [
      { text: "To match riders with nearby drivers" },
      { text: "To process card payments for your rides" },
      { text: "To verify driver identities and credentials" },
      { text: "To provide real-time GPS tracking during rides" },
      { text: "To operate the SOS emergency feature and contact emergency services if needed" },
      { text: "To improve the platform and resolve disputes" },
      { text: "To send service notifications (not marketing without consent)" },
    ],
  },
  {
    heading: "3. Location Data",
    paragraphs: [
      "We collect your precise location only during active rides. For drivers, location is shared with matched riders in real time so they can track their pickup. Location data is not collected when the app is closed. We retain ride route data for 90 days for dispute resolution, then anonymize it.",
    ],
  },
  {
    heading: "4. Data Sharing",
    paragraphs: ["We share your information only as follows:"],
    bullets: [
      { label: "Drivers & Riders:", text: "First name, profile photo, and vehicle info are shared between matched parties during rides" },
      { label: "Stripe:", text: "Payment processing (Stripe Privacy Policy applies)" },
      { label: "Emergency services:", text: "Location and contact info shared if SOS is triggered" },
      { label: "Legal requirements:", text: "If required by law or court order" },
    ],
    after: "We do not sell your personal information. Ever.",
  },
  {
    heading: "5. AI Assistant",
    paragraphs: [
      "Conversations with our in-app AI assistant are used to provide responses and may be reviewed to improve safety and service quality. Do not share sensitive personal information (e.g., full SSN, financial account numbers) in AI conversations.",
    ],
  },
  {
    heading: "6. Data Security",
    paragraphs: [
      "We use industry-standard security including encrypted connections (HTTPS/TLS), bcrypt password hashing, and secure cloud storage for driver documents. Despite these measures, no system is 100% secure. Please use a strong, unique password.",
    ],
  },
  {
    heading: "7. Data Retention",
    paragraphs: [
      "We retain your account data as long as your account is active. Ride history is retained for 3 years for tax and legal purposes. You may request account deletion at any time — we will delete personal data within 30 days, except data we are legally required to retain.",
    ],
  },
  {
    heading: "8. Your Rights",
    paragraphs: [
      "Under Maryland and applicable U.S. law, you have the right to: access your personal data, correct inaccurate data, request deletion of your data, opt out of non-essential communications, and receive a copy of your data in a portable format. To exercise these rights, contact us at the email address in the Contact section.",
    ],
  },
  {
    heading: "9. Delete Your Account",
    paragraphs: [
      "You can permanently delete your PG Ride account at any time: open the app, go to Profile → Delete account, and confirm with your password. Deletion removes your personal information (name, email, phone, photos, documents, and saved payment method). Ride and payment records are retained in anonymized form as required for legal and financial record-keeping. If you can't access the app, email us at the address in the Contact section from your account email and we'll process the deletion for you.",
    ],
  },
  {
    heading: "10. Children's Privacy",
    paragraphs: ["PG Ride is not intended for users under 18. We do not knowingly collect personal information from minors."],
  },
  {
    heading: "11. Contact",
    paragraphs: ["Questions about your privacy? Reach us any of these ways:"],
    contact: true,
  },
];

export const LEGAL_PAGES = {
  terms: { path: "/terms", title: "Terms of Service", sections: TERMS_SECTIONS },
  privacy: { path: "/privacy", title: "Privacy Policy", sections: PRIVACY_SECTIONS },
} as const;
export type LegalPageKind = keyof typeof LEGAL_PAGES;
