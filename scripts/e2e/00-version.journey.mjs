import { Session, check, section, FIXTURES } from "./harness.mjs";
/** The self-update contract: the server tells clients which build is live. */
export async function run({ base }) {
  section("Build id");
  const r = await fetch(base + "/api/version");
  const j = await r.json();
  check("/api/version serves a build id", r.status === 200 && typeof j.id === "string" && j.id.length >= 4, JSON.stringify(j));
  check("not cached", /no-store/.test(r.headers.get("cache-control") || ""));

  // What a reviewer (Stripe, a search engine) or a first-time visitor sees
  // at the bare domain: the business page, with the policies Stripe's
  // website checklist requires — not the app's sign-in screen.
  section("Bare domain is the business page; the app stays the app");
  const html = { headers: { Accept: "text/html" } };
  const root = await fetch(base + "/", html);
  const rootBody = await root.text();
  check("logged-out visit to / gets the business page", root.status === 200 && !rootBody.includes('id="root"') && rootBody.includes("Rideshare"), `status=${root.status}`);
  for (const must of ["Thrynova Insights LLC", "Refunds, cancellations", "$3.50", "Promotions", "30% off", "Contact us", "/privacy", "/terms"]) {
    check(`business page states: ${must}`, rootBody.includes(must));
  }
  const pwa = await fetch(base + "/?source=pwa", html);
  check("installed app start URL serves the app", (await pwa.text()).includes('id="root"'));
  const qr = await fetch(base + "/?qr=1", html);
  check("QR install link serves the app", (await qr.text()).includes('id="root"'));
  const s = new Session(base);
  await s.login(FIXTURES.rider.email);
  const signedIn = await fetch(base + "/", { headers: { Accept: "text/html", Cookie: s.cookieHeader() } });
  check("a signed-in rider at / gets the app", (await signedIn.text()).includes('id="root"'));
  const about = await fetch(base + "/about", html);
  const aboutBody = await about.text();
  check("/about still serves the business page", about.status === 200 && aboutBody.includes("Refunds, cancellations"));
  check("business page links to the driver page", aboutBody.includes('href="/drive"'));

  // Driver recruiting page: leads with the split, no sign-in needed.
  section("Driver page leads with 85%");
  const drive = await fetch(base + "/drive", html);
  const driveBody = await drive.text();
  check("/drive serves without a session", drive.status === 200 && !driveBody.includes('id="root"'), `status=${drive.status}`);
  for (const must of ["85%", "100% of every tip", "$19.73", "card-processing fees", "Standing rides", "/signup", "Contact us"]) {
    check(`driver page states: ${must}`, driveBody.includes(must));
  }
  check("driver page never promises surge or bonuses it doesn't pay", !/surge bonus|guaranteed earnings/i.test(driveBody));
}
