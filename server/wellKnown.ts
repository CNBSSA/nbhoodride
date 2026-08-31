/**
 * App-store domain verification endpoints (/.well-known/*).
 *
 * - assetlinks.json (Android): ties the com.pgride.app package to this domain,
 *   so the Play-Store app opens links natively and a TWA shell drops the
 *   browser address bar. Requires the release signing certificate's SHA-256
 *   fingerprint — set ANDROID_CERT_SHA256 (colon-separated hex, comma-separate
 *   multiple certs) once the Play keystore exists.
 * - apple-app-site-association (iOS): enables universal links for the App
 *   Store app. Set APPLE_APP_ID as TEAMID.com.pgride.app once the Apple
 *   Developer team exists.
 *
 * Both return 404 until their env var is set, so this is inert groundwork
 * until store signing identities exist.
 */

import type { Express, Request, Response } from "express";

const ANDROID_PACKAGE = "com.pgride.app";

export function registerWellKnown(app: Express): void {
  app.get("/.well-known/assetlinks.json", (_req: Request, res: Response) => {
    const raw = (process.env.ANDROID_CERT_SHA256 || "").trim();
    if (!raw) return res.status(404).json({ message: "Not configured" });
    const fingerprints = raw.split(",").map((f) => f.trim()).filter(Boolean);
    res
      .type("application/json")
      .set("Cache-Control", "public, max-age=3600")
      .json([
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: {
            namespace: "android_app",
            package_name: ANDROID_PACKAGE,
            sha256_cert_fingerprints: fingerprints,
          },
        },
      ]);
  });

  app.get("/.well-known/apple-app-site-association", (_req: Request, res: Response) => {
    const appId = (process.env.APPLE_APP_ID || "").trim(); // e.g. "TEAMID.com.pgride.app"
    if (!appId) return res.status(404).json({ message: "Not configured" });
    res
      .type("application/json")
      .set("Cache-Control", "public, max-age=3600")
      .json({
        applinks: {
          apps: [],
          details: [{ appID: appId, paths: ["*"] }],
        },
      });
  });
}
