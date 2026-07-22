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

// Hand-curated centroids for SW Atlanta zips — short-circuits the network
// for the most common HUD use case.
const ATLANTA_ZIP_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  "30303": { lat: 33.7537, lng: -84.3863 },
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
  "30324": { lat: 33.8205, lng: -84.3585 },
  "30331": { lat: 33.6968, lng: -84.5326 },
  "30336": { lat: 33.7311, lng: -84.6533 },
  "30337": { lat: 33.6437, lng: -84.4611 },
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

export const geocodeAddress = action({
  args: {
    street: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    postalcode: v.optional(v.string()),
    country: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
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

    return null;
  },
});
