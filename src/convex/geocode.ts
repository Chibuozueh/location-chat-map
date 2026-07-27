// Convex action that proxies Nominatim (OpenStreetMap) for address→lat/lng
// geocoding. We bounce through the server so we can set a `User-Agent`
// header (required by Nominatim's usage policy) and stay below the public
// 1 req/sec rate clip. The client loops sequentially with its own sleep
// between calls.
//
// Robustness: the action tries a 3-tier cascade before giving up. We
// deliberately do NOT fall back to a ZIP centroid — only direct street
// addresses plot on the map; ZIP-only rows that the cascade misses
// fall through to the Atlas Map AI (OpenRouter, `Map_Router_Key`),
// which can recover the real address from the asset name + landmark
// lookup rules in `NORMALIZER_SYSTEM_PROMPT`. Rows the AI also can't
// recover stay unmapped in the user's "Unmapped" pill.
//   Tier 1: street + city + state + postalcode           (accuracy: "exact")
//   Tier 2: street + city + state                        (accuracy: "exact")
//   Tier 3: street + postalcode                          (accuracy: "relaxed")
//   Tier 4: Freeform `q=` full-text fallback             (accuracy: "relaxed")
//
// Returns { lat, lng, accuracy } on the first successful tier or null.

"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

function isFiveDigitUsZip(s: string): boolean {
  return /^\d{5}(?:-\d{4})?$/.test(s.trim());
}

async function nominatim(
  street: string | undefined,
  city: string | undefined,
  state: string | undefined,
  postalcode: string | undefined,
  country: string | undefined,
): Promise<{ lat: number; lng: number } | null> {
  const params = new URLSearchParams();
  if (street) params.set("street", street);
  if (city) params.set("city", city);
  if (state) params.set("state", state);
  if (postalcode) params.set("postalcode", postalcode);
  if (country) params.set("country", country);
  params.set("format", "json");
  params.set("limit", "1");
  params.set("addressdetails", "0");

  const url = `${NOMINATIM_URL}?${params.toString()}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "AtlantaAtlas/1.0 (community-asset-geocoder)",
        Accept: "application/json",
        Referer: "atlanta-atlas.local",
      },
    });
    if (!res.ok) {
      console.warn("[geocode] nominatim non-OK", res.status, url);
      return null;
    }
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (!Array.isArray(data) || data.length === 0) return null;
    const first = data[0];
    const lat = parseFloat(first.lat);
    const lng = parseFloat(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch (err) {
    console.warn("[geocode] nominatim fetch failed", err);
    return null;
  }
}

/**
 * Freeform `q=` query against Nominatim's full-text index. Lets us
 * recover rows where structured fields (no street OR no zip) couldn't
 * pin a match — ZIP-less rows with a venue name in `street`, rows with
 * only a city/state, rows with a recognizable business name, etc.
 *
 * Countrycode restricted to `us` so a fuzzy "Atlanta Community Center"
 * doesn't accidentally hit Atlanta, Texas. Returns the first hit, same
 * shape as the structured `nominatim()` helper.
 */
async function nominatimFreeform(
  q: string,
): Promise<{ lat: number; lng: number } | null> {
  const query = q.trim();
  if (!query) return null;
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("format", "json");
  params.set("limit", "1");
  params.set("addressdetails", "0");
  params.set("countrycodes", "us");
  const url = `${NOMINATIM_URL}?${params.toString()}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "AtlantaAtlas/1.0 (community-asset-geocoder)",
        Accept: "application/json",
        Referer: "atlanta-atlas.local",
      },
    });
    if (!res.ok) {
      console.warn("[geocode] freeform non-OK", res.status, query);
      return null;
    }
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (!Array.isArray(data) || data.length === 0) return null;
    const first = data[0];
    const lat = parseFloat(first.lat);
    const lng = parseFloat(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch (err) {
    console.warn("[geocode] freeform fetch failed", err);
    return null;
  }
}

export const geocodeAddress = action({
  args: {
    street: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    postalcode: v.optional(v.string()),
    country: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    // Log every geocode attempt so the user can verify in DevTools →
    // Console what the spreadsheet actually fed us for each row.
    // Filter the console by `[geocode]` to see one line per call.
    console.info("[geocode] called with", {
      street: args.street?.trim() ?? null,
      city: args.city?.trim() ?? null,
      state: args.state?.trim() ?? null,
      zip: args.postalcode?.trim() ?? null,
      country: args.country?.trim() ?? "USA",
    });
    const street = args.street?.trim();
    const city = args.city?.trim();
    const state = args.state?.trim();
    const postalcode = args.postalcode?.trim();
    const country = args.country?.trim() || "USA";

    const hasStreet = !!street && street.length > 0;
    const hasCityState = !!city && !!state;
    const hasZip = !!postalcode && isFiveDigitUsZip(postalcode);

    // Tier 1 — full street + city + state + zip
    if (hasStreet && hasCityState && hasZip) {
      const r1 = await nominatim(street, city, state, postalcode, country);
      if (r1) return { ...r1, accuracy: "exact" as const };
    }

    // Tier 2 — drop the postalcode
    if (hasStreet && hasCityState) {
      const r2 = await nominatim(street, city, state, undefined, country);
      if (r2) return { ...r2, accuracy: "exact" as const };
    }

    // Tier 3 — street + zip (often useful for residential streets)
    if (hasStreet && hasZip) {
      const r3 = await nominatim(street, undefined, undefined, postalcode, country);
      if (r3) return { ...r3, accuracy: "relaxed" as const };
    }

    // Tier 4 — Freeform q= full-text fallback. The structured tiers
    // require a complete street+city+state+zip hit (Tiers 1-3). ZIP-
    // less rows with anything in `street`, only a city/state, or a
    // venue-ish keyword like "MARTA Bankhead" / "Vine City Park" still
    // resolve here because Nominatim's full-text index accepts fuzzy
    // matches against business names, parks, libraries, MARTA stations,
    // and Atlanta neighborhoods. Countrycode is forced to `us` so a
    // fuzzy "Atlanta Community Center" doesn't accidentally hit
    // Atlanta, TX. ZIP-only rows that fail here fall through to the
    // caller's Atlas Map AI rescue (Map_Router_Key → landmark lookup).
    const freeform = [street, city, state, postalcode, country]
      .filter(Boolean)
      .join(", ");
    if (freeform) {
      const r4 = await nominatimFreeform(freeform);
      if (r4) return { ...r4, accuracy: "relaxed" as const };
    }

    return null;
  },
});
