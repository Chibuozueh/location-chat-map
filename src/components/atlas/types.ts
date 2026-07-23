import type { Doc } from "@/convex/_generated/dataModel";
import type { AssetEvidence } from "@/lib/atlas-search";

export type LocationDoc = Doc<"locations"> & {
  /**
   * Optional contact / outreach fields. These are populated by uploaded CSV
   * rows (see AtlasAsset) and may be `undefined` on the seeded default
   * rows. Kept on LocationDoc so LocationCard + MapView can read them off
   * either the seeded or imported asset without conditional casts.
   */
  website?: string;
  socialMedia?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
};

export const PRICE_SYMBOL: Record<number, string> = {
  0: "Free",
  1: "Sliding",
  2: "Paid",
};

export const PRICE_TONE: Record<number, string> = {
  0: "Free — open to all",
  1: "Sliding-scale",
  2: "Paid service",
};

export const CATEGORY_LABEL: Record<string, string> = {
  park: "Park / green space",
  "recreation-center": "Recreation center",
  school: "School",
  clinic: "Clinic",
  library: "Library",
  "community-center": "Community center",
  museum: "Museum / heritage site",
  transit: "Transit station",
};

export const FEATURE_LABEL: Record<string, string> = {
  "public-wifi": "Public Wi-Fi",
  "transit-accessible": "Transit accessible",
  "wheelchair-accessible": "Wheelchair accessible",
  "youth-programs": "Youth programs",
  "senior-programs": "Senior programs",
  restrooms: "Restrooms on-site",
  "open-weekends": "Open weekends",
  free: "Free to use",
};

export type ChatMessage = {
  id: string;
  role: "user" | "atlas";
  content: string;
  matched?: LocationDoc[];
  intent?: any;
  pending?: boolean;
  /** Optional partial-match rubric surfaced from the search engine. */
  rubric?: { totalSignals: number; matchedSignals: number } | null;
  /** Structured per-match evidence blocks (profile/list/snapshot view). */
  evidence?: AssetEvidence[];
};

export type AtlasIntent = {
  category: string | null;
  features: string[];
  priceMax: number | null;
  priceMin: number | null;
  wantTopRated: boolean;
  wantCheapest: boolean;
  wantOpenNow: boolean;
  nameMention: string | null;
  generalAsset: boolean;
  matchedSignals: string[];
};

export type SearchResponse = {
  answer: string;
  intent: AtlasIntent;
  matched: LocationDoc[];
  total: number;
  /** Structured per-match evidence blocks parallel to `matched`. */
  evidence?: {
    slug: string;
    name: string;
    addressLine: string;
    hoursToday: string;
    contactLine: string | null;
    websiteLine: string | null;
    servicesLine: string | null;
    priceLine: string;
    ratingLine: string;
    isOpenNow: boolean;
  }[];
  /** Which lead-template style was used (profile/list/snapshot/none). */
  mode?: "profile" | "list" | "snapshot" | "none";
};
