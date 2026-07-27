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
  // --- Canonical internal IDs (kept for backwards-compat with any
  //     seed rows that already use them) ---
  park: "Park / green space",
  "recreation-center": "Recreation center",
  school: "School",
  clinic: "Clinic",
  library: "Library",
  "community-center": "Community center",
  museum: "Museum / heritage site",
  transit: "Transit station",
  // --- The user's live Google Sheet vocabulary. Each canonical lowercase
  //     key resolves to a single human-readable label, ensuring every
  //     tab of the spreadsheet — Comm Fitness, Basketball Courts, Gyms
  //     & Fitness Spaces, Parks & Rec, Aquatics & Swim Locations,
  //     MARTA Public Transit — renders with consistent, readable text. ---
  "comm based classes & programming": "Community classes & programming",
  "comm-based-classes-&-programming": "Community classes & programming",
  "classes & programming": "Classes & programming",
  "basketball court": "Basketball court",
  "basketball courts": "Basketball court",
  gym: "Gym & fitness space",
  gyms: "Gym & fitness space",
  "gym & fitness space": "Gym & fitness space",
  "gyms & fitness spaces": "Gym & fitness space",
  "gym & fitness spaces": "Gym & fitness space",
  "fitness space": "Gym & fitness space",
  "fitness center": "Fitness center",
  "recreation center": "Recreation center",
  "community center": "Community center",
  "parks & rec": "Park & recreation",
  "parks and rec": "Park & recreation",
  "parks & recreation": "Park & recreation",
  "park & rec": "Park & recreation",
  "park & recreation": "Park & recreation",
  "green space": "Green space",
  "swimming pool": "Swimming pool",
  pool: "Swimming pool",
  "aquatic center": "Aquatic center",
  "aquatics & swim": "Aquatic center",
  "aquatics & swim locations": "Aquatic center",
  "aquatics and swim locations": "Aquatic center",
  swim: "Aquatic center",
  "marta station": "MARTA station",
  "marta stop": "MARTA station",
  "marta public transit": "MARTA public transit",
  "transit station": "Transit station",
  "transit stop": "Transit stop",
  "trail": "Trail",
  "walking trail": "Walking trail",
  "bike trail": "Bike trail",
  "playground": "Playground",
  "splash pad": "Splash pad",
  "outdoor recreation": "Outdoor recreation",
  "wellness program": "Wellness program",
  "fitness class": "Fitness class",
  sports: "Sports facility",
};

/**
 * Pretty-print a category id, falling back to Title Case for unknown
 * values so the filter tab label is always readable regardless of how
 * the upstream spreadsheet appears to be cased.
 */
export function prettifyCategoryLabel(category: string | null | undefined): string {
  if (!category) return "Uncategorized";
  const lower = category.trim().toLowerCase();
  if (CATEGORY_LABEL[lower]) return CATEGORY_LABEL[lower];
  // Title-case by splitting on whitespace / underscores / dashes /
  // ampersands, capitalizing the first letter of every word, and
  // collapsing runs of separators. Words like "and" become "&" so the
  // Sheet's natural-language names ("MARTA Public Transit",
  // "Aquatics & Swim Locations") read back cleanly.
  return lower
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (word === "&") return "&";
      if (word === "and") return "&";
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

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
