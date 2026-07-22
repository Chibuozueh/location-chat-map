// Vanilla RFC4180-style CSV/TSV parser + smart column-alias mapping for the
// atlas spreadsheet. No third-party dependency. Cap at 1000 rows.
//
// In addition to producing ready-to-map rows (with valid lat/lng), the parser
// returns a separate `pending` list for rows that are otherwise valid but
// lack coordinates. These rows are still searchable in the chat; a separate
// geocode pass converts them to lat/lng afterwards.

const MAX_ROWS = 1000;

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
};

/** Address fragment passed verbatim to Nominatim. */
export type AddressFragment = {
  street: string;
  city: string;
  state: string;
  postalcode: string;
  country: string;
};

export type ImportedRow = {
  doc: AtlasAsset;
  warnings: string[];
};

export type ImportSummary = {
  rows: ImportedRow[]; // rows with valid lat/lng
  pending: ImportedRow[]; // rows missing lat/lng but otherwise valid
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
  // grant-program names, etc.
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
  ],

  tagline: ["tagline", "subtitle", "summary", "short", "short_description"],

  // Category — covers "Community Asset Type", "Asset Type", etc.
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

  // Numeric score
  rating: ["rating", "score", "stars", "community_score"],

  // Engagement / reach
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

  // Long-form notes — aliases cover HUD-grant colloquialisms.
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

  // Address — combined street address; alt: append county to address.
  address: [
    "address",
    "street",
    "location",
    "street_address",
    "street_address_full",
    "site_address",
    "facility_address",
    "physical_address",
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

  // Features — grant-style tags ("Nat'l Goal", HUD national goals)
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

/** Canonical key the client uses to dedupe geocode requests. */
export function geoKeyFor(addr: AddressFragment): string {
  return [
    addr.street.trim().toLowerCase(),
    addr.city.trim().toLowerCase(),
    addr.state.trim().toLowerCase(),
    addr.postalcode.trim().toLowerCase(),
  ]
    .filter(Boolean)
    .join("|");
}

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

function makeAddressFragment(get: (f: string) => string): AddressFragment {
  return {
    street: get("address") || get("street") || "",
    city: get("city") || "",
    state: get("state") || "",
    postalcode: get("postalCode") || "",
    country: get("country") || "USA",
  };
}

export function importCsv(
  text: string,
  filename = "uploaded.csv",
): ImportSummary {
  const delimiter = detectDelimiter(text);
  const grid = parseDelimited(text, delimiter);
  if (grid.length < 2) {
    return { rows: [], pending: [], totalParsed: 0, rejected: 0, filename };
  }

  const headers = grid[0];
  const fieldIdx: Record<string, number> = {};
  headers.forEach((h, i) => {
    const f = aliasIndexFor(h);
    if (f && !(f in fieldIdx)) fieldIdx[f] = i;
  });

  const dataRows = grid.slice(1);
  const out: ImportedRow[] = [];
  const pending: ImportedRow[] = [];
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
      if (!features.length) warnings.push("no features");
      out.push(row);
    } else {
      // Has name and address but no coords — slated for geocoding.
      if (!addr.street && !addr.postalcode) {
        warnings.push("no address or postal code for geocoding");
      } else {
        warnings.push("awaiting geocoding");
      }
      doc.address = addr.street;
      doc.needsGeocode = true;
      doc.geoKey = geoKeyFor(addr);
      pending.push(row);
    }
  }

  return {
    rows: out,
    pending,
    totalParsed: dataRows.length,
    rejected,
    filename,
  };
}
