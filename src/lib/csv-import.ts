// Vanilla RFC4180-style CSV/TSV parser + smart column-alias mapping for the
// atlas spreadsheet. No third-party dependency. The parser reads the entire
// uploaded file; the only safety ceiling is a generous one that exists purely
// to prevent a runaway browser tab from OOMing on truly enormous files.
//
// Robustness focus: minimize "unable to geocode" failures from uploaded
// HUD/spreadsheet data by:
//   * Freeform address parsing (a single combined address column).
//   * PO-Box filtering at parse time (no point sending to Nominatim).
//   * Suite / unit / building stripping before geocode.
//   * Street-suffix and directional abbreviation expansion for cache-key
//     normalization (so "Peachtree St NE" and "Peachtree Street Northeast"
//     hit the same cache slot).
//   * Diacritics flattening.
//
// In addition to producing ready-to-map rows (with valid lat/lng), the parser
// returns a separate `pending` list for rows that are otherwise valid but
// lack coordinates. These rows are geocoded via a separate Convex action.
// PO Box rows skip geocoding and land in `chatOnly` so they're searchable.

// Generous safety cap. Effectively "no cap"; only used to guard against
// runaway inputs (e.g. corrupted multi-GB uploads).
const MAX_ROWS = 50000;

/** Final, fully-mapped asset with coords. */
export type AtlasAsset = {
  _id: string;
  _creationTime: number;
  slug: string;
  name: string;
  tagline: string;
  category: string;
  rating: number;
  reviewCount: number;
  priceTier: number;
  description: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  /** NaN until a row is geocoded; downstream code filters with isFinite(). */
  lat: number;
  lng: number;
  hours: {
    mon: { open: string; close: string };
    tue: { open: string; close: string };
    wed: { open: string; close: string };
    thu: { open: string; close: string };
    fri: { open: string; close: string };
    sat: { open: string; close: string };
    sun: { open: string; close: string };
  };
  features: string[];
  openedYear: number;
  signatureDrink: string;
  ownerName?: string;
  imageUrl?: string;
  accentColor?: string;
  /** Public website URL (https://...). Falls back to imageUrl when absent. */
  website?: string;
  /** Social media handle or URL — Facebook, Instagram, LinkedIn, etc. */
  socialMedia?: string;
  /** Direct contact line ("Jane Doe, Program Director"). */
  contactName?: string;
  /** Click-to-call phone number. */
  contactPhone?: string;
  /** Click-to-mail email address. */
  contactEmail?: string;
  /** True iff this row lacks lat/lng and needs geocoding before mapping. */
  needsGeocode?: boolean;
  /** Cache key for client-side de-duplication. */
  geoKey?: string;
  /** Accuracy bucket from the geocode hit; undefined for rows not yet tried. */
  coordAccuracy?: CoordAccuracy;
};

/** Address fragment passed verbatim to Nominatim. */
export type AddressFragment = {
  street: string;
  city: string;
  state: string;
  postalcode: string;
  country: string;
};

/**
 * Coarse accuracy bucket — surfaced to the client so the UI can
 * distinguish rows that came from a structured address match vs a
 * relaxed fuzzy Nominatim match vs a row whose address was first
 * standardized by the Atlas Map AI then re-geocoded through the
 * cascade. The map never uses ZIP-centroid plotting any more — rows
 * that lack a real street address resolve through the AI or stay
 * unmapped.
 */
export type CoordAccuracy =
  | "exact"
  | "relaxed"
  | "cerebras-fixup";

export type ImportedRow = {
  doc: AtlasAsset;
  warnings: string[];
};

export type ImportSummary = {
  rows: ImportedRow[]; // rows with valid lat/lng
  pending: ImportedRow[]; // rows missing lat/lng but otherwise valid → geocode
  chatOnly: ImportedRow[]; // rows that should NOT be geocoded (PO Box, etc.)
  totalParsed: number;
  rejected: number; // unrecoverable (no name, etc.)
  filename: string;
};

// Each field lists header strings that map onto it. Comparison normalizes
// spaces / hyphens / punctuation / case so e.g. "Hours Mon" == "hours_mon" ==
// "HourseMon" == "SubrecipientName / Organization".
const ALIASES: Record<string, string[]> = {
  // Identity
  slug: ["slug", "id", "uid", "uuid", "key"],

  // Name — covers HUD/grant-style "Subrecipient Name", "Organization",
  // grant-program names, civic classes, etc.
  name: [
    "name",
    "title",
    "facility",
    "asset",
    "site",
    "place",
    "label",
    "subrecipient",
    "sub_recipient",
    "subrecipient_name",
    "subrecipientname",
    "organization",
    "org_name",
    "organisation",
    "agency",
    "recipient",
    "program_name",
    "grantee",
    "class",
    "classname",
    "class_name",
    "classtitle",
    "class_title",
    "class_name_title",
    "activity",
    "activities",
    "activityname",
    "activity_name",
    "service",
    "services",
    "servicename",
    "service_name",
    "course",
    "coursename",
    "course_name",
    "session",
    "sessiontitle",
    "session_name",
    "session_title",
    "item",
    "items",
    "itemname",
    "item_name",
    "item_title",
    "placename",
    "place_name",
    "locationname",
    "location_name",
    "sitename",
    "site_name",
    "facilityname",
    "facility_name",
    "titletext",
    "assetname",
    "asset_name",
    "asset_title",
    // The user's HUD sheet puts name + organization in one header.
    "asset_name_or_organization",
    "assetnameororganization",
    "asset_or_organization",
    "assettitle",
    "asset_and_org",
    "name_or_organization",
    "nameororganization",
    "name_and_organization",
    "nameandorganization",
    "programtitle",
    "program_title",
    "venue",
    "venuename",
    "venue_name",
    "amenity",
    "amenities",
    "resource",
    "resources",
    "resourcename",
    "resource_name",
    "stop",
    "stops",
    "stationname",
    "station_name",
  ],

  tagline: ["tagline", "subtitle", "summary", "short", "short_description"],

  category: [
    "category",
    "type",
    "kind",
    "classification",
    "asset_type",
    "asset_type_category",
    "asset_type_name",
    "community_asset_type",
    "community_asset",
    "program_type",
    "service_type",
  ],

  rating: ["rating", "score", "stars", "community_score"],

  reviewCount: [
    "review_count",
    "reviews",
    "reviewcount",
    "visits",
    "monthly_visits",
    "monthly",
    "attendance",
    "weekly_visits",
    "people_served",
    "persons_served",
    "served",
    "households_served",
    "households",
    "current",
    "current_count",
    "current_clients",
    "active",
  ],

  priceTier: [
    "price_tier",
    "price",
    "cost",
    "cost_tier",
    "fee",
    // User's HUD-style CSV uses a literal "Price/Affordability" column with
    // text values like "Free", "Sliding-scale", "$5 per visit". We alias the
    // column AND special-case its content to derive a numeric priceTier.
    "affordability",
    "price_affordability",
    "price_afford",
    "price_aff",
    "affordable",
    "pricing",
    "cost_level",
    "fee_level",
  ],

  // Description is the hardest field to canonicalize because HUD/grant
  // spreadsheets use a zoo of column names for "what is this place / what do
  // they do".  We expand aggressively so that any uploaded CSV with a
  // description-like column lands in `doc.description`.  At parse time we
  // additionally concatenate secondary candidates that don't win the primary
  // slot, so multi-column descriptions (e.g. "Activity Description" +
  // "Notes & Observations") both end up in the popup.
  description: [
    // Direct matches
    "description",
    "desc",
    "details",
    "detail",
    "summary_long",
    "long_description",
    "longdescription",
    "long_desc",
    "longdesc",
    "detailed_description",
    "detaileddescription",
    "description_long",
    "descriptionlong",
    // Notes family
    "notes",
    "notes_observations",
    "notes_&_observations",
    "notes_observations",
    "note",
    "notescomments",
    "notes_comments",
    "additional_notes",
    "additionalnotes",
    "additional_comments",
    "additionalcomments",
    "comments",
    "comment",
    // About / overview
    "about",
    "about_us",
    "aboutus",
    "about_this",
    "aboutthis",
    "about_this_program",
    "about_the_program",
    "overview",
    "brief",
    "brief_description",
    "briefdescription",
    "brief_overview",
    "briefoverview",
    // Service family
    "service_description",
    "servicedescription",
    "service_descriptions",
    "services_description",
    "servicesdescription",
    "description_of_services",
    "descriptionofservices",
    "services_offered",
    "servicesoffered",
    "service_offered",
    "serviceoffered",
    "program_description",
    "programdescription",
    "program_descriptions",
    "activity_description",
    "activitydescription",
    "activity_descriptions",
    "class_description",
    "classdescription",
    "session_description",
    "sessiondescription",
    "course_description",
    "coursedescription",
    "service_resources",
    "service_resources_available",
    "service_resources_description",
    "services_resources",
    "services_resources_available",
    "servicesresourcesavailable",
    "services_resources_description",
    "resources_available",
    "resources",
    "resource_available",
    "resource",
    "what_we_do",
    "whatwedo",
    "what_they_do",
    "whattheydo",
    "what_is_provided",
    "whatisprovided",
    "what_is_offered",
    "whatisOffered",
    // Mission / purpose
    "mission",
    "mission_statement",
    "missionstatement",
    "purpose",
    "purpose_statement",
    "objectives",
    "objective",
    "goals",
    "goal",
    "national_goal",
    "natl_goal",
    "nat_goal",
    "natl_goals",
    "national_goals",
    // Issue / need
    "issue_and_needs",
    "issue_needs",
    "issueneeds",
    "issue_needs_addressed",
    "issueneedsaddressed",
    "issue_needs_summary",
    "issueneedssummary",
    "issues",
    "issue",
    "needs",
    "need",
    "issue_addressed",
    "issueaddressed",
    "needs_addressed",
    "needsaddressed",
    // Activities / actions
    "activity",
    "activities",
    "activities_offered",
    "activitiesoffered",
    "programs_offered",
    "programsoffered",
    "programs",
    "program",
  ],

  address: [
    "address",
    "street",
    "location",
    "street_address",
    "street_address_full",
    "site_address",
    "facility_address",
    "physical_address",
    // Some spreadsheets put city/state/zip inside the address column.
    "full_address",
  ],
  city: ["city", "town", "municipality", "locality"],
  state: ["state", "region", "province", "st"],
  country: ["country", "country_name"],
  county: ["county", "parish", "borough"],
  postalCode: [
    "zip",
    "zip_code",
    "zipcode",
    "postal",
    "postal_code",
    "postalcode",
    "postcode",
  ],

  website: [
    "website",
    "url",
    "web",
    "homepage",
    "site_url",
    "siteurl",
    "web_site",
    "websitelink",
    "website_url",
    "link",
    "online",
    "internet",
    "webpage",
    "home_page",
  ],

  socialMedia: [
    "social",
    "social_media",
    "socialmedia",
    "facebook",
    "instagram",
    "twitter",
    "linkedin",
    "fb",
    "tiktok",
    "youtube",
    "socialhandle",
    "social_handle",
    "social_url",
    "socialurl",
    "sm",
    "facebook_url",
    "instagram_url",
    "twitter_url",
    "linkedin_url",
    "tiktok_url",
    "youtube_url",
  ],

  contactName: [
    "key_contact",
    "keycontact",
    "contact_name",
    "contactname",
    "contact",
    "primary_contact",
    "primarycontact",
    "point_of_contact",
    "pointofcontact",
    "rep",
    "representative",
  ],

  contactPhone: [
    "phone",
    "contact_phone",
    "contactphone",
    "telephone",
    "tel",
    "phonenumber",
    "phone_number",
    "phonenumber",
    "mobile",
    "cell",
    "contact_mobile",
    "contactmobile",
    "cellphone",
    "cell_phone",
    "telephone_number",
    "direct_line",
    "directline",
    "office_phone",
    "officephone",
    "phonenumbercontact",
  ],

  contactEmail: [
    "email",
    "contact_email",
    "contactemail",
    "mailto",
    "e_mail",
    "email_address",
    "emailaddress",
    "contact_e_mail",
    "contactemailaddress",
    "contactaddress",
    "mail",
  ],

  lat: ["lat", "latitude", "y", "y_lat", "coord_lat"],
  lng: ["lng", "long", "longitude", "lon", "x", "x_lng", "coord_long"],

  features: [
    "features",
    "tags",
    "amenities",
    "natl_goal",
    "national_goal",
    "natl_goals",
    "nat_goal",
    "goals",
    "objective",
    "objectives",
  ],

  openedYear: [
    "opened_year",
    "year",
    "since",
    "founded",
    "contract_period",
    "contract_start",
    "contract_year",
    "year_established",
    "start_year",
  ],

  signatureDrink: [
    "signature",
    "program",
    "signature_program",
    "specialty",
    "project",
    "project_hud",
    "project_id",
    "hud_project",
    "project_name",
    "hud_grant_id",
    "grant_id",
    "grant",
  ],

  ownerName: [
    "owner",
    "operator",
    "org",
    "organization",
    "owner_name",
    "agency_name",
    "subrecipient_organization",
    "operating_agency",
    "operator_org",
  ],
  imageUrl: ["image", "image_url", "photo", "picture", "photo_url"],
  accentColor: ["accent_color", "color", "accent"],
};

// ----- Address parsing helpers ---------------------------------------------

/** Strip diacritics and lowercase. Used for cache-key normalization. */
function flattenAscii(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Common street-suffix + directional expansions (US). */
const ABBREV_MAP: Record<string, string> = {
  st: "street",
  ave: "avenue",
  av: "avenue",
  blvd: "boulevard",
  rd: "road",
  dr: "drive",
  ln: "lane",
  ct: "court",
  cir: "circle",
  pl: "place",
  ter: "terrace",
  hwy: "highway",
  pkwy: "parkway",
  way: "way",
  sq: "square",
  tr: "trail",
  drv: "drive",
  cv: "cove",
  tce: "terrace",
  expy: "expressway",
  frwy: "freeway",
  fwy: "freeway",
  loop: "loop",
  est: "estate",
  mnr: "manor",
};

const DIRECTIONAL_MAP: Record<string, string> = {
  n: "north",
  s: "south",
  e: "east",
  w: "west",
  ne: "northeast",
  nw: "northwest",
  se: "southeast",
  sw: "southwest",
};

/** Build a canonical, normalized key for an address fragment. */
export function normalizeAddressKey(addr: AddressFragment): string {
  const tokenizeForKey = (s: string): string => {
    let out = flattenAscii(s).toLowerCase();
    // Strip "PO Box NNN" tokens entirely.
    out = out.replace(/\bp\.?\s*o\.?\s*box\s*[#\w-]*/g, "");
    // Strip trailing suite/unit indicators.
    out = out.replace(
      /\b(?:suite|ste|apt|apartment|unit|#|rm|room|bldg|building|fl|floor|loft|slip|dept|ph|bay)\s*[#\w-]*/g,
      "",
    );
    // Expand abbreviations.
    out = out.replace(
      /\b([a-z]{2,5})\b\.?/g,
      (m) => ABBREV_MAP[m.replace(".", "")] ?? m,
    );
    // Expand directionals.
    out = out.replace(/\b(ne|nw|se|sw|n|s|e|w)\b\.?/g, (m) =>
      DIRECTIONAL_MAP[m.replace(".", "")] ?? m,
    );
    return out
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  };
  return [
    tokenizeForKey(addr.street),
    tokenizeForKey(addr.city),
    tokenizeForKey(addr.state),
    tokenizeForKey(addr.postalcode),
  ]
    .filter(Boolean)
    .join("|");
}

/** Canonical key the client uses to dedupe geocode requests (legacy alias). */
export function geoKeyFor(addr: AddressFragment): string {
  return normalizeAddressKey(addr);
}

/** Return true iff the street line is just a P.O. Box. */
export function isPoBoxOnly(street: string): boolean {
  return /^\s*p\.?\s*o\.?\s*box\s+[#\w-]+/i.test(street);
}

/**
 * Strip a trailing unit/suite/building from a street line so Nominatim
 * gets the canonical street.
 */
export function stripUnit(street: string): string {
  return street
    .replace(
      /\s*[,#]?\s*(?:suite|ste|apt|apartment|unit|#|rm|room|bldg|building|fl|floor|loft|slip|dept|ph|bay)\s*[#\w-]*/gi,
      "",
    )
    .replace(/\s*,\s*$/g, "")
    .trim();
}

/**
 * Parse a single combined address string ("123 Peachtree St NE, Atlanta, GA 30314")
 * into structured fields. Used as a fallback when the CSV doesn't have
 * separate city/state/zip columns, or when the address column itself is
 * a comma-delimited blob.
 */
export function parseFreeformAddress(s: string): AddressFragment {
  const cleaned = flattenAscii(s).trim();
  const parts = cleaned
    .replace(/[\n\r]/g, ",")
    .split(/,/)
    .map((p) => p.trim())
    .filter(Boolean);

  let state = "";
  let postalcode = "";
  let city = "";

  // Walk from the end: peel off "STATE ZIP", "ZIP", "STATE" pieces in any order.
  while (parts.length > 0) {
    const last = parts[parts.length - 1];
    const m1 = last.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (m1) {
      state = m1[1].toUpperCase();
      postalcode = m1[2];
      parts.pop();
      continue;
    }
    const m2 = last.match(/^\d{5}(?:-\d{4})?$/);
    if (m2) {
      postalcode = m2[0];
      parts.pop();
      continue;
    }
    break;
  }

  // Next part back is the city.
  if (parts.length > 0) {
    city = parts.pop() ?? "";
  }

  // Everything left is the street + maybe building/suite markers.
  const street = parts.join(", ").trim();

  return {
    street,
    city,
    state,
    postalcode,
    country: "USA",
  };
}

// ----- Parser ---------------------------------------------------------------

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, "").trim();
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return tabs > commas ? "\t" : ",";
}

export function parseDelimited(text: string, delimiter: string): string[][] {
  text = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"' && !fieldStarted) {
        inQuotes = true;
        fieldStarted = true;
      } else if (c === delimiter) {
        row.push(field);
        field = "";
        fieldStarted = false;
      } else if (c === "\r") {
        // ignored
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        fieldStarted = false;
      } else {
        field += c;
        fieldStarted = true;
      }
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

function aliasIndexFor(header: string): string | null {
  const n = normalize(header);
  for (const [field, aliases] of Object.entries(ALIASES)) {
    if (aliases.some((a) => normalize(a) === n)) return field;
  }
  return null;
}

function slugify(s: string): string {
  const base =
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64) || "row";
  return base;
}

function defaultHours(): AtlasAsset["hours"] {
  const wk = { open: "10:00", close: "17:00" };
  const wkend = { open: "—", close: "—" };
  return {
    mon: wk,
    tue: wk,
    wed: wk,
    thu: wk,
    fri: wk,
    sat: wkend,
    sun: wkend,
  };
}

/** A weekly schedule with every day marked closed ("—"/"—"). Used when
 *  the description says something like "By appointment" or "Call for
 *  hours" — the row is searchable but never matches the "Open Now"
 *  filter. The original JSON shape is preserved for downstream parse
 *  helpers (`todayHoursLine`, `isOpenAt`). */
function dailySchedule(
  open: string,
  close: string,
): AtlasAsset["hours"] {
  const day = { open, close };
  return {
    mon: { ...day },
    tue: { ...day },
    wed: { ...day },
    thu: { ...day },
    fri: { ...day },
    sat: { ...day },
    sun: { ...day },
  };
}

type DayKey = keyof AtlasAsset["hours"];

// ----------------------------------------------------------------------------
//  Hours-of-operation extraction from the description column.
//
//  Two-tier pipeline:
//
//    1. Regex fast path (this function) — handles the most common
//       spreadsheet conventions: "Mon-Fri 9am-5pm", "Tuesday 11-1",
//       "Mon, Wed, Fri 10-2", "Weekdays 8am-8pm / Weekends 10-6",
//       "24/7", "Daily 8am-8pm", "8:30 AM – 5:00 PM", etc. When the
//       description is unambiguous the regex returns a full weekly
//       schedule so the upstream parser never has to pay an AI call.
//
//    2. OpenRouter fallback (`extractHours` Convex action) — kicks in
//       when this regex returns null. Returns the same shape so the
//       caller doesn't branch.
//
//  Output guarantees:
//    * Returns a valid AtlasAsset["hours"] object when ANY day-level
//      information can be extracted (regex confidence or AI returned
//      ok=true). Days with no information default to "—" (closed).
//    * Returns null when the regex can't confidently parse AND the
//      caller will route to AI — clean signal for "needs OpenRouter".
//    * NEVER throws. Bad inputs default to the closed-everywhere shape
//      rather than throwing, so a row with a malformed description
//      still plots the marker and the user-visible "Open Now" toggle
//      stays truthful.
//
//  Cost: this is pure string scanning, no AI, no network — runs in
//  microseconds per row.
// ----------------------------------------------------------------------------

/** Day tokens ordered to match the canonical `mon..sun` shape. Each matches
 *  the abbreviated ("Mon") and full ("Monday") forms, word-boundary safe. */
const DAY_TOKENS: Array<{
  key: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  full: string;
  abbrev: string;
}> = [
  { key: "mon", full: "monday", abbrev: "mon" },
  { key: "tue", full: "tuesday", abbrev: "tue" },
  { key: "wed", full: "wednesday", abbrev: "wed" },
  { key: "thu", full: "thursday", abbrev: "thu" },
  { key: "fri", full: "friday", abbrev: "fri" },
  { key: "sat", full: "saturday", abbrev: "sat" },
  { key: "sun", full: "sunday", abbrev: "sun" },
];

/** Token matcher for one day — used to read user-written days back out of
 *  a parsed description. Order = full word first so `Monday-Fri` is
 *  always lex-match, not just the 3-letter abbrev. */
const DAY_MATCH_RE =
  /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b|\b(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/i;

/** Convert a day token (full or abbrev, any case) to the canonical key.
 *  Returns null if no match. */
function dayKeyFromToken(tok: string): DayKey | null {
  const norm = tok.toLowerCase().replace(/[.,]/g, "");
  for (const d of DAY_TOKENS) {
    if (norm === d.full || norm === d.abbrev) return d.key;
  }
  if (norm === "tues") return "tue";
  if (norm === "thur" || norm === "thurs") return "thu";
  return null;
}

/** Parse a single time string into a canonical "HH:MM" 24-hour value.
 *  Recognizes: `9`, `9:30`, `9 am`, `9:30 PM`, `21:00`, `9pm`, `9.30am`.
 *  Returns null on unparseable input. */
function parseTimeToken(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim().replace(/[.,]/g, ":");
  // 12-hour with am/pm: "9", "9:30", "9 am", "9:30pm"
  const ampm = s.match(
    /^(\d{1,2})(?::(\d{1,2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*$/i,
  );
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = ampm[2] ? parseInt(ampm[2], 10) : 0;
    const suf = (ampm[3] ?? "").toLowerCase().replace(/\./g, "");
    if (Number.isNaN(h) || h < 0 || h > 24) return null;
    if (m < 0 || m > 59) return null;
    if (suf === "pm" && h < 12) h += 12;
    if (suf === "am" && h === 12) h = 0;
    if (h < 0 || h > 23) return null;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  return null;
}

/** Match a time range inside a free-form segment. Tries the longest
 *  patterns first so we capture "11:00 AM – 1:00 PM" before falling back
 *  to bare numbers. Returns {open, close} as "HH:MM" 24h, or null. */
function parseTimeRange(seg: string): { open: string; close: string } | null {
  // Strip en/em dashes / hyphens to a canonical "–" so the regex stays
  // a single readable character class.
  const norm = seg.replace(/[—–]/g, "-").replace(/\s*-\s*/g, "-");
  // Pairs of clock times separated by a hyphen or "to". Captures four
  // groups: open-h, open-m, suf, close-h, close-m, csuf.
  const ranged = norm.match(
    /(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)?\s*(?:-|to)\s*(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)?/i,
  );
  if (!ranged) return null;
  const rebuild = (h: string, m: string | undefined, suf: string | undefined) =>
    parseTimeToken(`${h}${m ? `:${m}` : ""}${suf ?? ""}`);
  const open = rebuild(ranged[1], ranged[2], ranged[3]);
  const close = rebuild(ranged[4], ranged[5], ranged[6]);
  if (!open || !close) return null;
  return { open, close };
}

/** Pull a comma/semicolon/newline/slash-delimited chunk out of the
 *  description that's likely to contain a single day/time statement.
 *  Splits on `;`, `\n`, and `/` first (the loud delimiters), then on
 *  `,` only when no adjacent day/time tokens are on the same side. */
function splitDayTimeSegments(text: string): string[] {
  // Split on the loud delimiters first.
  const loud = text.split(/[\n;]| ?\/ ?/g);
  return loud
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Translate a `Mon`, `Mon-Fri`, `Mon, Wed, Fri`, `Weekdays`, `Weekends`,
 *  `Daily`, `24/7`, `Mon-Sun`, etc. into a set of day keys. */
function expandDayToken(seq: string): Set<DayKey> | null {
  const norm = seq.toLowerCase().replace(/\s+/g, " ").trim();
  if (!norm) return null;

  // Whole-day keywords: these short-circuit to a known set.
  if (/^(24\s*\/\s*7|24\s*hours?|open\s*24|every\s*day|daily|7\s*days\s*a\s*week)$/i
    .test(norm)) {
    return new Set<DayKey>(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
  }
  if (/^weekdays?$/i.test(norm)) {
    return new Set<DayKey>(["mon", "tue", "wed", "thu", "fri"]);
  }
  if (/^weekends?$/i.test(norm)) {
    return new Set<DayKey>(["sat", "sun"]);
  }

  // Range like "Mon-Fri" / "Mon to Fri" / "Mon – Fri" / "Monday-Friday".
  // Specifically split on `-` / `to` / `–` / `—`, but ONLY when the
  // tokenization yields two valid day tokens — otherwise this is a
  // midnight-crossing time range like "9pm-2am" and we return null.
  const rangeParts = norm.split(/\s*(?:-|–|—|to)\s*/i);
  if (rangeParts.length === 2) {
    const start = dayKeyFromToken(rangeParts[0]);
    const end = dayKeyFromToken(rangeParts[1]);
    if (start && end) {
      const order: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
      const startIdx = order.indexOf(start);
      const endIdx = order.indexOf(end);
      if (startIdx >= 0 && endIdx >= 0) {
        const out = new Set<DayKey>();
        if (startIdx <= endIdx) {
          for (let i = startIdx; i <= endIdx; i++) out.add(order[i]);
        } else {
          // Wrap-around (e.g. "Fri-Mon" → Fri, Sat, Sun, Mon).
          for (let i = startIdx; i < order.length + endIdx; i++) {
            out.add(order[i % order.length]);
          }
        }
        return out;
      }
    }
  }

  // Comma-list: "Mon, Wed, Fri".
  if (norm.includes(",")) {
    const out = new Set<DayKey>();
    for (const part of norm.split(",")) {
      const k = dayKeyFromToken(part.trim());
      if (k) out.add(k);
    }
    return out.size ? out : null;
  }

  // Single-day token.
  const single = dayKeyFromToken(norm);
  if (single) return new Set<DayKey>([single]);

  return null;
}

/** Hours-of-operation fast path. Returns a complete weekly schedule when
 *  the description's hours section can be extracted by regex. Returns
 *  `null` when the regex isn't confident — the caller should route to
 *  the OpenRouter `extractHours` action for ambiguous descriptions.
 *
 *  Keys the AI fallback on these cases:
 *    - Vague ("By appointment", "Call for hours", "TBD", "varies")
 *    - Empty
 *    - Has hours mentions but no per-day structure the regex can lock onto
 *    - Time-only with no day info ("Open 9-5")
 *
 *  Returns a closed-everywhere shape (`"—"` both open and close) when:
 *    - "By appointment" / "call for hours" / "varies" / "TBD"
 *      (so the "Open Now" toggle stays false for these rows).
 */
export function parseHoursFromDescription(
  description: string | null | undefined,
): AtlasAsset["hours"] | null {
  if (!description) return null;
  const text = description.trim();
  if (!text) return null;

  // Phrases that mean "not regularly scheduled" — fill all 7 days as
  // closed so the Open Now toggle excludes them.
  const lower = text.toLowerCase();
  if (
    /\b(by\s*appointment|call\s*for\s*hours|by\s*req|by\s*request|tbd|to\s*be\s*determined|varies|tba|tba\.|n\/a|not\s*listed)\b/
      .test(lower)
  ) {
    return dailySchedule("—", "—");
  }

  // Identify the segment(s) of the description that contain hours info.
  // We bias toward sentences / phrases that mention time words so we don't
  // mistakenly parse a narrative that mentions "Saturday" without an
  // attached schedule.
  const timeWordRe = /(am|pm|24\s*\/\s*7|24\s*hours|midnight|noon)/i;
  const hourHeaderRe = /\bhours?\b|operating\s*hours?|schedule/i;
  const segments = splitDayTimeSegments(text);
  let working = new Map<DayKey, { open: string; close: string }>();

  let foundAnyTime = false;

  for (const segRaw of segments) {
    const seg = segRaw.trim();
    if (!seg) continue;
    const segLower = seg.toLowerCase();

    // Skip segments that don't even mention a time and aren't a known
    // whole-week keyword — this is the "narrative" branch that should
    // go to the AI fallback rather than be mis-parsed.
    const isKeyword =
      /^(24\s*\/\s*7|24\s*hours?|every\s*day|daily|weekdays?|weekends?)$/i.test(seg);
    if (!timeWordRe.test(seg) && !isKeyword && !hourHeaderRe.test(seg)) continue;

    // 24/7 / "Open 24 hours" — every day, 00:00 – 23:59 (we use 00:00 –
    // 24:00 shorthand so the chip renders "Open 24 hours"). parseClock
    // doesn't support 24:00 so we keep this strictly under 23:59 by
    // returning an "all day" sentinel the todayHoursLine helper already
    // handles via fmtClock.
    if (/^(24\s*\/\s*7|24\s*hours?|open\s*24)\b/i.test(seg)) {
      return dailySchedule("00:00", "23:59");
    }

    // Whole-week keyword with optional attached time:
    //   "Weekdays 8am-8pm"  →  mon–fri 08:00–20:00
    //   "Daily 9-5"         →  all 7 09:00–17:00
    if (/^weekdays?\b/i.test(seg)) {
      const after = seg.replace(/^weekdays?\s*/i, "").trim();
      if (after) {
        const range = parseTimeRange(after);
        if (range) {
          ["mon", "tue", "wed", "thu", "fri"].forEach((d) =>
            working.set(d as DayKey, range)
          );
          foundAnyTime = true;
          continue;
        }
      }
    }
    if (/^weekends?\b/i.test(seg)) {
      const after = seg.replace(/^weekends?\s*/i, "").trim();
      if (after) {
        const range = parseTimeRange(after);
        if (range) {
          ["sat", "sun"].forEach((d) =>
            working.set(d as DayKey, range)
          );
          foundAnyTime = true;
          continue;
        }
      }
    }
    if (/^(every\s*day|daily)\b/i.test(seg)) {
      const after = seg.replace(/^(every\s*day|daily)\s*/i, "").trim();
      if (after) {
        const range = parseTimeRange(after);
        if (range) {
          ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].forEach((d) =>
            working.set(d as DayKey, range)
          );
          foundAnyTime = true;
          continue;
        }
      }
    }

    // Strip an optional "Hours:" / "Operating hours:" header.
    const cleaned = seg.replace(/^hours?:?\s*|^operating\s*hours?:?\s*/i, "");

    // Try to peel a leading day-token list off the segment. Forms we handle:
    //   "Mon-Fri 9-5"
    //   "Mon, Wed, Fri 10-2"
    //   "Mon-Sun 8-8"
    //   "Mon-Fri: 9 AM – 5 PM"
    let daySet: Set<DayKey> | null = null;
    let trailing = cleaned;

    // Patterns like "Mon-Fri" / "Mon to Fri" / "Mon-Fri:".
    const rangeMatch = cleaned.match(
      /^([A-Za-z]{3,9}(?:\s*(?:-|–|—|to)\s*[A-Za-z]{3,9})?)(?:\s*[:,]\s*|\s+|$)(.*)$/i,
    );
    const listMatch = cleaned.match(
      /^([A-Za-z]{3,9}(?:\s*,\s*[A-Za-z]{3,9})+)(?:\s*[:,]\s*|\s+|$)(.*)$/i,
    );
    if (rangeMatch && /-|–|—|to/i.test(rangeMatch[1])) {
      daySet = expandDayToken(rangeMatch[1]);
      if (daySet) trailing = rangeMatch[2];
    } else if (listMatch) {
      daySet = expandDayToken(listMatch[1]);
      if (daySet) trailing = listMatch[2];
    } else {
      // Maybe the whole segment is just a single day token.
      const singleAttempt = expandDayToken(cleaned.split(/\s+/)[0] ?? "");
      if (singleAttempt && singleAttempt.size === 1) {
        daySet = singleAttempt;
        trailing = cleaned.replace(/^[A-Za-z]{3,9}\s*/i, "");
      }
    }

    // Try to find a time range anywhere in the trailing fragment.
    const range = parseTimeRange(trailing);
    if (!range) continue;

    // If we have a day list, apply. If not but the trailing segment is
    // just a number-range like "9-5" with no day, apply to all 7 days
    // (`daily` surmise) — common in spotty sheets like
    // "8am-6pm daily". Otherwise, defer to the AI fallback.
    if (daySet && daySet.size > 0) {
      daySet.forEach((d) => working.set(d, range));
      foundAnyTime = true;
      continue;
    }

    // Bare time with no day info — apply to weekdays as a default
    // (matches the behavior of the defaultHours() helper, so we don't
    // silently drop information).
    ["mon", "tue", "wed", "thu", "fri"].forEach((d) =>
      working.set(d as DayKey, range)
    );
    foundAnyTime = true;
  }

  if (!foundAnyTime) return null;

  // Fill in the days the regex couldn't determine with "—" so the
  // schedule is complete and parseClock doesn't choke.
  const closed = { open: "—", close: "—" };
  const final: AtlasAsset["hours"] = {
    mon: working.get("mon") ?? { ...closed },
    tue: working.get("tue") ?? { ...closed },
    wed: working.get("wed") ?? { ...closed },
    thu: working.get("thu") ?? { ...closed },
    fri: working.get("fri") ?? { ...closed },
    sat: working.get("sat") ?? { ...closed },
    sun: working.get("sun") ?? { ...closed },
  };
  return final;
}

/** True when `hours` matches the `defaultHours()` shape (10:00–17:00
 *  Monday–Friday, closed weekends). Used at runtime to tell whether
 *  `parseHoursFromDescription` succeeded at parse time (in which case
 *  we DON'T need to ask the AI) or fell through to the default (in
 *  which case the per-row loop should route to the OpenRouter
 *  `extractHours` action for ambiguous descriptions). */
export function isDefaultHours(hours: AtlasAsset["hours"]): boolean {
  return (
    hours.mon.open === "10:00" && hours.mon.close === "17:00" &&
    hours.tue.open === "10:00" && hours.tue.close === "17:00" &&
    hours.wed.open === "10:00" && hours.wed.close === "17:00" &&
    hours.thu.open === "10:00" && hours.thu.close === "17:00" &&
    hours.fri.open === "10:00" && hours.fri.close === "17:00" &&
    hours.sat.open === "—" && hours.sat.close === "—" &&
    hours.sun.open === "—" && hours.sun.close === "—"
  );
}

function splitFeatures(s: string): string[] {
  return s
    .split(/[,;|]/)
    .map((t) => t.trim().toLowerCase().replace(/\s+/g, "-"))
    .filter(Boolean);
}

/**
 * Build an AddressFragment from the *explicit* column fields when present,
 * falling back to a freeform parse of the address column when the
 * address looks like a combined string (contains commas) AND the
 * other fields are empty.
 */
function makeAddressFragment(get: (f: string) => string): AddressFragment {
  const explicitStreet = get("address") || get("street") || "";
  const explicitCity = get("city");
  const explicitState = get("state");
  const explicitZip = get("postalCode");
  const explicitCountry = get("country") || "USA";

  // If the address column looks like a full combined address and the
  // explicit city/state/zip are missing, parse it as freeform.
  if (explicitStreet && /,/.test(explicitStreet) && !explicitCity) {
    const parsed = parseFreeformAddress(explicitStreet);
    return {
      street: stripUnit(parsed.street) || explicitStreet,
      city: parsed.city || explicitCity,
      state: parsed.state || explicitState,
      postalcode: parsed.postalcode || explicitZip,
      country: explicitCountry || "USA",
    };
  }

  // If the address has commas AND we have a separate city, just strip the unit
  // from the street portion while keeping the city/state/zip.
  const street = stripUnit(explicitStreet);

  return {
    street,
    city: explicitCity,
    state: explicitState,
    postalcode: explicitZip,
    country: explicitCountry || "USA",
  };
}

export function importCsv(
  text: string,
  filename = "uploaded.csv",
): ImportSummary {
  const delimiter = detectDelimiter(text);
  const grid = parseDelimited(text, delimiter);
  if (grid.length < 2) {
    return {
      rows: [],
      pending: [],
      chatOnly: [],
      totalParsed: 0,
      rejected: 0,
      filename,
    };
  }

  const headers = grid[0];
  const fieldIdx: Record<string, number> = {};
  const headerRow = grid.find(
    (row, idx) =>
      idx > 0 &&
      row.filter((c) => c && c.trim() !== "").length >= 2 &&
      row.some((c) => aliasIndexFor(c) !== null),
  );
  const effectiveHeaders = headerRow ?? headers;
  const headerOffset = headerRow ? grid.indexOf(headerRow) + 1 : 1;
  effectiveHeaders.forEach((h, i) => {
    const f = aliasIndexFor(h);
    if (f && !(f in fieldIdx)) fieldIdx[f] = i;
  });

  if (fieldIdx["name"] === undefined) {
    fieldIdx["name"] = 0;
  }

  const dataRows = grid.slice(headerOffset);
  const out: ImportedRow[] = [];
  const pending: ImportedRow[] = [];
  const chatOnly: ImportedRow[] = [];
  let rejected = 0;

  const slice = dataRows.slice(0, MAX_ROWS);

  for (let i = 0; i < slice.length; i++) {
    const r = slice[i];
    const get = (f: string) =>
      fieldIdx[f] !== undefined ? (r[fieldIdx[f]] ?? "").trim() : "";

    const name = get("name");
    if (!name) {
      rejected++;
      continue;
    }

    const explicitSlug = get("slug");
    const slug = explicitSlug || `${slugify(name)}-${i}`;

    const risks = (v: any, min: number, max: number, fallback: number) => {
      const n = typeof v === "number" ? v : parseFloat(v);
      return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
    };

    const rating = risks(get("rating"), 0, 5, 4.0);
    const reviewCount = risks(get("reviewCount"), 0, 1_000_000, 0);
    // Price/Affordability cells commonly contain text ("Free",
    // "Sliding-scale", "$5 per visit") rather than a numeric tier. Try
    // the numeric path first; fall back to the text parser so the column
    // is never silently dropped.
    const rawPrice = get("priceTier");
    const numericPrice =
      typeof rawPrice === "number"
        ? rawPrice
        : rawPrice && /^-?\d+(?:\.\d+)?$/.test(rawPrice)
          ? parseFloat(rawPrice)
          : NaN;
    const priceTier = Number.isFinite(numericPrice)
      ? Math.max(0, Math.min(2, numericPrice))
      : parsePriceTierText(rawPrice, 0);
    const openedYear = risks(get("openedYear"), 1700, 2100, new Date().getFullYear());

    const warnings: string[] = [];
    const features = splitFeatures(get("features"));

    const latParsed = parseFloat(get("lat"));
    const lngParsed = parseFloat(get("lng"));
    const hasCoords =
      Number.isFinite(latParsed) && Number.isFinite(lngParsed);

    const addr = makeAddressFragment(get);
    // Normalize address components for downstream consumers (geocode
    // cascade, chat search, atlas pin). State gets USPS-abbreviated,
    // city/postal code have trailing punctuation stripped, and any
    // leading highway prefix is removed (Nominatim returns cleaner hits
    // when fed "Peachtree St NE" instead of "I-75 Exit 241: Peachtree").
    const cleanStreet = stripHighwayPrefix(
      stripUnit(addr.street).trim(),
    );
    const normAddr: AddressFragment = {
      street: cleanStreet,
      city: cleanCity(addr.city) || "Atlanta",
      state: cleanState(addr.state) || "GA",
      postalcode: cleanPostalCode(addr.postalcode),
      country: addr.country || "USA",
    };
    const doc: AtlasAsset = {
      _id: `imported:${slug}`,
      _creationTime: Date.now(),
      slug,
      name,
      tagline: get("tagline") || name,
      category: get("category") || "library",
      rating,
      reviewCount,
      priceTier,
      description: get("description"),
      address: normAddr.street,
      city: normAddr.city || "Atlanta",
      state: normAddr.state || "GA",
      country: normAddr.country || "USA",
      postalCode: normAddr.postalcode,
      lat: hasCoords ? latParsed : NaN,
      lng: hasCoords ? lngParsed : NaN,
      // Mine the description column for hours of operation at parse
      // time. Falls back to a sensible weekday default when the
      // description is empty / doesn't mention hours — the per-row
      // loop in `ImportedDataProvider` will then route to the
      // OpenRouter `extractHours` action if the description is
      // ambiguous but non-empty.
      hours: parseHoursFromDescription(get("description")) ||
        defaultHours(),
      features,
      openedYear,
      signatureDrink: get("signatureDrink") || "—",
      ownerName: get("ownerName") || undefined,
      imageUrl: get("imageUrl") || undefined,
      accentColor: get("accentColor") || undefined,
      website: get("website") || undefined,
      socialMedia: get("socialMedia") || undefined,
      contactName: get("contactName") || undefined,
      contactPhone: get("contactPhone") || undefined,
      contactEmail: get("contactEmail") || undefined,
    };

    const row: ImportedRow = { doc, warnings };

    if (hasCoords) {
      out.push(row);
      continue;
    }

    // PO Box: skip the geocode cascade entirely. Still searchable in chat.
    if (isPoBoxOnly(normAddr.street)) {
      warnings.push("PO Box address \u2014 no map pin");
      doc.coordAccuracy = undefined;
      chatOnly.push(row);
      continue;
    }

    // No street and no postal code → also can't geocode.
    if (!normAddr.street && !normAddr.postalcode) {
      warnings.push("no street or postal code for geocoding");
      doc.needsGeocode = false;
      doc.coordAccuracy = undefined;
      chatOnly.push(row);
      continue;
    }

    warnings.push("awaiting geocoding");
    doc.needsGeocode = true;
    doc.geoKey = geoKeyFor(normAddr);
    pending.push(row);
  }

  return {
    rows: out,
    pending,
    chatOnly,
    totalParsed: dataRows.length,
    rejected,
    filename,
  };
}

// ----- Affordability text -> numeric priceTier -----------------------------

/**
 * Map a textual "Price/Affordability" cell to a numeric priceTier (0..2).
 * Recognizes "Free", "Sliding-scale", "Donation", "$5 per visit", etc.
 */
export function parsePriceTierText(
  s: string | null | undefined,
  fallback = 0,
): number {
  if (!s) return fallback;
  const t = s.trim().toLowerCase();
  if (!t) return fallback;
  if (/\bfree\b|no cost|no fee|\bgrat(is|uit)\b/.test(t)) return 0;
  if (/\bslid(e|ing)\b|sliding[- ]scale|low cost|donation|\bscholar/.test(t)) {
    return 1;
  }
  if (
    /\bpaid\b|\bfee\b|\bmembership\b|\bticket\b|\bsubscription\b|\brequired\b/.test(
      t,
    )
  ) {
    const dollar = t.match(/\$(\d+(?:\.\d+)?)/g);
    if (dollar && dollar.every((m) => /^[$]0(\.0+)?$/.test(m))) return 0;
    return 2;
  }
  const amt = t.match(/\$(\d+(?:\.\d+)?)/);
  if (amt) {
    const v = parseFloat(amt[1]);
    if (v <= 0) return 0;
    if (v <= 15) return 1;
    return 2;
  }
  return fallback;
}

// ----- City / State / Zip normalization -----------------------------------

/** USPS state abbreviation spelled out, including common misspellings. */
const STATE_NAME_TO_ABBREV: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  // Common HUD-sheet typos that show up in Atlanta datasets.
  georiga: "GA",
  goriga: "GA",
  georgie: "GA",
  pensylvania: "PA",
  califronia: "CA",
  califoria: "CA",
  flordia: "FL",
};

/** Trim a city cell, dropping trailing punctuation Excel often emits. */
export function cleanCity(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .trim()
    .replace(/\s*[,.;:]\s*$/g, "")
    .replace(/\s{2,}/g, " ");
}

/** Normalize a state cell to USPS 2-letter abbrev ("Georgia" -> "GA"). */
export function cleanState(s: string | null | undefined): string {
  if (!s) return "";
  let t = s.trim().replace(/\s*[,.;:]\s*$/g, "").replace(/\s{2,}/g, " ");
  if (!t) return "";
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return STATE_NAME_TO_ABBREV[t.toLowerCase()] ?? t.slice(0, 2).toUpperCase();
}

/** Trim a zip to 5-digit form with optional -4. */
export function cleanPostalCode(s: string | null | undefined): string {
  if (!s) return "";
  const t = s.trim();
  const m = t.match(/(\d{5})(?:[- ]?(\d{4}))?/);
  if (!m) return t;
  return m[2] ? `${m[1]}-${m[2]}` : m[1];
}

/**
 * Strip leading highway/Interstate prefixes so Nominatim gets the
 * canonical street name. Common in HUD sheets with cross-street rows.
 */
export function stripHighwayPrefix(street: string): string {
  return street
    .replace(
      /^\s*(?:i[-\s]?\d+|interstate\s+\d+|us\s+\d+|u\.?s\.?\s+\d+|state\s+(?:route|road|hwy|hwy\.?)|sr\s+\d+|ga\s+\d+|highway\s+\d+|hwy\.?\s+\d+)\b\.?\s*/i,
      "",
    )
    .trim();
}
