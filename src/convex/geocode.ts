// Convex action that proxies Nominatim (OpenStreetMap) for address→lat/lng
// geocoding. We bounce through the server so we can set a `User-Agent`
// header (required by Nominatim's usage policy) and stay below the public
// 1 req/sec rate clip. The client loops sequentially with its own sleep
// between calls.
//
// Robustness: the action tries a 4-tier cascade before giving up so we
// minimize the "unable to geocode" failure surface on messy HUD-style
// spreadsheet data:
//   Tier 1: street + city + state + postalcode           (accuracy: "exact")
//   Tier 2: street + city + state                        (accuracy: "exact")
//   Tier 3: street + postalcode                          (accuracy: "relaxed")
//   Tier 4a: Zippopotam.us /us/{zip} centroid            (accuracy: "zip-centroid")
//   Tier 4b: local ZIP_CENTROIDS table for Atlanta metro (accuracy: "zip-centroid")
//
// Returns { lat, lng, accuracy } on the first successful tier or null.

"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const ZIPPO_URL = "https://api.zippopotam.us/us";

// Hand-curated Atlanta-metro ZCTA centroids — short-circuits the network
// for the most common HUD use case.
const ATLANTA_ZIP_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  "30002": { lat: 33.7723, lng: -84.3877 },
  "30030": { lat: 33.7715, lng: -84.2988 },
  "30032": { lat: 33.7361, lng: -84.2890 },
  "30034": { lat: 33.6891, lng: -84.3299 },
  "30060": { lat: 33.9522, lng: -84.5444 },
  "30080": { lat: 33.8767, lng: -84.5047 },
  "30126": { lat: 33.8486, lng: -84.5547 },
  "30213": { lat: 33.6441, lng: -84.4486 },
  "30236": { lat: 33.6755, lng: -84.3967 },
  "30238": { lat: 33.4949, lng: -84.3874 },
  "30260": { lat: 33.5841, lng: -84.4733 },
  "30265": { lat: 33.3901, lng: -84.7033 },
  "30268": { lat: 33.5340, lng: -84.7324 },
  "30269": { lat: 33.3981, lng: -84.5723 },
  "30273": { lat: 33.6280, lng: -84.4690 },
  "30274": { lat: 33.5882, lng: -84.4734 },
  "30276": { lat: 33.2785, lng: -84.6137 },
  "30281": { lat: 33.5497, lng: -84.2071 },
  "30288": { lat: 33.5905, lng: -84.3590 },
  "30290": { lat: 33.4649, lng: -84.5875 },
  "30291": { lat: 33.6808, lng: -84.4825 },
  "30292": { lat: 33.4821, lng: -84.5461 },
  "30294": { lat: 33.6495, lng: -84.3980 },
  "30296": { lat: 33.5659, lng: -84.4479 },
  "30297": { lat: 33.5841, lng: -84.4681 },
  "30303": { lat: 33.7537, lng: -84.3863 },
  "30305": { lat: 33.8310, lng: -84.3830 },
  "30306": { lat: 33.7868, lng: -84.3590 },
  "30307": { lat: 33.7691, lng: -84.3380 },
  "30308": { lat: 33.7710, lng: -84.3777 },
  "30309": { lat: 33.7972, lng: -84.3877 },
  "30310": { lat: 33.7329, lng: -84.4088 },
  "30311": { lat: 33.7326, lng: -84.4828 },
  "30312": { lat: 33.7465, lng: -84.3759 },
  "30313": { lat: 33.7685, lng: -84.3950 },
  "30314": { lat: 33.7563, lng: -84.4253 },
  "30315": { lat: 33.7051, lng: -84.3826 },
  "30316": { lat: 33.7179, lng: -84.3339 },
  "30317": { lat: 33.7495, lng: -84.3122 },
  "30318": { lat: 33.7916, lng: -84.4472 },
  "30319": { lat: 33.8441, lng: -84.3358 },
  "30324": { lat: 33.8205, lng: -84.3585 },
  "30326": { lat: 33.8440, lng: -84.3611 },
  "30327": { lat: 33.8726, lng: -84.4228 },
  "30328": { lat: 33.9245, lng: -84.3786 },
  "30329": { lat: 33.8360, lng: -84.3214 },
  "30330": { lat: 33.7067, lng: -84.4343 },
  "30331": { lat: 33.6968, lng: -84.5326 },
  "30332": { lat: 33.7763, lng: -84.4014 },
  "30334": { lat: 33.7487, lng: -84.3878 },
  "30336": { lat: 33.7311, lng: -84.6533 },
  "30337": { lat: 33.6437, lng: -84.4611 },
  "30338": { lat: 33.9529, lng: -84.3176 },
  "30339": { lat: 33.9078, lng: -84.4225 },
  "30340": { lat: 33.8994, lng: -84.2864 },
  "30341": { lat: 33.9048, lng: -84.2992 },
  "30342": { lat: 33.8810, lng: -84.3751 },
  "30344": { lat: 33.6761, lng: -84.4577 },
  "30345": { lat: 33.8521, lng: -84.2849 },
  "30346": { lat: 33.9135, lng: -84.3406 },
  "30349": { lat: 33.6223, lng: -84.4942 },
  "30350": { lat: 33.9874, lng: -84.3366 },
  "30354": { lat: 33.6654, lng: -84.3788 },
  "30360": { lat: 33.9272, lng: -84.2808 },
  "30363": { lat: 33.7900, lng: -84.3990 },
  "31106": { lat: 33.7920, lng: -84.3306 },
  "31107": { lat: 33.7720, lng: -84.3622 },
  "31119": { lat: 33.7447, lng: -84.3944 },
  "31126": { lat: 33.7941, lng: -84.3638 },
  "31131": { lat: 33.7537, lng: -84.3863 },
  "31136": { lat: 33.7910, lng: -84.4089 },
  "31139": { lat: 33.8573, lng: -84.4527 },
  "31141": { lat: 33.8762, lng: -84.2893 },
  "31144": { lat: 34.0067, lng: -84.2968 },
  "31145": { lat: 33.8521, lng: -84.3378 },
  "31146": { lat: 33.9240, lng: -84.3370 },
  "31150": { lat: 33.9854, lng: -84.3396 },
  "31156": { lat: 33.8704, lng: -84.3122 },
  "31192": { lat: 33.7698, lng: -84.3546 },
  "31193": { lat: 33.7819, lng: -84.3886 },
};

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

async function zippoCentroid(
  zip: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(`${ZIPPO_URL}/${encodeURIComponent(zip)}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      console.warn("[geocode] zippo non-OK", res.status, zip);
      return null;
    }
    const data = (await res.json()) as {
      places?: Array<{ latitude: string; longitude: string }>;
    };
    const place = data.places?.[0];
    if (!place) return null;
    const lat = parseFloat(place.latitude);
    const lng = parseFloat(place.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch (err) {
    console.warn("[geocode] zippo fetch failed", err);
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

    // Tier 4a — Atlanta centroid table (no network)
    if (hasZip && ATLANTA_ZIP_CENTROIDS[postalcode!]) {
      return { ...ATLANTA_ZIP_CENTROIDS[postalcode!], accuracy: "zip-centroid" as const };
    }

    // Tier 4b — Zippopotam.us fallback for any other US zip
    if (hasZip) {
      const r4 = await zippoCentroid(postalcode!);
      if (r4) return { ...r4, accuracy: "zip-centroid" as const };
    }

    // Tier 5 — Freeform q= full-text fallback. The structured tiers
    // require a complete street+city+state+zip hit (Tiers 1-3) or a
    // ZIP-only centroid pin (Tier 4a/4b). ZIP-less rows with anything
    // in `street`, only a city/state, or a venue-ish keyword like
    // "MARTA Bankhead" / "Vine City Park" still resolve here because
    // Nominatim's full-text index accepts fuzzy matches against
    // business names, parks, libraries, MARTA stations, and Atlanta
    // neighborhoods. Countrycode is forced to `us` so a fuzzy
    // "Atlanta Community Center" doesn't accidentally hit Atlanta, TX.
    const freeform = [street, city, state, postalcode, country]
      .filter(Boolean)
      .join(", ");
    if (freeform) {
      const r5 = await nominatimFreeform(freeform);
      if (r5) return { ...r5, accuracy: "relaxed" as const };
    }

    return null;
  },
});
