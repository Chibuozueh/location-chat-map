import type { AtlasAsset } from "@/lib/csv-import";
import type { AssetEvidence } from "@/lib/atlas-search";

/**
 * Render-shape of a single atlas entry. The atlas no longer persists any
 * Convex-backed locations table — the canonical sources are either the
 * embedded `SEED_LOCATIONS` in convex/locations.ts (translated to
 * `AtlasAsset` shape server-side) or a user-uploaded CSV (translated to
 * `AtlasAsset` shape client-side via csv-import.importCsv). Either path
 * produces an `AtlasAsset`; re-exporting it as `LocationDoc` keeps every
 * existing renderer (`LocationCard`, `MapView`, `LocationGrid`,
 * `ChatPanel`, …) working without touching their field-access code.
 */
export type LocationDoc = AtlasAsset;

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
  /** LLM-composed narration from Nebius (overrides `content` when set). */
  llmContent?: string | null;
  /** Friendly error bubble when the model is unreachable. */
  llmError?: string | null;
  /** True while a chatCompletions request is in flight. */
  isLlmLoading?: boolean;
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
