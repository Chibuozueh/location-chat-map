// Shared smart-search engine for the Atlas. Pure module — usable from both
// Convex queries and browser components. The types below are declared locally
// (rather than imported from src/components/atlas/types) so this module stays
// importable from src/convex/* without dragging the rest of the client tree
// (which uses the `@/` Vite alias) into Convex's bundler.

type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
const dayKeys: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Minimal intent shape; mirrors AtlasIntent in src/components/atlas/types. */
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

/** Minimal response shape returned to the chat panel. */
export type SearchResponse = {
  answer: string;
  intent: AtlasIntent;
  matched: any[];
  total: number;
};

export function parseClock(s: string): { h: number; m: number } | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (Number.isNaN(h) || Number.isNaN(mm)) return null;
  return { h, m: mm };
}

export function isOpenAt(
  hours:
    | Record<DayKey, { open: string; close: string }>
    | undefined
    | null,
  now = new Date(),
): boolean {
  if (!hours) return false;
  const key = dayKeys[now.getDay()];
  const day = hours[key];
  if (!day) return false;
  const open = parseClock(day.open);
  const close = parseClock(day.close);
  if (!open || !close) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  const openMin = open.h * 60 + open.m;
  const closeMin = close.h * 60 + close.m;
  return cur >= openMin && cur < closeMin;
}

export function priceLabel(tier: number): string {
  if (tier <= 0) return "Free";
  if (tier === 1) return "Sliding-scale";
  return "Paid";
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const categoryKeywords: Record<string, string[]> = {
  park: ["park", "playground", "trail", "garden", "greenspace", "outdoor"],
  "recreation-center": [
    "recreation",
    "rec center",
    "gym",
    "pool",
    "sports",
    "swimming",
    "fitness",
  ],
  school: [
    "school",
    "kipp",
    "charter",
    "education",
    "magnet",
    "k12",
    "elementary",
    "middle",
    "high school",
    "academy",
  ],
  clinic: [
    "clinic",
    "health",
    "doctor",
    "medical",
    "dental",
    "urgent care",
    "pharmacy",
    "care",
  ],
  library: [
    "library",
    "libraries",
    "books",
    "reading",
    "storytime",
    "branch",
  ],
  "community-center": [
    "community",
    "civic",
    "resource",
    "neighborhood center",
    "pittsburgh",
    "carver",
  ],
  museum: [
    "museum",
    "historic",
    "gallery",
    "exhibit",
    "heritage",
    "house museum",
  ],
  transit: ["marta", "station", "transit", "bus stop", "rail", "stop"],
};

function categoryFromQuestion(q: string): string | null {
  for (const [cat, words] of Object.entries(categoryKeywords)) {
    if (words.some((w) => q.includes(w))) return cat;
  }
  return null;
}

function featuresFromQuestion(q: string): string[] {
  const out: string[] = [];
  if (/\bwifi|wi-fi|internet\b/.test(q)) out.push("public-wifi");
  if (/\bmarta|transit|bus stop|public transit\b/.test(q))
    out.push("transit-accessible");
  if (/\bwheelchair|accessible|ada|mobility\b/.test(q))
    out.push("wheelchair-accessible");
  if (/\byouth|kid|teen|children|after[- ]school\b/.test(q))
    out.push("youth-programs");
  if (/\bsenior|elder|older adult\b/.test(q)) out.push("senior-programs");
  if (/\brestroom|bathroom|toilet\b/.test(q)) out.push("restrooms");
  if (/\bweekend|saturday|sunday\b/.test(q)) out.push("open-weekends");
  return out;
}

const NAME_TOKEN_MIN_LEN = 5;

const STOPS = new Set([
  // generic English
  "a", "an", "the", "is", "are", "i", "you", "we", "me", "can", "do", "does",
  "find", "show", "list", "which", "what", "where", "any", "with", "for",
  "of", "to", "and", "or", "in", "on", "at", "my", "your", "near", "around",
  "best", "top", "rated", "rating", "most", "least", "cheap", "expensive",
  "open", "now", "today", "right", "here", "there", "this", "that",
  "about", "hello", "hey", "please", "thanks", "thank",
  // asset-noun stopwords (we use categoryKeywords for these)
  "asset", "assets", "place", "places", "thing", "things", "venue", "venues",
  "atlanta", "southwest", "city", "areas", "neighborhood", "neighborhoods",
  "service", "services",
]);

export function parseIntent(question: string): AtlasIntent {
  const q = norm(question);
  const out: AtlasIntent = {
    category: null,
    features: [],
    priceMax: null,
    priceMin: null,
    wantTopRated: false,
    wantCheapest: false,
    wantOpenNow: false,
    nameMention: null,
    generalAsset: false,
    matchedSignals: [],
  };

  if (/\bhigh(ly)? rated|highest rated|best rated|best|top rated|popular\b/.test(q)) {
    out.wantTopRated = true;
    out.matchedSignals.push("highest community score");
  }

  if (/\bfree\b/.test(q)) {
    out.priceMax = 0;
    out.matchedSignals.push("free to use");
  } else if (/\bcheap|cheapest|affordable|budget|inexpensive|low cost\b/.test(q)) {
    out.wantCheapest = true;
    out.priceMax = 1;
    out.matchedSignals.push("low or sliding-scale cost");
  }
  if (/\bpay|paid|fee|membership|ticket\b/.test(q)) {
    out.priceMin = 2;
    out.matchedSignals.push("paid service");
  }

  if (/\bopen now|open today|right now|currently open|still open\b/.test(q)) {
    out.wantOpenNow = true;
    out.matchedSignals.push("open right now");
  }

  const cat = categoryFromQuestion(q);
  if (cat) {
    out.category = cat;
    out.matchedSignals.push(`category: ${cat.replace("-", " ")}`);
  }

  const feats = featuresFromQuestion(q);
  if (feats.length) {
    out.features = feats;
    out.matchedSignals.push(...feats.map((f) => `feature: ${f}`));
  }

  const tokens = q
    .split(" ")
    .filter((t) => t.length >= NAME_TOKEN_MIN_LEN && !STOPS.has(t));
  if (tokens.length) {
    const candidate = tokens.sort((a, b) => b.length - a.length)[0];
    if (candidate) out.nameMention = candidate;
  }

  if (!out.matchedSignals.length) {
    out.generalAsset = true;
  }
  return out;
}

export function composeAnswer(
  intent: AtlasIntent,
  matched: any[],
  total: number,
): string {
  if (!intent.matchedSignals.length) {
    if (!matched.length) {
      return `I couldn't find anything in the atlas yet. The community dataset is still being curated — try again shortly.`;
    }
    const top = matched
      .slice(0, 3)
      .map((m) => `${m.name} (${m.rating.toFixed(1)}★)`)
      .join(", ");
    return `I don't have a strong filter to apply, so I pulled our highest-scored assets by default. ${matched.length} asset${matched.length === 1 ? "" : "s"} in the atlas, led by ${top}.`;
  }

  if (!matched.length) {
    const filterDesc = intent.matchedSignals.join(", ");
    return `No asset in the atlas currently matches all of: ${filterDesc}. Try loosening one — e.g. drop a feature or widen the cost range.`;
  }

  const lead =
    matched.length === 1
      ? `One asset matches`
      : `${matched.length} assets match`;
  const filterDesc = intent.matchedSignals.join(", ");
  const list = matched
    .slice(0, 3)
    .map((m) => `${m.name} (${m.rating.toFixed(1)}★ · ${priceLabel(m.priceTier)})`)
    .join(", ");
  const tail = matched.length > 3 ? `, plus ${matched.length - 3} more` : "";
  return `${lead} ${filterDesc}: ${list}${tail}.`;
}

/** Minimum fields the search engine needs from any asset row. Declared
 *  locally so this file stays importable from src/convex/*. */
type SearchableRow = {
  slug: string;
  name: string;
  category: string;
  features: string[];
  priceTier: number;
  hours:
    | Record<DayKey, { open: string; close: string }>
    | undefined
    | null;
  rating: number;
  reviewCount: number;
};

/** Pure search over any list of rows (used both by the server query and by
 *  the client when an uploaded CSV is loaded). */
export function searchRows(
  rows: SearchableRow[],
  question: string,
): SearchResponse {
  const intent = parseIntent(question);
  let out: any[] = rows as any[];

  if (intent.nameMention) {
    const mention = intent.nameMention;
    const direct = rows.filter((l) => norm(l.name).includes(mention));
    if (direct.length) out = direct;
  }

  if (intent.category) {
    out = out.filter((l) => l.category === intent.category);
  }
  for (const f of intent.features) {
    out = out.filter((l) => l.features && l.features.includes(f));
  }
  if (intent.priceMax !== null) {
    const max = intent.priceMax;
    out = out.filter((l) => l.priceTier <= max);
  }
  if (intent.priceMin !== null) {
    const min = intent.priceMin;
    out = out.filter((l) => l.priceTier >= min);
  }
  if (intent.wantOpenNow) {
    out = out.filter((l) => isOpenAt(l.hours as any));
  }

  if (intent.wantTopRated) {
    out = [...out].sort(
      (a, b) =>
        (b.rating ?? 0) - (a.rating ?? 0) ||
        (b.reviewCount ?? 0) - (a.reviewCount ?? 0),
    );
  } else if (intent.wantCheapest) {
    out = [...out].sort(
      (a, b) =>
        (a.priceTier ?? 0) - (b.priceTier ?? 0) ||
        (b.rating ?? 0) - (a.rating ?? 0),
    );
  } else {
    out = [...out].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  }

  const limited = out.slice(0, 6);
  return {
    answer: composeAnswer(intent, limited, rows.length),
    intent,
    matched: limited,
    total: rows.length,
  };
}
