/**
 * Server-rendered PUBLIC pages — no JavaScript required.
 *
 * The rider/driver app is a client-rendered React SPA: the server ships an
 * empty <div id="root"> shell and the browser fills it in. That's fine for
 * humans, but automated reviewers that DON'T run JavaScript (Stripe's website
 * verification crawler, Google, link unfurlers) see a blank shell and conclude
 * the site is empty or "password protected."
 *
 * This module serves a fully static, self-contained HTML business page that
 * such crawlers CAN read. It describes what PG Ride is, how it works, the
 * service area, pricing, safety, and how payments are processed — everything a
 * payments/compliance reviewer needs to understand and categorize the business
 * without logging in.
 *
 * Registered inside registerRoutes(), so it takes precedence over the SPA
 * catch-all (which is mounted later, in serveStatic/setupVite).
 */

import type { Express, Request, Response } from "express";
import { BRAND } from "@shared/branding";
import { SUPPORT_CONTACTS } from "@shared/supportContacts";
import { featureFlags } from "./featureFlags";

const LEGAL_ENTITY = "Thrynova Insights LLC";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function renderAboutPage(): string {
  const year = 2026; // Date.* is unavailable in some sandboxes; a static year is fine for a footer.
  // Lean mode: describe a plain per-ride card-charge rideshare — no stored-value
  // wallet ("prepaid balance"), no marketplace/driver-payout language, no
  // community-ownership framing. This is the page Stripe's crawler reads.
  const wallet = featureFlags.walletEnabled;
  const marketplace = featureFlags.driverMarketplaceEnabled;
  const titleDesc = wallet ? "Community-owned rideshare in Maryland" : "Rideshare in Prince George's County, Maryland";
  const metaDesc = wallet
    ? `${esc(BRAND.appName)} is a community rideshare marketplace. Riders book local trips and are matched with background-checked neighborhood drivers. Pickups in Maryland; drop-offs in Maryland, Washington DC, and northern Virginia. Transparent fares, no surge pricing.`
    : `${esc(BRAND.appName)} is a rideshare service in Prince George's County, Maryland. Riders book local trips with background-checked drivers and pay by card. Pickups in Maryland; drop-offs in Maryland, Washington DC, and northern Virginia. Transparent fares, no surge pricing.`;
  const ogTitle = wallet ? `${esc(BRAND.appName)} — Community-owned rideshare` : `${esc(BRAND.appName)} — Rideshare in Maryland`;
  const h1 = wallet ? `${esc(BRAND.appName)}: community-owned rideshare` : `${esc(BRAND.appName)}: rideshare in Prince George's County, Maryland`;
  const rideAndPay = wallet
    ? "Pay by prepaid in-app balance or card. Drivers are paid out after the trip."
    : "Pay securely by card. Your card is authorized when a driver accepts and charged when the ride completes.";
  const paymentsBody = wallet
    ? `${esc(BRAND.appName)} operates as a marketplace facilitator. Riders pay per-ride fares and can top up a prepaid in-app balance. Card payments and driver payouts are processed securely through Stripe. Card authorizations use manual-capture holds that are captured when a ride completes or released if it is cancelled — the standard model for rideshare.`
    : `${esc(BRAND.appName)} charges riders a per-ride fare to their payment card, processed securely through Stripe. When a driver accepts, the fare is authorized as a manual-capture hold; it is captured when the ride completes and released if the ride is cancelled — the standard model for rideshare. There is no stored balance or prepaid wallet.`;
  const headerTagline = wallet
    ? `${esc(BRAND.shortDescription)} Your ride from neighbors, by neighbors.`
    : "On-demand rides in Prince George's County, Maryland. Background-checked local drivers, transparent fares up front, no surge pricing.";
  const whatWeDo = wallet
    ? `${esc(BRAND.appName)} is a community rideshare (transportation-network) marketplace. Riders request an on-demand or scheduled local trip through our app and are matched with a vetted community driver. We sell local passenger transportation — there are no physical goods or digital downloads.`
    : `${esc(BRAND.appName)} is a rideshare (transportation-network) service. Riders request an on-demand or scheduled local trip through our app and are matched with a background-checked driver. We sell local passenger transportation — there are no physical goods or digital downloads.`;
  // Hero eyebrow. In lean (card-only) mode we deliberately drop the
  // "People-Governed" governance framing here: to a payments/compliance
  // reviewer scanning for restricted industries, "people-governed /
  // community-owned" reads like member ownership or a securities/co-op
  // arrangement. The lean site is a plain rideshare, so it should say so.
  const brandEyebrow = wallet
    ? `${esc(BRAND.companyName)} · ${esc(BRAND.pgMeans)}`
    : "Rideshare · Prince George's County, Maryland";
  // "What you're paying for" — answers Stripe's restricted-business question
  // directly on the page their crawler reads.
  const payForItems = wallet
    ? `<li><strong>A per-ride fare</strong> for local passenger transportation, charged to your card through Stripe; riders may optionally pre-load an in-app balance used only toward fares.</li>
        <li><strong>No investment, equity, shares, or securities</strong> of any kind.</li>
        <li><strong>No physical goods and no digital downloads.</strong></li>`
    : `<li><strong>A per-ride fare</strong> for a local ride — charged to your payment card through Stripe. That is the only thing riders pay for.</li>
        <li><strong>No stored value or prepaid wallet</strong> — we hold no balance on your behalf and transmit no money.</li>
        <li><strong>No third-party payouts or marketplace</strong> — you are paying ${esc(BRAND.appName)} for the ride, not funding another seller.</li>
        <li><strong>No investment, equity, shares, or securities</strong> of any kind.</li>
        <li><strong>No physical goods and no digital downloads.</strong></li>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(BRAND.appName)} — ${titleDesc}</title>
<meta name="description" content="${metaDesc}" />
<meta name="robots" content="index,follow" />
<link rel="canonical" href="https://${esc(BRAND.companyDomain)}/about" />
<meta property="og:title" content="${ogTitle}" />
<meta property="og:description" content="Verified neighborhood drivers, transparent fares, no surge pricing. Pickups in Maryland; drop-offs across the DMV." />
<meta property="og:type" content="website" />
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
    color: #1a1d21;
    background: #ffffff;
  }
  a { color: #1c7ed6; }
  .wrap { max-width: 820px; margin: 0 auto; padding: 0 20px; }
  header.hero {
    background: linear-gradient(135deg, #1971c2 0%, #0c5bb5 100%);
    color: #fff;
    padding: 56px 0 48px;
  }
  header.hero .wrap { padding-top: 0; }
  .brand { font-size: 15px; letter-spacing: .12em; text-transform: uppercase; opacity: .9; margin: 0 0 10px; }
  h1 { font-size: 2.1rem; line-height: 1.2; margin: 0 0 12px; }
  .tagline { font-size: 1.15rem; opacity: .95; margin: 0; max-width: 44ch; }
  h2 { font-size: 1.35rem; margin: 40px 0 10px; }
  section { padding: 8px 0; }
  ul { padding-left: 1.2em; }
  li { margin: 6px 0; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 16px; margin-top: 12px; }
  .card { border: 1px solid #e6e8eb; border-radius: 12px; padding: 18px; }
  .card h3 { margin: 0 0 6px; font-size: 1.05rem; }
  .card p { margin: 0; color: #495057; font-size: .95rem; }
  .cta { display: inline-block; margin-top: 8px; margin-right: 10px; background: #1971c2; color: #fff; text-decoration: none; padding: 12px 22px; border-radius: 10px; font-weight: 600; }
  .cta.secondary { background: transparent; color: #1971c2; border: 1px solid #1971c2; }
  footer { border-top: 1px solid #e6e8eb; margin-top: 48px; padding: 28px 0 48px; color: #6b7178; font-size: .9rem; }
  footer a { color: #6b7178; }
  @media (prefers-color-scheme: dark) {
    body { background: #101418; color: #e6e8eb; }
    .card { border-color: #2b3138; }
    .card p { color: #aeb4bb; }
    footer { border-color: #2b3138; color: #99a0a8; }
    footer a { color: #99a0a8; }
  }
</style>
</head>
<body>
  <header class="hero">
    <div class="wrap">
      <p class="brand">${brandEyebrow}</p>
      <h1>${h1}</h1>
      <p class="tagline">${headerTagline}</p>
    </div>
  </header>

  <main class="wrap">
    <section>
      <h2>What we do</h2>
      <p>
        ${whatWeDo}
      </p>
    </section>

    <section>
      <h2>How it works</h2>
      <div class="cards">
        <div class="card"><h3>1. Book a ride</h3><p>Enter your pickup and destination. See a transparent fare up front — no surge pricing.</p></div>
        <div class="card"><h3>2. Match with a driver</h3><p>A background-checked neighborhood driver accepts and picks you up.</p></div>
        <div class="card"><h3>3. Ride &amp; pay</h3><p>${rideAndPay}</p></div>
      </div>
    </section>

    <section>
      <h2>Where we operate</h2>
      <p>
        Trips originate in <strong>Maryland</strong>. Drop-offs are available in
        <strong>Maryland, Washington&nbsp;DC, and northern Virginia</strong>.
        Pickups are limited to Maryland in line with local for-hire
        transportation regulations.
      </p>
    </section>

    <section>
      <h2>Trust &amp; safety</h2>
      <ul>
        <li>Every driver passes identity verification and a background check before accepting rides.</li>
        <li>Riders and drivers rate each other after every trip.</li>
        <li>Built-in safety features, including in-app SOS and live trip sharing.</li>
        <li>Transparent, fixed fares with no surge pricing.</li>
      </ul>
    </section>

    <section>
      <h2>How payments work</h2>
      <p>${paymentsBody}</p>
    </section>

    <section id="what-you-pay-for">
      <h2>What you're paying for</h2>
      <p>${esc(BRAND.appName)} sells one thing — a local ride. For clarity for riders and payment partners:</p>
      <ul>
        ${payForItems}
      </ul>
    </section>

    <section>
      <h2>Get started</h2>
      <p>
        <a class="cta" href="/signup">Sign up</a>
        <a class="cta secondary" href="/login">Log in</a>
      </p>
    </section>

    <section id="contact">
      <h2>Contact us</h2>
      <p>Questions, help with a ride, or a refund? Reach our support team:</p>
      <ul>
        <li><strong>Phone / text:</strong> <a href="tel:${esc(SUPPORT_CONTACTS.phoneTel)}">${esc(SUPPORT_CONTACTS.phoneDisplay)}</a>
          (<a href="${esc(SUPPORT_CONTACTS.phoneSms)}">text us</a>)</li>
        <li><strong>Email:</strong> <a href="mailto:${esc(SUPPORT_CONTACTS.email)}">${esc(SUPPORT_CONTACTS.email)}</a></li>
        <li><strong>Operated by:</strong> ${esc(LEGAL_ENTITY)}, Prince George's County, Maryland, USA</li>
      </ul>
      <p>${esc(SUPPORT_CONTACTS.channelsNote)}</p>
    </section>
  </main>

  <footer>
    <div class="wrap">
      <p>
        ${esc(BRAND.foundedNote)}<br />
        Operated by ${esc(LEGAL_ENTITY)}. Questions? Email <a href="mailto:${esc(SUPPORT_CONTACTS.email)}">${esc(SUPPORT_CONTACTS.email)}</a>,
        text <a href="${esc(SUPPORT_CONTACTS.phoneSms)}">${esc(SUPPORT_CONTACTS.phoneDisplay)}</a>,
        or call <a href="tel:${esc(SUPPORT_CONTACTS.phoneTel)}">${esc(SUPPORT_CONTACTS.phoneDisplay)}</a>.
      </p>
      <p>
        <a href="/terms">Terms of Service</a> ·
        <a href="/privacy">Privacy Policy</a>
      </p>
      <p>&copy; ${year} ${wallet ? esc(BRAND.companyName) : esc(LEGAL_ENTITY)}. All rights reserved.</p>
    </div>
  </footer>
</body>
</html>`;
}

/**
 * Mount the public, no-JS pages. Call this early in registerRoutes so these
 * routes win over the SPA catch-all mounted later.
 */
export function registerPublicPages(app: Express): void {
  const serveAbout = (_req: Request, res: Response) => {
    res
      .status(200)
      .type("html")
      // Cacheable but revalidated — content is static but rarely changes.
      .set("Cache-Control", "public, max-age=300, must-revalidate")
      .send(renderAboutPage());
  };

  app.get("/about", serveAbout);
  app.get("/business", serveAbout);
}
