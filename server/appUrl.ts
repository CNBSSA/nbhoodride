// Canonical public URL of the app, resolved from the environment.
//
// Historically email links read APP_URL while guardian/SMS share links read
// PUBLIC_APP_URL, and a value entered without a scheme (e.g.
// "nbhoodride-production.up.railway.app" — easy to do when copying the domain
// from Railway's Networking tab) produced relative, broken links. This
// resolver is the single source of truth: every link builder goes through it,
// any of the three variables works, and the value is normalized to
// "https://host" with no trailing slash.
export function resolveAppUrl(fallback = ""): string {
  const raw =
    process.env.PUBLIC_APP_URL ||
    process.env.APP_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "") ||
    fallback;
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}
