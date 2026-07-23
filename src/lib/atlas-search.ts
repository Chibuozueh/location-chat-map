// Shared smart-search engine for the Atlas. Pure module — usable from both
// Convex queries and browser components. The types below are declared locally
// (rather than imported from src/components/atlas/types) so this module stays
// importable from src/convex/* without dragging the rest of the client tree
// (which uses the `@/` Vite alias) into Convex's bundler.
//
// NL philosophy (v2):
//  - Build a single "search blob" per row from every free-text column the
//    seed + CSV provide, so common phrases like "groceries", "after-school",
//    "ESL", "prenatal", and short asset names ("YMCA", "WIC", "211") all hit.
//  - Detect categories by EITHER the seed taxonomy OR the row's own
//    tag-line (so uploaded CSVs with new categories still get recognized).
//  - Score rows by filters MATCHED, not hard-AND of all filters; surface
//    "matched N of M filters" so partial matches aren't dead-ends.
//  - Surface richer details in the answer: services tags, today's hours,
//    contact phone/email/website — so the user can act without another
//    click.

type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
const dayKeys: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export type HoursLike =
  | Record<DayKey, { open: string; close: string }>
  | undefined
  | null;

/** Source file: a synergistic duck-typed view of any asset row. */
export type SearchableAsset = {
  slug: string;
  name: string;
  category: string;
  /** Short one-liner, e.g. "Clinic", "Faith-based food pantry". */
  tagline?: string;
  /** Long-form description / "Services / Resources Available". */
  description?: string;
  /** Internal notes — small extra loot from "Notes & Observations"
   *  (mirrors AtlasAsset.signatureDrink so uploaded rows re-use this field). */
  notes?: string;
  signatureDrink?: string;
  /** Optional free-form services string already split into labels. */
  services?: string[];
  features: string[];
  priceTier: number;
  /** Working hours or null if unknown. */
  hours?: HoursLike;
  /** Free-text "Price/Affordability" cell (kept raw for fallback). */
  priceLabel?: string;
  rating: number;
  reviewCount: number;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  website?: string;
  socialMedia?: string;
};

/** Lightweight read-only alias retained for callers. */
export type SearchableRow = SearchableAsset;

export type AtlasIntent = {
  category: string | null;
  /** CSV / seed taxonomy matches surfaced as canonical names. */
  categories: string[];
  features: string[];
  priceMax: number | null;
  priceMin: number | null;
  wantTopRated: boolean;
  wantCheapest: boolean;
  wantOpenNow: boolean;
  /** Phrases extracted with multi-token join so "YMCA", "211", "WIC" hit. */
  nameMention: string | null;
  /** Disambiguating tokens for short named programs. */
  nameMentions: string[];
  /** Free-form service phrases found in the query ("food pantry"). */
  serviceMentions: string[];
  generalAsset: boolean;
  matchedSignals: string[];
};

/** Minimal response shape returned to the chat panel. */
export type SearchResponse = {
  answer: string;
  intent: AtlasIntent;
  matched: SearchableAsset[];
  total: number;
  /** Truncated answer-friendly snippet snippets. */
  rubric: { totalSignals: number; matchedSignals: number } | null;
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
  hours: HoursLike,
  now = new Date(),
): boolean {
  if (!hours) return false;
  const key = dayKeys[now.getDay()];
  const day = hours[key];
  if (!day) return false;
  const open = parseClock(day.open);
  const close = parseClock(day.close);
  if (!open || !close) return false;
  // Range like "—" or empty falls through with parseClock returning null.
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

// ---------------------------------------------------------------------------
//  NL keywords. The seed-classified taxonomy is augmented with the
//  community-asset-types the uploaded CSV typically carries.
// ---------------------------------------------------------------------------

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
    "fitness class",
    "fitness classes",
    "wellness",
  ],
  school: [
    "school",
    "kipp",
    "charter",
    "education",
    "magnet",
    "k12",
    "k-12",
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
    "mental health",
    "counseling",
    "prenatal",
    "vaccine",
    "vaccination",
    "wic",
    "doula",
  ],
  library: [
    "library",
    "libraries",
    "books",
    "reading",
    "storytime",
    "storytelling",
    "branch",
    "book club",
  ],
  "community-center": [
    "community",
    "civic",
    "resource",
    "resource center",
    "neighborhood center",
    "pittsburgh",
    "carver",
    "senior center",
    "youth center",
    "cultural center",
    "immigrant",
    "immigration",
  ],
  museum: [
    "museum",
    "historic",
    "gallery",
    "exhibit",
    "heritage",
    "house museum",
    "landmark",
  ],
  transit: ["marta", "station", "transit", "bus stop", "rail", "stop"],
};

/** Extra service categories commonly appearing in the uploaded CSV. These
 *  don't fit the seed taxonomy but should still rank first when present. */
const serviceCategoryKeywords: Record<string, string[]> = {
  "food-pantry": [
    "food",
    "pantry",
    "food bank",
    "groceries",
    "meal",
    "meals",
    "hot meal",
    "free meal",
    "breakfast",
    "lunch",
    "dinner",
    "soup kitchen",
  ],
  housing: [
    "housing",
    "shelter",
    "homeless",
    "transitional housing",
    "rental assistance",
    "eviction",
  ],
  job: [
    "job",
    "jobs",
    "employment",
    "workforce",
    "career",
    "training",
    "job training",
    "resume",
  ],
  legal: ["legal", "lawyer", "attorney", "legal aid", "legal services"],
  faith: [
    "faith",
    "church",
    "mosque",
    "temple",
    "religious",
    "spiritual",
    "ministry",
  ],
  arts: [
    "art",
    "arts",
    "music",
    "theater",
    "theatre",
    "dance",
    "performance",
  ],
  family: [
    "family",
    "parenting",
    "childcare",
    "daycare",
    "after-school",
    "after school",
    "head start",
  ],
  senior: ["senior", "elder", "elderly", "older adult", "aging"],
};

function categoryFromQuestion(q: string): string | null {
  for (const [cat, words] of Object.entries(categoryKeywords)) {
    if (words.some((w) => q.includes(w))) return cat;
  }
  return null;
}

function allCategoriesFromQuestion(q: string): string[] {
  const out = new Set<string>();
  for (const [cat, words] of Object.entries(categoryKeywords)) {
    if (words.some((w) => q.includes(w))) out.add(cat);
  }
  for (const [cat, words] of Object.entries(serviceCategoryKeywords)) {
    if (words.some((w) => q.includes(w))) out.add(cat);
  }
  return Array.from(out);
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

/** Pull free-form "service phrases" out of the question: phrases up to 3
 *  words that contain at least one of the service keyword stems. Used to
 *  match against row.description (Services / Resources Available). */
function servicePhrasesFromQuestion(qNorm: string): string[] {
  const out = new Set<string>();
  const allStems = Object.values(serviceCategoryKeywords).flat();
  for (let i = 0; i < allStems.length; i++) {
    const stem = allStems[i];
    if (!stem.includes(" ")) continue;
    if (qNorm.includes(stem)) {
      out.add(stem);
      continue;
    }
    // Strip noise — capture stem fragments in case the user phrases them
    // as "free food pantry" (so just "food" alone is too generic to be a
    // service phrase, but "food pantry" is precise).
    const head = stem.split(" ")[0];
    const tail = stem.split(" ").slice(1).join(" ");
    if (head.length >= 5 && tail && qNorm.includes(tail)) out.add(tail);
  }
  return Array.from(out);
}

const STOPS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "i",
  "you",
  "we",
  "me",
  "my",
  "us",
  "can",
  "do",
  "does",
  "find",
  "show",
  "list",
  "which",
  "what",
  "where",
  "any",
  "with",
  "for",
  "of",
  "to",
  "and",
  "or",
  "in",
  "on",
  "at",
  "your",
  "near",
  "around",
  "best",
  "top",
  "rated",
  "rating",
  "most",
  "least",
  "cheap",
  "expensive",
  "open",
  "now",
  "today",
  "right",
  "here",
  "there",
  "this",
  "that",
  "about",
  "hello",
  "hey",
  "please",
  "thanks",
  "thank",
  "asset",
  "assets",
  "place",
  "places",
  "thing",
  "things",
  "venue",
  "venues",
  "atlanta",
  "southwest",
  "city",
  "areas",
  "neighborhood",
  "neighborhoods",
]);

export function parseIntent(question: string): AtlasIntent {
  const q = norm(question);
  const out: AtlasIntent = {
    category: null,
    categories: [],
    features: [],
    priceMax: null,
    priceMin: null,
    wantTopRated: false,
    wantCheapest: false,
    wantOpenNow: false,
    nameMention: null,
    nameMentions: [],
    serviceMentions: [],
    generalAsset: false,
    matchedSignals: [],
  };

  if (/\bhigh(ly)? rated|highest rated|best rated|best\b|top rated|popular\b/.test(q)) {
    out.wantTopRated = true;
    out.matchedSignals.push("highest community score");
  }

  if (/\bfree\b|no cost|no fee/.test(q)) {
    out.priceMax = 0;
    out.matchedSignals.push("free to use");
  } else if (
    /\bcheap|cheapest|affordable|budget|inexpensive|low cost|sliding\b/.test(q)
  ) {
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

  const cats = allCategoriesFromQuestion(q);
  if (cats.length) {
    out.category = cats[0];
    out.categories = cats;
    out.matchedSignals.push(...cats.map((c) => `category: ${c.replace("-", " ")}`));
  }

  const feats = featuresFromQuestion(q);
  if (feats.length) {
    out.features = feats;
    out.matchedSignals.push(...feats.map((f) => `feature: ${f}`));
  }

  out.serviceMentions = servicePhrasesFromQuestion(q);
  if (out.serviceMentions.length) {
    out.matchedSignals.push(
      ...out.serviceMentions.map((s) => `service: ${s}`),
    );
  }

  // Multi-token name extraction. Tokens alphabetical-cap (>= 2 chars) are
  // kept so short names like "YMCA", "WIC", "211", "co-op" still hit.
  const tokens = q
    .split(" ")
    .filter((t) => t.length >= 2 && !STOPS.has(t) && !/^\d{1}$/.test(t));
  if (tokens.length) {
    const sortedAlpha = [...tokens].sort((a, b) => b.length - a.length);
    const head = sortedAlpha[0];
    if (head) out.nameMention = head;
    out.nameMentions = sortedAlpha.slice(0, 4);
  }
  // 3-digit numerics like "211" survive because /^\d{1}$/ lets >= 2 digits
  // through. Asset slugs of programs like "511" or "988" still work.

  if (!out.matchedSignals.length && !out.nameMention) {
    out.generalAsset = true;
  }
  return out;
}

// ---------------------------------------------------------------------------
//  Row indexing
// ---------------------------------------------------------------------------

/** Build the lowercase text blob a row is searched against. Combines every
 *  free-text column plus service labels. */
export function buildSearchBlob(a: SearchableAsset): string {
  const parts = [
    a.name,
    a.tagline,
    a.category,
    a.description,
    a.notes,
    a.signatureDrink,
    a.priceLabel,
    ...(a.services ?? []),
  ];
  return norm(parts.filter(Boolean).join(" \u2022 "));
}

/** Does the row's free-text mention this phrase? Token-boundary-aware:
 *  split blob on spaces and compare tokens. */
function blobMentions(blob: string, phrase: string): boolean {
  if (!blob || !phrase) return false;
  if (blob.includes(phrase)) return true;
  // Common pluralization: stethoscope vs stethoscopes.
  for (const tok of phrase.split(" ")) {
    if (tok.length < 3) continue;
    if (
      blob.includes(tok) ||
      blob.includes(tok + "s") ||
      blob.includes(tok.replace(/y$/, "ies"))
    ) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
//  Retrieval
// ---------------------------------------------------------------------------

/** Pure search over any list of rows. v2 ranks by filters MATCHED so
 *  multi-filter queries produce partial-match leaderboards, not the empty
 *  zero that hard-AND returns. */
export function searchRows(
  rows: SearchableAsset[],
  question: string,
): SearchResponse {
  const intent = parseIntent(question);

  // Pre-compute per-row blobs. Cheap (normalization only).
  const idx = rows.map((r) => ({
    row: r,
    blob: buildSearchBlob(r),
  }));

  const totalSignals =
    intent.matchedSignals.length + (intent.nameMention ? 1 : 0);

  const scored = idx.map(({ row, blob }) => {
    let matched = 0;

    if (intent.nameMention) {
      const m = intent.nameMentions.length
        ? intent.nameMentions
        : [intent.nameMention];
      const direct =
        m.some((tok) => blob.includes(tok)) ||
        norm(row.name).includes(intent.nameMention);
      if (direct) matched++;
    }

    if (intent.categories.length) {
      // If the row's own category matches any of the user's categories, count it.
      const catHit =
        intent.categories.includes(row.category) ||
        (row.tagline &&
          intent.categories.some((c) =>
            norm(row.tagline ?? "").includes(c.replace("-", " ")),
          ));
      if (catHit) matched++;
    }
    if (intent.features.length) {
      const hits = intent.features.filter((f) =>
        (row.features ?? []).includes(f),
      ).length;
      if (hits) matched++;
    }
    if (intent.priceMax !== null && row.priceTier <= intent.priceMax) {
      matched++;
    }
    if (intent.priceMin !== null && row.priceTier >= intent.priceMin) {
      matched++;
    }
    if (intent.wantOpenNow && isOpenAt(row.hours)) {
      matched++;
    }
    if (intent.serviceMentions.length) {
      const hits = intent.serviceMentions.filter((s) =>
        blobMentions(blob, s),
      ).length;
      if (hits) matched++;
    }

    // Sort key: matched desc, then rating desc, then reviewCount desc.
    return {
      row,
      matched,
      rating: row.rating ?? 0,
      reviews: row.reviewCount ?? 0,
    };
  });

  // If we have any positive signals, filter out zero-match rows so the
  // leaderboard is meaningful. Otherwise fall back to "show me top picks".
  const positive = scored.filter((s) => s.matched > 0);
  const leaderboard =
    positive.length > 0
      ? positive
      : scored.filter((s) => intent.matchedSignals.length === 0)
          .slice(0, 6);

  if (intent.wantTopRated) {
    leaderboard.sort(
      (a, b) =>
        b.rating - a.rating ||
        b.reviews - a.reviews ||
        b.matched - a.matched,
    );
  } else if (intent.wantCheapest) {
    leaderboard.sort(
      (a, b) =>
        (a.row.priceTier ?? 0) - (b.row.priceTier ?? 0) ||
        b.rating - a.rating ||
        b.matched - a.matched,
    );
  } else {
    leaderboard.sort(
      (a, b) =>
        b.matched - a.matched ||
        b.rating - a.rating ||
        b.reviews - a.reviews,
    );
  }

  const totalMatched = leaderboard.length;
  const limited = leaderboard.slice(0, 6).map((s) => s.row);
  const topScore = leaderboard[0]?.matched ?? 0;
  const rubric =
    intent.matchedSignals.length > 0
      ? {
          matchedSignals: topScore,
          totalSignals,
        }
      : null;

  return {
    answer: composeAnswer(intent, limited, totalMatched, rubric),
    intent,
    matched: limited,
    total: rows.length,
    rubric,
  };
}

// ---------------------------------------------------------------------------
//  Answer composition
// ---------------------------------------------------------------------------

export function composeAnswer(
  intent: AtlasIntent,
  matched: SearchableAsset[],
  total: number,
  rubric: { matchedSignals: number; totalSignals: number } | null = null,
): string {
  if (!intent.matchedSignals.length && !intent.nameMention) {
    if (!matched.length) {
      return `I don't see anything yet. Upload a spreadsheet of asset locations above and I'll answer questions over your data; otherwise try asking about categories, hours, or accessibility.`;
    }
    const top = matched
      .slice(0, 3)
      .map((m) => `${m.name} (${(m.rating ?? 0).toFixed(1)}\u2605)`)
      .join(", ");
    return `Here's a snapshot of the atlas (${total} asset${
      total === 1 ? "" : "s"
    }), led by ${top}. Ask me about category, hours, accessibility, or cost for sharper results.`;
  }

  if (!matched.length) {
    const filterDesc = intent.matchedSignals.join(", ");
    return `No asset in the atlas matches all of: ${filterDesc}. Try loosening the request — e.g. drop a feature or broaden the cost range.`;
  }

  const isPartial =
    rubric !== null && rubric.totalSignals > 0 &&
    rubric.matchedSignals < rubric.totalSignals;
  const lead = matched.length === 1
    ? `One asset matches${isPartial ? " partially" : ""}`
    : `${matched.length} assets match${isPartial ? " partially" : ""}`;

  const filterDesc = intent.matchedSignals.length
    ? intent.matchedSignals.join(", ")
    : intent.nameMention ?? "";

  const list = matched
    .slice(0, 3)
    .map((m) => {
      const r = (m.rating ?? 0).toFixed(1);
      const p = priceLabel(m.priceTier ?? 0);
      const open = isOpenAt(m.hours) ? " \u00b7 open now" : "";
      return `${m.name} (${r}\u2605 \u00b7 ${p}${open})`;
    })
    .join(", ");
  const tail = matched.length > 3 ? `, plus ${matched.length - 3} more` : "";

  const ratio = rubric && rubric.totalSignals > 0
    ? ` (matched ${rubric.matchedSignals}/${rubric.totalSignals} filters)`
    : "";

  return `${lead}${ratio} \u2014 ${filterDesc}: ${list}${tail}.`;
}
