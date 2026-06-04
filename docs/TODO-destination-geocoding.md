# TODO — Destination geocoding fails on real addresses

**Status:** Not started. Logged 2026-06-04. To pick up after the AH-061..065 verification engagement.

**Reported by:** Festus.

## Symptom

When a rider books a ride:
- ✅ Pickup field auto-populates from the browser's geolocation (works fine).
- ❌ Destination field: rider types a real, valid address. App says "Address Not Found" / refuses to set destination coordinates.

User-visible toast: `"Address Not Found — We couldn't locate that destination. Try a more specific address."`
(Defined at `client/src/pages/RiderDashboard.tsx:314` and replicated across the other booking flows.)

## Where the code lives

Geocoding is duplicated across five booking flows, all using the same pattern: a browser-side fetch to Nominatim (free OpenStreetMap geocoder):

| File | Line |
|---|---|
| `client/src/components/RideBookingModal.tsx` | 169 |
| `client/src/components/ScheduleRideModal.tsx` | 163 |
| `client/src/components/SharedScheduleSheet.tsx` | 31 |
| `client/src/components/JoinScheduleModal.tsx` | 19 |
| `client/src/components/MultiStopBookingSheet.tsx` | 39 |

The pattern in every file:

```ts
const res = await fetch(
  `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}&limit=1&countrycodes=us`,
  { headers: { 'User-Agent': 'PGRide-Community-Rideshare/1.0' } }
);
```

When `results.length === 0`, `destCoords` stays `null`, the toast fires, the rider can't proceed.

## Likely root causes (ranked by probability)

1. **`User-Agent` header is silently ignored by browsers.** It's on the [Forbidden Header List](https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_header_name) — `fetch()` strips it. Nominatim sees a generic browser UA, which is against their [usage policy](https://operations.osmfoundation.org/policies/nominatim/) and may now return blocked / empty results.

2. **Rate limiting / IP block.** Nominatim's free tier is 1 req/sec hard-capped, no commercial use. With multiple riders typing simultaneously the shared public IP can get throttled or banned — empty results everywhere.

3. **Weak address matching.** Nominatim does well on canonical street addresses ("1600 Pennsylvania Ave NW, Washington DC") but fails on:
   - Place names ("Walmart Hyattsville", "Target Bowie")
   - Apartment/unit-included strings
   - Partial street numbers
   - Common abbreviations

4. **`limit=1` discards good candidates.** Even when a match exists in position 2–5, the rider gets nothing instead of a "did you mean…?" dropdown.

5. **No retry, no debounce coordination, no fallback provider.** Transient 429s become permanent "address not found" UX.

## Recommended fix (multi-step)

This is a substantive engagement (~1–2 days), not a quick patch:

1. **Move geocoding to the server.** New `server/geocodeService.ts` that proxies a real geocoder. Sets a real `User-Agent`. Caches results in-memory (or Redis later) to absorb traffic spikes.
2. **Switch provider.** Mapbox Geocoding API (free 100k/mo) or Google Places Autocomplete (free $200/mo credit). Both have dramatically better address matching for the U.S. than Nominatim.
3. **Surface a suggestion dropdown.** Instead of guessing the magic phrasing, return top 5 candidates and let the rider tap one (Uber/Lyft UX). Same fix applies to all 5 booking modals — pull the geocode logic into one shared hook.
4. **Keep Nominatim as fallback** if Mapbox/Google quota is hit.
5. **Add analytics** — count "no results returned" per query so we can see which addresses are failing and tune.

## Out-of-scope but worth flagging

The five booking modals each have their own copy of the geocode function. Even without the address-not-found bug this is a refactor target — single source of truth (`client/src/hooks/useGeocode.ts`) reduces drift.

## What's needed before implementation

- Decision: Mapbox vs Google Places vs (other). Cost and signup overhead differ.
- Provider API key in Railway env vars.
- (Optional) Decision on whether to ship the suggestion-dropdown UX or just the provider swap as a smaller PR.
