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
 * distinguish rows that came from a structured address match vs a zip
 * centroid vs a multi-tier fallback. `cerebras-fixup` indicates the
 * address was first parsed/cleaned by the Cerebras AI normalizer
 * (the map side never uses Gemini — that's reserved for the chat
 * assistant), then re-geocoded through the same cascade.
 */
export type CoordAccuracy =
  | "exact"
  | "relaxed"
  | "zip-centroid"
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
  // Atlanta-metro ZCTA centroids. Hand-curated from public ZCTA data so the
  // geocoder can short-circuit to a known good coordinate for any HUD row
  // that ships only a ZIP with an Atlanta-metro postal code. The exact
  // spot within the zip still requires Nominatim for street-level accuracy;
  // these coords let the marker land in the right neighborhood without a
  // network roundtrip on Tier 4a.
  "30002": { lat: 33.7723, lng: -84.3877 },
  "30030": { lat: 33.7715, lng: -84.2988 },
  "30032": { lat: 33.7361, lng: -84.2890 },
  "30034": { lat: 33.6891, lng: -84.3299 },
  "30060": { lat: 33.9522, lng: -84.5444 },
  "30080": { lat: 33.8767, lng: -84.5047 },
  "30126": { lat: 33.8486, lng: -84.5547 },
  "30213": { lat: 33.6441, lng: -84.4486 },
  "30236": { lat: 33.6755, lng: -84.3967 },
  "30238": { lat: 33.4949, lng: -84.3874 },
  "30260": { lat: 33.5841, lng: -84.4733 },
  "30265": { lat: 33.3901, lng: -84.7033 },
  "30268": { lat: 33.5340, lng: -84.7324 },
  "30269": { lat: 33.3981, lng: -84.5723 },
  "30273": { lat: 33.6280, lng: -84.4690 },
  "30274": { lat: 33.5882, lng: -84.4734 },
  "30276": { lat: 33.2785, lng: -84.6137 },
  "30281": { lat: 33.5497, lng: -84.2071 },
  "30288": { lat: 33.5905, lng: -84.3590 },
  "30290": { lat: 33.4649, lng: -84.5875 },
  "30291": { lat: 33.6808, lng: -84.4825 },
  "30292": { lat: 33.4821, lng: -84.5461 },
  "30294": { lat: 33.6495, lng: -84.3980 },
  "30296": { lat: 33.5659, lng: -84.4479 },
  "30297": { lat: 33.5841, lng: -84.4681 },
  "30303": { lat: 33.7537, lng: -84.3863 },
  "30305": { lat: 33.8310, lng: -84.3830 },
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
  "30319": { lat: 33.8441, lng: -84.3358 },
  "30324": { lat: 33.8205, lng: -84.3585 },
  "30326": { lat: 33.8440, lng: -84.3611 },
  "30327": { lat: 33.8726, lng: -84.4228 },
  "30328": { lat: 33.9245, lng: -84.3786 },
  "30329": { lat: 33.8360, lng: -84.3214 },
  "30330": { lat: 33.7067, lng: -84.4343 },
  "30331": { lat: 33.6968, lng: -84.5326 },
  "30332": { lat: 33.7763, lng: -84.4014 },
  "30334": { lat: 33.7487, lng: -84.3878 },
  "30336": { lat: 33.7311, lng: -84.6533 },
  "30337": { lat: 33.6437, lng: -84.4611 },
  "30338": { lat: 33.9529, lng: -84.3176 },
  "30339": { lat: 33.9078, lng: -84.4225 },
  "30340": { lat: 33.8994, lng: -84.2864 },
  "30341": { lat: 33.9048, lng: -84.2992 },
  "30342": { lat: 33.8810, lng: -84.3751 },
  "30344": { lat: 33.6761, lng: -84.4577 },
  "30345": { lat: 33.8521, lng: -84.2849 },
  "30346": { lat: 33.9135, lng: -84.3406 },
  "30349": { lat: 33.6223, lng: -84.4942 },
  "30350": { lat: 33.9874, lng: -84.3366 },
  "30354": { lat: 33.6654, lng: -84.3788 },
  "30360": { lat: 33.9272, lng: -84.2808 },
  "30363": { lat: 33.7900, lng: -84.3990 },
  "31106": { lat: 33.7920, lng: -84.3306 },
  "31107": { lat: 33.7720, lng: -84.3622 },
  "31119": { lat: 33.7447, lng: -84.3944 },
  "31126": { lat: 33.7941, lng: -84.3638 },
  "31131": { lat: 33.7537, lng: -84.3863 },
  "31136": { lat: 33.7910, lng: -84.4089 },
  "31139": { lat: 33.8573, lng: -84.4527 },
  "31141": { lat: 33.8762, lng: -84.2893 },
  "31144": { lat: 34.0067, lng: -84.2968 },
  "31145": { lat: 33.8521, lng: -84.3378 },
  "31146": { lat: 33.9240, lng: -84.3370 },
  "31150": { lat: 33.9854, lng: -84.3396 },
  "31156": { lat: 33.8704, lng: -84.3122 },
  "31192": { lat: 33.7698, lng: -84.3546 },
  "31193": { lat: 33.7819, lng: -84.3886 },
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
      hours: defaultHours(),
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
