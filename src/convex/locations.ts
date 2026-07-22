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

function priceSymbol(tier: number): string {
  return tier <= 1 ? "$" : tier === 2 ? "$$" : "$$$";
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

const categoryKeywords: Record<string, string[]> = {
  "espresso-bar": ["espresso", "cortado", "latte", "cappuccino"],
  "pour-over": ["pour over", "pourover", "filter", "chemex", "v60", "aeropress"],
  brunch: ["brunch", "breakfast", "morning food", "eggs", "pancake"],
  bakery: ["bakery", "pastry", "croissant", "cake", "bread"],
  roastery: ["roaster", "roastery", "beans"],
  "tea-house": ["tea", "matcha", "chai"],
  "quick-serve": ["grab", "quick", "to go", "takeaway", "drive thru", "drive-thru"],
};

function categoryFromQuestion(q: string): string | null {
  for (const [cat, words] of Object.entries(categoryKeywords)) {
    if (words.some((w) => q.includes(w))) return cat;
  }
  return null;
}

function featuresFromQuestion(q: string): string[] {
  const out: string[] = [];
  if (/\bwifi|wi-fi|internet\b/.test(q)) out.push("wifi");
  if (/\boutdoor|outside|patio|terrace|sidewalk\b/.test(q)) out.push("outdoor");
  if (/\bpet|dog|puppy\b/.test(q)) out.push("pet-friendly");
  if (/\boutlet|plug|laptop|work\b/.test(q)) out.push("power-outlets");
  if (/\bquiet|calm|study|peaceful\b/.test(q)) out.push("quiet");
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
  generalCoffee: boolean;
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
    generalCoffee: false,
    matchedSignals: [],
  };

  if (/\bhigh(ly)? rated|highest rated|best rated|best\b/.test(q)) {
    out.wantTopRated = true;
    out.matchedSignals.push("highest rating");
  }

  if (/\bcheap|cheapest|affordable|budget|inexpensive\b/.test(q)) {
    out.wantCheapest = true;
    out.priceMax = 2;
    out.matchedSignals.push("lowest price");
  }
  if (/\bexpensive|fancy|upscale|luxury|pricey\b/.test(q)) {
    out.priceMin = 3;
    out.matchedSignals.push("premium pricing");
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

  // Pull out any "Stumptown"-like single-word mentions as a name search.
  // Strip stopwords and pick the longest token as a probable name fragment.
  const stops = new Set([
    "a", "an", "the", "is", "are", "i", "you", "we", "me", "can", "do", "does",
    "find", "show", "list", "which", "what", "where", "any", "with", "for",
    "of", "to", "and", "or", "in", "on", "at", "my", "your", "near", "around",
    "best", "top", "rated", "rating", "most", "least", "cheap", "expensive",
    "open", "now", "today", "right", "here", "there", "this", "that",
    "coffee", "cafes", "cafe", "shop", "shops", "place", "places", "spot",
    "spots", "recommend", "suggest", "good", "great", "nice", "love", "like",
    "have", "has", "one", "two", "three", "want", "looking", "give", "tell",
    "about", "hello", "hey", "please", "thanks", "thank",
  ]);
  const tokens = q
    .split(" ")
    .filter((t) => t.length >= NAME_TOKEN_MIN_LEN && !stops.has(t));
  if (tokens.length) {
    const candidate = tokens.sort((a, b) => b.length - a.length)[0];
    if (candidate) out.nameMention = candidate;
  }

  if (!out.matchedSignals.length) {
    out.generalCoffee = true;
  }
  return out;
}

function composeAnswer(intent: ParsedIntent, matched: any[], total: number): string {
  if (!intent.matchedSignals.length) {
    if (!matched.length) {
      return `I didn't find anything in our atlas yet. The dataset is still being curated — try again shortly.`;
    }
    const top = matched.slice(0, 3).map((m) => `${m.name} (${m.rating.toFixed(1)}★)`).join(", ");
    return `I don't have a strong filter to apply, so I pulled our top-rated spots by default. ${matched.length} café${matched.length === 1 ? "" : "s"} in the atlas, led by ${top}.`;
  }

  if (!matched.length) {
    const filterDesc = intent.matchedSignals.join(", ");
    return `No café in the atlas matches all of: ${filterDesc}. Try loosening one — e.g. drop a feature or widen the price range.`;
  }

  const lead =
    matched.length === 1
      ? `One café matches`
      : `${matched.length} cafés match`;
  const filterDesc = intent.matchedSignals.join(", ");
  const list = matched
    .slice(0, 3)
    .map((m) => `${m.name} (${m.rating.toFixed(1)}★ · ${priceSymbol(m.priceTier)})`)
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
      if (direct.length) {
        out = direct;
      }
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
      out = [...out].sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount);
    } else if (intent.wantCheapest) {
      out = [...out].sort((a, b) => a.priceTier - b.priceTier || b.rating - a.rating);
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
            : Math.round((all.reduce((s, l) => s + l.rating, 0) / all.length) * 10) / 10,
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
      // wipe when reseeding
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

const SEED_H = (mon: string, tue: string, wed: string, thu: string, fri: string, sat: string, sun: string) => ({
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
    slug: "stumptown-hawthorne",
    name: "Stumptown Coffee Roasters",
    tagline: "Pioneer of the third-wave pour-over movement.",
    category: "pour-over",
    rating: 4.8,
    reviewCount: 1243,
    priceTier: 2,
    description:
      "Anchored in a converted Victorian on Hawthorne, this flagship pours single-origin beans from a Hennie van Wyk roaster and offers barista-led cuppings every Saturday morning.",
    address: "3356 SE Hawthorne Blvd",
    city: "Portland",
    state: "OR",
    country: "USA",
    postalCode: "97214",
    lat: 45.5121,
    lng: -122.6303,
    hours: SEED_H("06:00–19:00", "06:00–19:00", "06:00–19:00", "06:00–19:00", "06:00–20:00", "07:00–20:00", "07:00–19:00"),
    features: ["wifi", "outdoor", "power-outlets", "quiet"],
    openedYear: 1999,
    signatureDrink: "Hair Bender espresso",
    ownerName: "Duane Sorenson",
    imageUrl:
      "https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&w=1200&q=80",
    accentColor: "#8A4A2E",
  },
  {
    slug: "heart-burnside",
    name: "Heart Coffee Roasters",
    tagline: "Light-roast ethos, dialed-in espresso.",
    category: "espresso-bar",
    rating: 4.7,
    reviewCount: 982,
    priceTier: 2,
    description:
      "Heart's Burnside café is a study in restraint: white tile, walnut counters, and a quiet soundtrack. Espresso is pulled on a La Marzocco Linea Mini and rotated seasonally.",
    address: "2211 E Burnside St",
    city: "Portland",
    state: "OR",
    country: "USA",
    postalCode: "97214",
    lat: 45.5239,
    lng: -122.6385,
    hours: SEED_H("06:30–17:00", "06:30–17:00", "06:30–17:00", "06:30–17:00", "06:30–18:00", "07:00–18:00", "07:30–17:00"),
    features: ["wifi", "power-outlets", "pet-friendly"],
    openedYear: 2009,
    signatureDrink: "Heart Cortado",
    ownerName: "Wes Avila",
    imageUrl:
      "https://images.unsplash.com/photo-1497935586351-b67a49e012bf?auto=format&fit=crop&w=1200&q=80",
    accentColor: "#7C5C3F",
  },
  {
    slug: "coava-pearl",
    name: "Coava Coffee Roasters",
    tagline: "Slow-roasted, fast-served.",
    category: "roastery",
    rating: 4.6,
    reviewCount: 712,
    priceTier: 2,
    description:
      "Adjacent to the production roastery on SE Main, Coava's flagship lets you watch green beans turn into drum-roasted coffee while you sip. The Roastery Hour tour is free on Saturdays.",
    address: "1300 SE Grand Ave",
    city: "Portland",
    state: "OR",
    country: "USA",
    postalCode: "97214",
    lat: 45.5131,
    lng: -122.6561,
    hours: SEED_H("07:00–17:00", "07:00–17:00", "07:00–17:00", "07:00–17:00", "07:00–19:00", "08:00–19:00", "08:00–17:00"),
    features: ["wifi", "outdoor"],
    openedYear: 2008,
    signatureDrink: "Fred Espresso Blend",
    ownerName: "Matt Higgins",
    imageUrl:
      "https://images.unsplash.com/photo-1442512595331-e89e73853f31?auto=format&fit=crop&w=1200&q=80",
    accentColor: "#6B4423",
  },
  {
    slug: "proud-coffee-mississippi",
    name: "Proud Coffee",
    tagline: "Mississippi Avenue's brunch-and-espresso staple.",
    category: "brunch",
    rating: 4.7,
    reviewCount: 528,
    priceTier: 2,
    description:
      "Sun-flooded brunch café with a four-stool espresso bar and a tight seasonal menu: shakshuka, brown-butter waffles, and a daily baker's board.",
    address: "3913 N Mississippi Ave",
    city: "Portland",
    state: "OR",
    country: "USA",
    postalCode: "97227",
    lat: 45.5517,
    lng: -122.6757,
    hours: SEED_H("07:30–16:00", "07:30–16:00", "07:30–16:00", "07:30–16:00", "07:30–17:00", "08:00–17:00", "08:00–16:00"),
    features: ["wifi", "outdoor", "pet-friendly"],
    openedYear: 2011,
    signatureDrink: "Cardamom latte",
    ownerName: "Kira O'Brien",
    imageUrl:
      "https://images.unsplash.com/photo-1559925393-8be0ec4767c8?auto=format&fit=crop&w=1200&q=80",
    accentColor: "#A47551",
  },
  {
    slug: "sterling-coffee",
    name: "Sterling Coffee Roasters",
    tagline: "Light Nordic profiles, meticulous dial-ins.",
    category: "pour-over",
    rating: 4.9,
    reviewCount: 401,
    priceTier: 3,
    description:
      "A six-seat bar with rotating single origins from Ethiopia, Kenya, and Colombia. Each cup is brewed to order with a precise 1:16 ratio on Kalita Wave drippers.",
    address: "417 NW 13th Ave",
    city: "Portland",
    state: "OR",
    country: "USA",
    postalCode: "97209",
    lat: 45.5289,
    lng: -122.6853,
    hours: SEED_H("07:00–17:00", "07:00–17:00", "07:00–17:00", "07:00–17:00", "07:00–18:00", "08:00–18:00", "08:00–17:00"),
    features: ["wifi", "quiet", "power-outlets"],
    openedYear: 2014,
    signatureDrink: "Gesha Village pour-over",
    ownerName: "Duane Foster",
    imageUrl:
      "https://images.unsplash.com/photo-1453614512568-c4024d13c247?auto=format&fit=crop&w=1200&q=80",
    accentColor: "#5C4434",
  },
  {
    slug: "case-study-alberta",
    name: "Case Study Coffee",
    tagline: "Minimal design, maximized espresso.",
    category: "espresso-bar",
    rating: 4.5,
    reviewCount: 643,
    priceTier: 2,
    description:
      "A pale-concrete bar with a single Slayer espresso machine and a tight menu. Pastries come from Portland's Lai Châu bakery weekly.",
    address: "2815 NE Alberta St",
    city: "Portland",
    state: "OR",
    country: "USA",
    postalCode: "97211",
    lat: 45.5596,
    lng: -122.6409,
    hours: SEED_H("06:30–17:00", "06:30–17:00", "06:30–17:00", "06:30–17:00", "06:30–18:00", "07:00–18:00", "07:00–17:00"),
    features: ["wifi", "outdoor"],
    openedYear: 2015,
    signatureDrink: "Two-shot Flat White",
    ownerName: "JL Wood",
    imageUrl:
      "https://images.unsplash.com/photo-1521017432531-fbd92d768814?auto=format&fit=crop&w=1200&q=80",
    accentColor: "#83604A",
  },
  {
    slug: "teiph-matrix",
    name: "Tea Matrix",
    tagline: "A quiet study of Asian teas and matcha.",
    category: "tea-house",
    rating: 4.4,
    reviewCount: 312,
    priceTier: 2,
    description:
      "A serene tearoom with a fifty-item tea shelf and a siphon bar. The matcha is stone-milled in-house every other week.",
    address: "603 NW 13th Ave",
    city: "Portland",
    state: "OR",
    country: "USA",
    postalCode: "97209",
    lat: 45.5272,
    lng: -122.6855,
    hours: SEED_H("10:00–19:00", "10:00–19:00", "10:00–19:00", "10:00–19:00", "10:00–20:00", "10:00–20:00", "11:00–18:00"),
    features: ["wifi", "quiet", "power-outlets"],
    openedYear: 2017,
    signatureDrink: "Ceremonial matcha",
    ownerName: "Anika Patel",
    imageUrl:
      "https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=1200&q=80",
    accentColor: "#4F6F5C",
  },
  {
    slug: "sisters-bakery",
    name: "Sisters Bakehouse",
    tagline: "Sourdough-first bakery with a slow espresso.",
    category: "bakery",
    rating: 4.6,
    reviewCount: 287,
    priceTier: 1,
    description:
      "Wood-fired sourdough, laminated morning pastries, and a small but considered coffee program featuring two local roasters on rotation.",
    address: "4018 N Mississippi Ave",
    city: "Portland",
    state: "OR",
    country: "USA",
    postalCode: "97227",
    lat: 45.5508,
    lng: -122.6771,
    hours: SEED_H("07:00–15:00", "07:00–15:00", "07:00–15:00", "07:00–15:00", "07:00–17:00", "08:00–17:00", "08:00–15:00"),
    features: ["wifi", "outdoor", "pet-friendly"],
    openedYear: 2019,
    signatureDrink: "Oat cortado",
    ownerName: "Maya & Lia Soto",
    imageUrl:
      "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=1200&q=80",
    accentColor: "#A06A3E",
  },
  {
    slug: "floyd-coffee",
    name: "Floyd's Coffee",
    tagline: "Neighborhood counter since 1978.",
    category: "quick-serve",
    rating: 4.2,
    reviewCount: 1108,
    priceTier: 1,
    description:
      "A walk-up window on a busy corner. House-roasted daily; the breakfast burrito keeps the regulars coming at 6 a.m.",
    address: "432 NW 9th Ave",
    city: "Portland",
    state: "OR",
    country: "USA",
    postalCode: "97209",
    lat: 45.5260,
    lng: -122.6813,
    hours: SEED_H("05:30–15:00", "05:30–15:00", "05:30–15:00", "05:30–15:00", "05:30–15:00", "06:00–14:00", "06:00–14:00"),
    features: ["quick", "outdoor"],
    openedYear: 1978,
    signatureDrink: "House Drip",
    ownerName: "The Floyd Family",
    imageUrl:
      "https://images.unsplash.com/photo-1510707577719-ae7c14805e51?auto=format&fit=crop&w=1200&q=80",
    accentColor: "#7A5B3D",
  },
  {
    slug: "good-coffee-broadway",
    name: "Good Coffee & Pastry",
    tagline: "Daylight café with a paperback shelf.",
    category: "bakery",
    rating: 4.5,
    reviewCount: 412,
    priceTier: 2,
    description:
      "A book-lined café near the Keller Auditorium where half the seating is a long banquette and the espresso bar faces a wall of vinyl.",
    address: "1139 SW Broadway",
    city: "Portland",
    state: "OR",
    country: "USA",
    postalCode: "97205",
    lat: 45.5198,
    lng: -122.6826,
    hours: SEED_H("06:30–18:00", "06:30–18:00", "06:30–18:00", "06:30–18:00", "06:30–20:00", "07:00–20:00", "07:30–18:00"),
    features: ["wifi", "quiet", "power-outlets"],
    openedYear: 2012,
    signatureDrink: "Honey cardamom latte",
    ownerName: "Sora Tanaka",
    imageUrl:
      "https://images.unsplash.com/photo-1525610553991-2bede1a236e2?auto=format&fit=crop&w=1200&q=80",
    accentColor: "#856446",
  },
  {
    slug: "roseway-roasters",
    name: "Roseway Roasters",
    tagline: "Northside roastery with weekly cuppings.",
    category: "roastery",
    rating: 4.4,
    reviewCount: 198,
    priceTier: 2,
    description:
      "Adjacent to a community kiln-share, Roseway roasts on a refurbished Probat and runs a Tuesday-night cupping for subscribers.",
    address: "4625 NE Fremont St",
    city: "Portland",
    state: "OR",
    country: "USA",
    postalCode: "97213",
    lat: 45.5489,
    lng: -122.6021,
    hours: SEED_H("07:00–16:00", "07:00–16:00", "07:00–16:00", "07:00–16:00", "07:00–18:00", "08:00–18:00", "08:00–16:00"),
    features: ["wifi", "pet-friendly"],
    openedYear: 2016,
    signatureDrink: "Fremont Blend",
    ownerName: "Noor Aboud",
    imageUrl:
      "https://images.unsplash.com/photo-1453614512568-c4024d13c247?auto=format&fit=crop&w=1200&q=80",
    accentColor: "#5C4434",
  },
  {
    slug: "verdant-tea",
    name: "Verdant Tea & Books",
    tagline: "Slow tea bar inside an indie bookshop.",
    category: "tea-house",
    rating: 4.6,
    reviewCount: 156,
    priceTier: 2,
    description:
      "Tucked inside Powell's Books, Verdant serves single-origin teas brewed to order, paired with reading nooks and a daily cupping flight.",
    address: "1005 W Burnside St",
    city: "Portland",
    state: "OR",
    country: "USA",
    postalCode: "97209",
    lat: 45.5231,
    lng: -122.6810,
    hours: SEED_H("10:00–20:00", "10:00–20:00", "10:00–20:00", "10:00–20:00", "10:00–21:00", "10:00–21:00", "10:00–20:00"),
    features: ["wifi", "quiet"],
    openedYear: 2018,
    signatureDrink: "Dragonwell cold brew",
    ownerName: "Linnea Yi",
    imageUrl:
      "https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?auto=format&fit=crop&w=1200&q=80",
    accentColor: "#4F6F5C",
  },
];
