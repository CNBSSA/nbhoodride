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

const LEGAL_ENTITY = "Thrynova Insights LLC";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function renderAboutPage(): string {
  const year = 2026; // Date.* is unavailable in some sandboxes; a static year is fine for a footer.
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(BRAND.appName)} — Community-owned rideshare in Maryland</title>
<meta name="description" content="${esc(BRAND.appName)} is a community rideshare marketplace. Riders book local trips and are matched with background-checked neighborhood drivers. Pickups in Maryland; drop-offs in Maryland, Washington DC, and northern Virginia. Transparent fares, no surge pricing." />
<meta name="robots" content="index,follow" />
<link rel="canonical" href="https://${esc(BRAND.companyDomain)}/about" />
<meta property="og:title" content="${esc(BRAND.appName)} — Community-owned rideshare" />
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
      <p class="brand">${esc(BRAND.companyName)} · ${esc(BRAND.pgMeans)}</p>
      <h1>${esc(BRAND.appName)}: community-owned rideshare</h1>
      <p class="tagline">${esc(BRAND.shortDescription)} Your ride from neighbors, by neighbors.</p>
    </div>
  </header>

  <main class="wrap">
    <section>
      <h2>What we do</h2>
      <p>
        ${esc(BRAND.appName)} is a community rideshare (transportation-network)
        marketplace. Riders request an on-demand or scheduled local trip through
        our app and are matched with a vetted community driver. We sell local
        passenger transportation — there are no physical goods or digital
        downloads.
      </p>
    </section>

    <section>
      <h2>How it works</h2>
      <div class="cards">
        <div class="card"><h3>1. Book a ride</h3><p>Enter your pickup and destination. See a transparent fare up front — no surge pricing.</p></div>
        <div class="card"><h3>2. Match with a driver</h3><p>A background-checked neighborhood driver accepts and picks you up.</p></div>
        <div class="card"><h3>3. Ride &amp; pay</h3><p>Pay by prepaid in-app balance or card. Drivers are paid out after the trip.</p></div>
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
      <p>
        ${esc(BRAND.appName)} operates as a marketplace facilitator. Riders pay
        per-ride fares and can top up a prepaid in-app balance. Card payments and
        driver payouts are processed securely through Stripe. Card authorizations
        use manual-capture holds that are captured when a ride completes or
        released if it is cancelled — the standard model for rideshare.
      </p>
    </section>

    <section>
      <h2>Get started</h2>
      <p>
        <a class="cta" href="/signup">Sign up</a>
        <a class="cta secondary" href="/login">Log in</a>
      </p>
    </section>
  </main>

  <footer>
    <div class="wrap">
      <p>
        ${esc(BRAND.foundedNote)}<br />
        Operated by ${esc(LEGAL_ENTITY)}. Questions? <a href="mailto:${esc(BRAND.supportEmail)}">${esc(BRAND.supportEmail)}</a>.
      </p>
      <p>
        <a href="/terms">Terms of Service</a> ·
        <a href="/privacy">Privacy Policy</a>
      </p>
      <p>&copy; ${year} ${esc(BRAND.companyName)}. All rights reserved.</p>
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
