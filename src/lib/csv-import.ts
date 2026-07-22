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
 * distinguish rows that came from a structured address match vs a zip
 * centroid vs a multi-tier fallback.
 */
export type CoordAccuracy = "exact" | "relaxed" | "zip-centroid";

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

  priceTier: ["price_tier", "price", "cost", "cost_tier", "fee"],

  description: [
    "description",
    "desc",
    "about",
    "notes",
    "notes_observations",
    "notes_&_observations",
    "details",
    "summary_long",
    "service_resources_available",
    "service_resources",
    "service_resources_description",
    "resources_available",
    "resources",
    "activity",
    "activities",
    "issue_and_needs",
    "issue_needs",
    "issue_needs_addressed",
    "issue_needs_summary",
    "issue",
    "needs",
    "need",
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

// Static Atlanta ZIP centroids — short-circuits the geocode cascade for
// SW Atlanta HUD addresses, no network roundtrip required.
export const ATLANTA_ZIP_CENTROIDS: Record<string, { lat: number; lng: number }> = {
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
    const priceTier = risks(get("priceTier"), 0, 2, 0);
    const openedYear = risks(get("openedYear"), 1700, 2100, new Date().getFullYear());

    const warnings: string[] = [];
    const features = splitFeatures(get("features"));

    const latParsed = parseFloat(get("lat"));
    const lngParsed = parseFloat(get("lng"));
    const hasCoords =
      Number.isFinite(latParsed) && Number.isFinite(lngParsed);

    const addr = makeAddressFragment(get);
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
      address: addr.street,
      city: addr.city || "Atlanta",
      state: addr.state || "GA",
      country: addr.country || "USA",
      postalCode: addr.postalcode,
      lat: hasCoords ? latParsed : NaN,
      lng: hasCoords ? lngParsed : NaN,
      hours: defaultHours(),
      features,
      openedYear,
      signatureDrink: get("signatureDrink") || "—",
      ownerName: get("ownerName") || undefined,
      imageUrl: get("imageUrl") || undefined,
      accentColor: get("accentColor") || undefined,
    };

    const row: ImportedRow = { doc, warnings };

    if (hasCoords) {
      out.push(row);
      continue;
    }

    // PO Box: skip the geocode cascade entirely. Still searchable in chat.
    if (isPoBoxOnly(addr.street)) {
      warnings.push("PO Box address \u2014 no map pin");
      doc.coordAccuracy = undefined;
      chatOnly.push(row);
      continue;
    }

    // No street and no postal code → also can't geocode.
    if (!addr.street && !addr.postalcode) {
      warnings.push("no street or postal code for geocoding");
      doc.needsGeocode = false;
      doc.coordAccuracy = undefined;
      chatOnly.push(row);
      continue;
    }

    warnings.push("awaiting geocoding");
    doc.needsGeocode = true;
    doc.geoKey = geoKeyFor(addr);
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
