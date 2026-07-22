// Convex action that proxies Nominatim (OpenStreetMap) for address→lat/lng
// geocoding. We bounce through the server so we can set a `User-Agent`
// header (required by Nominatim's usage policy) and stay below the public
// 1 req/sec rate clip. The client loops sequentially with its own sleep
// between calls; this action just does a single fetch.

"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

export const geocodeAddress = action({
  args: {
    street: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    postalcode: v.optional(v.string()),
    country: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const params = new URLSearchParams();
    if (args.street) params.set("street", args.street);
    if (args.city) params.set("city", args.city);
    if (args.state) params.set("state", args.state);
    if (args.postalcode) params.set("postalcode", args.postalcode);
    if (args.country) params.set("country", args.country);
    params.set("format", "json");
    params.set("limit", "1");
    params.set("addressdetails", "0");

    const url = `${NOMINATIM_URL}?${params.toString()}`;
    try {
      const res = await fetch(url, {
        headers: {
          // Required by Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/).
          "User-Agent": "AtlantaAtlas/1.0 (community-asset-geocoder)",
          "Accept": "application/json",
          "Referer": "atlanta-atlas.local",
        },
      });
      if (!res.ok) {
        console.warn("[geocode] non-OK", res.status, url);
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
      console.error("[geocode] fetch failed", err);
      return null;
    }
  },
});
