# QR code → install gate

When someone scans your PG Ride QR code, they should land on a URL that **requires install** before signup, login, or booking.

## QR URL (use on printed codes)

```text
https://peoplegoverned.com/?qr=1
```

**Printable asset:** run `node scripts/generate-install-qr.mjs` (requires `npm install qrcode` once) → `docs/qr/pg-ride-install-qr.png`.  
Or use any QR generator with the URL above.

Alternatives (same behavior):

- `?from=qr`
- `?install=1` or `?install=required`

You can append referral or campaign params: `?qr=1&ref=campaign`

## What users see

1. **Full-screen install gate** — nothing else until the app is installed (or dev skip in local builds).
2. **Android (Chrome):** install dialog is **auto-triggered** when the browser allows it; fallback text for manual install.
3. **iPhone (Safari):** clear **Share → Add to Home Screen** steps (Apple does not allow automatic install).
4. After install, they open **PG Ride from the home screen icon** — the gate clears automatically.

## Exempt paths (no gate)

Emergency and legal pages still work without install:

- `/emergency/:token`
- `/guardian/:token`
- `/terms`, `/privacy`

## Limitations (honest expectations)

| Platform | Automatic install? |
|----------|-------------------|
| Android Chrome | Yes, when `beforeinstallprompt` fires |
| iPhone Safari | **No** — user must Add to Home Screen manually |
| Desktop QR | Message to open link on phone |

True App Store / Play Store one-tap install requires published native builds (see `APP_STORE_PLAN.md`).

## Testing

1. Open `/?qr=1` on a phone in Safari or Chrome (not already installed).
2. Confirm gate blocks login/signup.
3. Install PWA, open from home screen — gate should not appear.
4. Clear site data and retry Android auto-prompt.
