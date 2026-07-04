# PG Ride — App Store Distribution Plan

**One-line:** PG Ride is a PWA. It is installable from the browser today (zero
cost, zero review), can reach the **Google Play Store as a Trusted Web
Activity** with modest effort ($25 one-time), and can reach the **Apple App
Store via a Capacitor wrapper** later ($99/year, real review risk). Do them in
that order — and fix the missing icon assets first, because they block all
three.

---

## 0. BLOCKER — missing PWA assets (fix before anything else)

`client/public/manifest.json` references files that **do not exist in the repo**:

| Referenced | Status |
|---|---|
| `/icons/icon-72.png` … `icon-512.png` (8 sizes) | ❌ missing |
| `/screenshots/screen-rider.png`, `screen-driver.png` | ❌ missing |
| `/icon-192.png`, `/icon-72.png` (used by `sw.js` push notifications) | ❌ missing |

Consequences today: Chrome's install prompt may not fire (installability
requires a valid 192px + 512px icon), Add-to-Home-Screen falls back to a
generic letter tile, push notifications show a broken icon, and TWA/Capacitor
packaging fails outright.

**Action:** produce one 1024×1024 master logo, generate the 8 manifest sizes
(+ maskable variants with safe-zone padding), the two service-worker icon
paths, and real app screenshots. Commit under `client/public/icons/` and
`client/public/screenshots/`.

---

## Track A — PWA direct install (live now, $0, no review)

What already works once icons land:

- `manifest.json` with standalone display, shortcuts, widgets ✅
- Service worker with push notifications (VAPID configured in prod) ✅
- HTTPS on Railway ✅ · Privacy policy (`/privacy`) + Terms (`/terms`) ✅

**Android/Chrome:** visiting the site offers "Install app" → full-screen
standalone app with push. **iOS/Safari:** Share → Add to Home Screen; web push
works on iOS 16.4+ *only after* the app is added to the home screen.

**Launch use:** this is the distribution channel for the Circuits launch
(docs/CIRCUITS_LAUNCH_PLAN.md). Put "Install the app: pgride link" on circuit
flyers — no store approval stands between you and riders. A custom domain
(e.g. `pgride.com`) is strongly recommended before printing anything.

## Track B — Google Play via TWA (next, ~1–2 weeks, $25 one-time)

A **Trusted Web Activity** wraps the live PWA in a thin Android app that Play
accepts. The app content stays the deployed website — every web deploy updates
the "app" instantly, no store re-review for content changes.

Steps:
1. Google Play Console developer account — $25 one-time, identity verification
   can take a few days.
2. Package with **Bubblewrap** (CLI) or **PWABuilder** (web UI, easier) →
   signed `.aab` from the manifest.
3. Host **Digital Asset Links** at `/.well-known/assetlinks.json` on the
   production domain (proves site↔app ownership; removes the browser bar).
   Small code change: serve that static file.
4. Play listing requirements: privacy policy URL ✅ (`/privacy`), **Data
   safety form** (declare: location, name/email/phone, payment info —
   collected, encrypted in transit, not sold), content rating questionnaire,
   feature graphic (1024×500), 2+ phone screenshots.
5. Closed testing track first (Play requires a testing phase for new personal
   accounts — 12 testers/14 days; a business account skips this), then
   production review (typically days).

Notes:
- **Payments are fine.** Rideshare is a physical-world service — Play's
  billing mandate does not apply (same category as Uber/Lyft). Stripe stays.
- **Location:** the app uses foreground web geolocation only — no
  background-location permission, so no special Play video disclosure needed.

## Track C — Apple App Store via Capacitor (later, ~2–4 weeks, $99/year)

iOS has no TWA equivalent; a **Capacitor** shell (WebView + native plugin
bridge) is the standard path for an existing React PWA.

Steps: Apple Developer Program ($99/yr) → add Capacitor to the repo (config +
`ios/` project; web code unchanged) → native push via APNs (web-push/VAPID
does not apply inside the wrapper — this is the one real engineering task;
roughly a week including a server change to send APNs alongside web push) →
build/sign in Xcode (needs a Mac or a cloud Mac CI) → TestFlight beta → review.

Risks, stated honestly:
- **Guideline 4.2 (minimum functionality):** Apple rejects apps that are
  "just a website." Mitigate by shipping native push, native geolocation,
  and home-screen widgets/shortcuts in the wrapper. Rideshare apps have a
  clear reason to exist as apps; risk is real but manageable.
- **Review friction:** Apple review takes days and can reject for demo-account
  or completeness issues. Provide a working demo rider + driver account in
  review notes.
- Payments: physical-services exemption applies on iOS too (guideline
  3.1.5(a)) — Stripe stays.

## Sequencing & budget

| When | What | Cost |
|---|---|---|
| Now (pre-Circuits launch) | Fix icons/screenshots; PWA install is the launch channel | $0 |
| Launch + ~2–4 weeks | Play Store TWA (credibility + discoverability for anchors) | $25 once |
| When traction justifies it | App Store via Capacitor + APNs work | $99/yr + ~1 wk eng |

**Why this order:** the PWA needs zero permission to launch; Play mostly
reuses what exists; Apple demands the most engineering and review risk, and
early riders recruited through anchors (flyers, group codes) don't need a
store to install.

## Prerequisite checklist (all tracks)

- [ ] Master 1024×1024 logo → icon set + maskable variants (BLOCKER, §0)
- [ ] Real screenshots (rider booking, driver dashboard, timetable)
- [ ] Custom domain on Railway + `PUBLIC_APP_URL` updated
- [ ] Support email + physical contact for store listings
- [ ] `/.well-known/assetlinks.json` route (Track B)
- [ ] Demo rider + driver accounts for store review (Track C)

---

*Living document. Update as tracks complete.*
