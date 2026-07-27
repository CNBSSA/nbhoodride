import { SUPPORT_CONTACTS } from "./supportContacts";

/** Shared product + company branding (PG = People-Governed). */
export const BRAND = {
  appName: "PG Ride",
  companyName: "People-Governed",
  companyDomain: "peoplegoverned.com",
  tagline: "People-Governed · Community-owned mobility",
  shortDescription:
    "Community-owned rideshare. Verified neighbors, transparent fares, no surge pricing.",
  pgMeans: "People-Governed",
  foundedNote: "Founded in Prince George's County, Maryland — built for communities everywhere.",
  supportEmail: SUPPORT_CONTACTS.email,
  supportPhoneDisplay: SUPPORT_CONTACTS.phoneDisplay,
  supportPhoneTel: SUPPORT_CONTACTS.phoneTel,
  supportPhoneSms: SUPPORT_CONTACTS.phoneSms,
} as const;
