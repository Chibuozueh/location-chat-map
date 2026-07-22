import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// --- helpers -----------------------------------------------------------------

type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
const dayKeys: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function parseClock(s: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (Number.isNaN(h) || Number.isNaN(mm)) return null;
  return { h, m: mm };
}

function isOpenAt(
  hours: Record<DayKey, { open: string; close: string }>,
  now = new Date(),
): boolean {
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

function priceLabel(tier: number): string {
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
  library: ["library", "libraries", "books", "reading", "storytime", "branch"],
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

type ParsedIntent = {
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

const NAME_TOKEN_MIN_LEN = 5;

function parseIntent(question: string): ParsedIntent {
  const q = norm(question);
  const out: ParsedIntent = {
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

  const stops = new Set([
    // generic English
    "a", "an", "the", "is", "are", "i", "you", "we", "me", "can", "do", "does",
    "find", "show", "list", "which", "what", "where", "any", "with", "for",
    "of", "to", "and", "or", "in", "on", "at", "my", "your", "near", "around",
    "best", "top", "rated", "rating", "most", "least", "cheap", "expensive",
    "open", "now", "today", "right", "here", "there", "this", "that",
    "about", "hello", "hey", "please", "thanks", "thank",
    // asset-noun stopwords (avoid matching these as names)
    "asset", "assets", "place", "places", "thing", "things", "venue", "venues",
    "atlanta", "southwest", "city", "areas", "neighborhood", "neighborhoods",
    "service", "services",
  ]);
  const tokens = q
    .split(" ")
    .filter((t) => t.length >= NAME_TOKEN_MIN_LEN && !stops.has(t));
  if (tokens.length) {
    const candidate = tokens.sort((a, b) => b.length - a.length)[0];
    if (candidate) out.nameMention = candidate;
  }

  if (!out.matchedSignals.length) {
    out.generalAsset = true;
  }
  return out;
}

function composeAnswer(intent: ParsedIntent, matched: any[], total: number): string {
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

// --- queries -----------------------------------------------------------------

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("locations").collect();
  },
});

export const get = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    return await ctx.db
      .query("locations")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
  },
});

export const search = query({
  args: { question: v.string() },
  handler: async (ctx, { question }) => {
    const all = await ctx.db.query("locations").collect();
    const intent = parseIntent(question);

    let out = all;

    if (intent.nameMention) {
      const mention = intent.nameMention;
      const direct = all.filter((l) => norm(l.name).includes(mention));
      if (direct.length) out = direct;
    }

    if (intent.category) {
      const cat = intent.category;
      out = out.filter((l) => l.category === cat);
    }

    for (const f of intent.features) {
      out = out.filter((l) => l.features.includes(f));
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
        (a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount,
      );
    } else if (intent.wantCheapest) {
      out = [...out].sort(
        (a, b) => a.priceTier - b.priceTier || b.rating - a.rating,
      );
    } else {
      out = [...out].sort((a, b) => b.rating - a.rating);
    }

    const limited = out.slice(0, 6);
    const answer = composeAnswer(intent, limited, all.length);

    return {
      answer,
      intent,
      matched: limited,
      total: all.length,
    };
  },
});

export const topPicks = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("locations").collect();
    return {
      featured: [...all].sort((a, b) => b.rating - a.rating)[0] ?? null,
      cities: Array.from(new Set(all.map((l) => l.city))),
      counts: {
        total: all.length,
        openNow: all.filter((l) => isOpenAt(l.hours as any)).length,
        avgRating:
          all.length === 0
            ? 0
            : Math.round((all.reduce((s, l) => s + l.rating, 0) / all.length) * 10) /
              10,
      },
    };
  },
});

// --- seed --------------------------------------------------------------------

export const seed = mutation({
  args: { force: v.optional(v.boolean()) },
  handler: async (ctx, { force }) => {
    const existing = await ctx.db.query("locations").first();
    if (existing && !force) return { inserted: 0, skipped: true };

    if (force) {
      const all = await ctx.db.query("locations").collect();
      for (const l of all) await ctx.db.delete(l._id);
    }

    const rows = SEED_LOCATIONS;
    let inserted = 0;
    for (const r of rows) {
      await ctx.db.insert("locations", r);
      inserted += 1;
    }
    return { inserted, skipped: false };
  },
});

// --- seed data ---------------------------------------------------------------
// 12 hand-curated Southwest Atlanta community assets. Coordinates are approximate.
// Hours follow typical Atlanta civic programming (M–F business, weekends reduced).

const SEED_H = (
  mon: string,
  tue: string,
  wed: string,
  thu: string,
  fri: string,
  sat: string,
  sun: string,
) => ({
  mon: { open: mon.split("–")[0], close: mon.split("–")[1] },
  tue: { open: tue.split("–")[0], close: tue.split("–")[1] },
  wed: { open: wed.split("–")[0], close: wed.split("–")[1] },
  thu: { open: thu.split("–")[0], close: thu.split("–")[1] },
  fri: { open: fri.split("–")[0], close: fri.split("–")[1] },
  sat: { open: sat.split("–")[0], close: sat.split("–")[1] },
  sun: { open: sun.split("–")[0], close: sun.split("–")[1] },
});

const SEED_LOCATIONS: Array<any> = [
  {
    slug: "atlanta-west-end-library",
    name: "Atlanta West End Library",
    tagline: "A Carnegie-era Fulton County branch at the heart of the West End.",
    category: "library",
    rating: 4.7,
    reviewCount: 412,
    priceTier: 0,
    description:
      "Two-story branch with adult and youth reading rooms, free public computers, free Wi-Fi, and a rotating local-author display. Saturday storytime and resume clinics are weekly staples.",
    address: "525 Peeples St SW",
    city: "Atlanta",
    state: "GA",
    country: "USA",
    postalCode: "30310",
    lat: 33.7330,
    lng: -84.4136,
    hours: SEED_H(
      "10:00–20:00",
      "10:00–20:00",
      "10:00–20:00",
      "10:00–20:00",
      "10:00–18:00",
      "10:00–18:00",
      "13:00–18:00",
    ),
    features: [
      "public-wifi",
      "free",
      "wheelchair-accessible",
      "youth-programs",
      "restrooms",
      "open-weekends",
    ],
    openedYear: 1909,
    signatureDrink: "Saturday storytime",
    ownerName: "Fulton County Library System",
    imageUrl:
      "https://images.unsplash.com/photo-1568667256549-094345857637?auto=format&fit=crop&w=1200&q=80",
    accentColor: "#A0764A",
  },
  {
    slug: "collier-heights-library",
    name: "Collier Heights Library",
    tagline: "Fulton's northwest branch, recently expanded.",
    category: "library",
    rating: 4.5,
    reviewCount: 238,
    priceTier: 0,
    description:
      "A quiet reading and study space adjacent to the Collier Heights Town Center. Tutoring on Tuesdays, an after-school draw club, and a teen homework room run by FULTONread volunteers.",
    address: "3910 Collier Dr NW",
    city: "Atlanta",
    state: "GA",
    country: "USA",
    postalCode: "30331",
    lat: 33.7598,
    lng: -84.4693,
    hours: SEED_H(
      "10:00–19:00",
      "10:00–19:00",
      "10:00–19:00",
      "10:00–19:00",
      "10:00–17:00",
      "10:00–17:00",
      "—",
    ),
    features: [
      "public-wifi",
      "free",
      "wheelchair-accessible",
      "youth-programs",
      "restrooms",
    ],
    openedYear: 1991,
    signatureDrink: "Teen homework room",
    ownerName: "Fulton County Library System",
    imageUrl:
      "https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&w=1200&q=80",
    accentColor: "#8B5E3C",
  },
  {
    slug: "adams-park-recreation-center",
    name: "Adams Park Recreation Center",
    tagline: "A Collier Heights anchor for youth athletics and senior fitness.",
    category: "recreation-center",
    rating: 4.6,
    reviewCount: 521,
    priceTier: 0,
    description:
      "City of Atlanta-managed facility with a gym, senior fitness room, walking league, and weekend youth basketball. Adjacent to Adams Park green space.",
    address: "1626 Delaware Ave SW",
    city: "Atlanta",
    state: "GA",
    country: "USA",
    postalCode: "30311",
    lat: 33.7488,
    lng: -84.4525,
    hours: SEED_H(
      "09:00–21:00",
      "09:00–21:00",
      "09:00–21:00",
      "09:00–21:00",
      "09:00–21:00",
      "10:00–18:00",
      "13:00–18:00",
    ),
    features: [
      "wheelchair-accessible",
      "free",
      "youth-programs",
      "senior-programs",
      "restrooms",
      "open-weekends",
    ],
    openedYear: 1956,
    signatureDrink: "Senior walking league",
    ownerName: "City of Atlanta Parks & Recreation",
    imageUrl:
      "https://images.unsplash.com/photo-1571902943202-507ec2618e8f?auto=format&fit=crop&w=1200&q=80",
    accentColor: "#5C7A52",
  },
  {
    slug: "center-hill-park",
    name: "Center Hill Park",
    tagline: "A pocket park with playground, splash pad, and walking loop.",
    category: "park",
    rating: 4.4,
    reviewCount: 187,
    priceTier: 0,
    description:
      "Neighborhood green space with a tot playground, a small splash pad (open May–Sep), and a quarter-mile walking loop. Restrooms and drinking fountains on site.",
    address: "1745 Center Hill Ave SW",
    city: "Atlanta",
    state: "GA",
    country: "USA",
    postalCode: "30331",
    lat: 33.7447,
    lng: -84.4665,
    hours: SEED_H("07:00–21:00", "07:00–21:00", "07:00–21:00", "07:00–21:00", "07:00–21:00", "07:00–22:00", "07:00–22:00"),
    features: [
      "free",
      "wheelchair-accessible",
      "youth-programs",
      "restrooms",
      "open-weekends",
    ],
    openedYear: 1982,
    signatureDrink: "Splash pad (May–Sep)",
    ownerName: "City of Atlanta Parks & Recreation",
    imageUrl:
      "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1200&q=80",
    accentColor: "#6B8B5C",
  },
  {
    slug: "west-end-park",
    name: "West End Park",
    tagline: "Historic park anchoring the West End commercial corridor.",
    category: "park",
    rating: 4.6,
    reviewCount: 304,
    priceTier: 0,
    description:
      "Tree-lined park with benches, a small amphitheater, and the seasonal West End Farmers Market. Connects to the Atlanta BeltLine Westside Trail.",
    address: "1075 Oglethorpe Ave SW",
    city: "Atlanta",
    state: "GA",
    country: "USA",
    postalCode: "30310",
    lat: 33.7362,
    lng: -84.4125,
    hours: SEED_H("07:00–22:00", "07:00–22:00", "07:00–22:00", "07:00–22:00", "07:00–22:00", "07:00–23:00", "07:00–23:00"),
    features: [
      "free",
      "wheelchair-accessible",
      "transit-accessible",
      "open-weekends",
    ],
    openedYear: 1900,
    signatureDrink: "West End Farmers Market",
    ownerName: "City of Atlanta Parks & Recreation",
    imageUrl:
      "https://images.unsplash.com/photo-1498243691581-b145c3f54a5a?auto=format&fit=crop&w=1200&q=80",
    accentColor: "#5C7A52",
  },
  {
    slug: "good-samaritan-health-center",
    name: "Good Samaritan Health Center",
    tagline: "Sliding-scale primary, dental, and pediatric care on the Westside.",
    category: "clinic",
    rating: 4.8,
    reviewCount: 897,
    priceTier: 1,
    description:
      "Federally qualified health center with sliding-scale pricing, on-site pharmacy, and an integrated pediatric clinic. Walk-ins welcomed before 11am; appointments online.",
    address: "1015 Donald Lee Hollowell Pkwy NW",
    city: "Atlanta",
    state: "GA",
    country: "USA",
    postalCode: "30318",
    lat: 33.7712,
    lng: -84.4945,
    hours: SEED_H(
      "08:00–17:00",
      "08:00–17:00",
      "08:00–17:00",
      "08:00–17:00",
      "08:00–17:00",
      "—",
      "—",
    ),
    features: [
      "wheelchair-accessible",
      "youth-programs",
      "restrooms",
      "transit-accessible",
    ],
    openedYear: 1998,
    signatureDrink: "Pediatric well-child clinic",
    ownerName: "Good Samaritan Health & Wellness",
    imageUrl:
      "https://images.unsplash.com/photo-1538108149393-fbbd81895907?auto=format&fit=crop&w=1200&q=80",
    accentColor: "#4F6F85",
  },
  {
    slug: "btw-historic-building",
    name: "Booker T. Washington High School (Building)",
    tagline: "The historic 1923 Booker T. Washington High School building.",
    category: "school",
    rating: 4.5,
    reviewCount: 142,
    priceTier: 0,
    description:
      "Originally opened in 1923 as the first public Black high school in Atlanta, the building is now a cultural landmark and host site for community programming. Tour requests through the alumni council.",
    address: "45 Whitehouse Dr SW",
    city: "Atlanta",
    state: "GA",
    country: "USA",
    postalCode: "30310",
    lat: 33.7548,
    lng: -84.4397,
    hours: SEED_H("—", "—", "—", "—", "—", "10:00–16:00", "10:00–16:00"),
    features: [
      "free",
      "open-weekends",
      "wheelchair-accessible",
      "restrooms",
    ],
    openedYear: 1923,
    signatureDrink: "Alumni heritage tours",
    ownerName: "Atlanta Public Schools Heritage Council",
    imageUrl:
      "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80",
    accentColor: "#7A5C3D",
  },
  {
    slug: "kipp-atlanta-collegiate",
    name: "KIPP Atlanta Collegiate",
    tagline: "Public charter high school (5–12) on the Westside.",
    category: "school",
    rating: 4.4,
    reviewCount: 218,
    priceTier: 0,
    description:
      "A tuition-free public charter serving grades 5–12, with extended academic and athletic programming. Open enrollment windows in February and August.",
    address: "98 Anderson Ave NW",
    city: "Atlanta",
    state: "GA",
    country: "USA",
    postalCode: "30314",
    lat: 33.7618,
    lng: -84.4693,
    hours: SEED_H(
      "07:30–16:30",
      "07:30–16:30",
      "07:30–16:30",
      "07:30–16:30",
      "07:30–15:30",
      "—",
      "—",
    ),
    features: [
      "free",
      "wheelchair-accessible",
      "youth-programs",
      "transit-accessible",
    ],
    openedYear: 2003,
    signatureDrink: "After-school tutoring block",
    ownerName: "KIPP Metro Atlanta Schools",
    imageUrl:
      "https://images.unsplash.com/photo-1576267423048-15c0040fec78?auto=format&fit=crop&w=1200&q=80",
    accentColor: "#5C4434",
  },
  {
    slug: "wrens-nest",
    name: "Wren's Nest",
    tagline: "Joel Chandler Harris's home; birthplace of the Uncle Remus tales.",
    category: "museum",
    rating: 4.7,
    reviewCount: 326,
    priceTier: 1,
    description:
      "Atlanta's last remaining trap-door-trap-frame home of the late Victorian era. Saturday afternoon storytelling with Aunt Crissy continues a 130-year tradition. Suggested donation $5.",
    address: "1050 Ralph David Abernathy Blvd SW",
    city: "Atlanta",
    state: "GA",
    country: "USA",
    postalCode: "30310",
    lat: 33.7322,
    lng: -84.4134,
    hours: SEED_H("—", "—", "—", "—", "—", "10:00–15:00", "13:00–16:00"),
    features: [
      "free",
      "youth-programs",
      "open-weekends",
      "wheelchair-accessible",
    ],
    openedYear: 1881,
    signatureDrink: "Saturday folk storytelling",
    ownerName: "Wren's Nest Foundation",
    imageUrl:
      "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=1200&q=80",
    accentColor: "#8C6B4F",
  },
  {
    slug: "hammonds-house-museum",
    name: "Hammonds House Museum",
    tagline: "A Victorian home turned museum of African-diaspora art.",
    category: "museum",
    rating: 4.6,
    reviewCount: 198,
    priceTier: 1,
    description:
      "Rotating exhibitions of work by artists of African descent, a permanent collection of mid-20th-century Black American painters, and a Saturday arts-ed workshop for ages 6–12.",
    address: "503 Peeples St SW",
    city: "Atlanta",
    state: "GA",
    country: "USA",
    postalCode: "30310",
    lat: 33.7320,
    lng: -84.4100,
    hours: SEED_H("—", "10:00–17:00", "10:00–17:00", "10:00–17:00", "10:00–17:00", "12:00–17:00", "—"),
    features: [
      "wheelchair-accessible",
      "youth-programs",
      "open-weekends",
      "restrooms",
    ],
    openedYear: 1988,
    signatureDrink: "Saturday youth art workshop",
    ownerName: "Hammonds House Foundation",
    imageUrl:
      "https://images.unsplash.com/photo-1505321515b0eecc2df3a3c9a5eb3f5e0?auto=format&fit=crop&w=1200&q=80",
    accentColor: "#7A5E4B",
  },
  {
    slug: "pittsburgh-community-resource-center",
    name: "Pittsburgh Community Resource Center",
    tagline: "Pittsburgh's hub for civic meetings and youth services.",
    category: "community-center",
    rating: 4.5,
    reviewCount: 162,
    priceTier: 0,
    description:
      "Free meeting space for neighborhood associations, after-school programming, adult literacy classes, and a weekly food-box distribution in partnership with the Atlanta Community Food Bank.",
    address: "750 Garibaldi St SW",
    city: "Atlanta",
    state: "GA",
    country: "USA",
    postalCode: "30310",
    lat: 33.7017,
    lng: -84.4287,
    hours: SEED_H("10:00–20:00", "10:00–20:00", "10:00–20:00", "10:00–20:00", "10:00–18:00", "—", "—"),
    features: [
      "free",
      "youth-programs",
      "senior-programs",
      "wheelchair-accessible",
      "restrooms",
      "transit-accessible",
    ],
    openedYear: 2009,
    signatureDrink: "Tuesday food-box distribution",
    ownerName: "City of Atlanta — Department of City Planning Pittsburgh Pilot",
    imageUrl:
      "https://images.unsplash.com/photo-1486325212027-8081e485255e?auto=format&fit=crop&w=1200&q=80",
    accentColor: "#A47551",
  },
  {
    slug: "marta-oakland-city-station",
    name: "MARTA Oakland City Station",
    tagline: "South Line rapid-transit link between downtown and the Westside.",
    category: "transit",
    rating: 4.3,
    reviewCount: 1184,
    priceTier: 1,
    description:
      "MARTA heavy-rail station on the Green/Red line, with connecting bus routes for West End, Pittsburgh, and Adamsville. Breeze card reload on-site.",
    address: "1405 Annie St",
    city: "Atlanta",
    state: "GA",
    country: "USA",
    postalCode: "30310",
    lat: 33.7173,
    lng: -84.4428,
    hours: SEED_H("04:30–01:00", "04:30–01:00", "04:30–01:00", "04:30–01:00", "04:30–01:00", "04:30–01:00", "04:30–01:00"),
    features: [
      "wheelchair-accessible",
      "transit-accessible",
      "restrooms",
      "open-weekends",
    ],
    openedYear: 1979,
    signatureDrink: "Green/Red line",
    ownerName: "Metropolitan Atlanta Rapid Transit Authority",
    imageUrl:
      "https://images.unsplash.com/photo-1581262208435-41726149a759?auto=format&fit=crop&w=1200&q=80",
    accentColor: "#3F6F9A",
  },
];
