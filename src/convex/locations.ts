import { v } from "convex/values";
import { query } from "./_generated/server";
import { searchRows } from "../lib/atlas-search";
import {
  type AtlasAsset,
  parsePriceTierText,
} from "../lib/csv-import";

// --- queries -----------------------------------------------------------------
//
// The atlas no longer persists its locations in Convex: the canonical
// sources are either the embedded SEED_LOCATIONS below (kept in code so
// the user can hand-edit the asset map) or a user-uploaded CSV (which
// is parsed client-side and lives only in React state). These queries
// therefore just return the translated seed list — the same shape the
// client-side CSV importer produces — so every renderer that consumes
// `LocationDoc[]` keeps working without any callsite changes.

const NEUTRAL_HOURS: AtlasAsset["hours"] = {
  mon: { open: "—", close: "—" },
  tue: { open: "—", close: "—" },
  wed: { open: "—", close: "—" },
  thu: { open: "—", close: "—" },
  fri: { open: "—", close: "—" },
  sat: { open: "—", close: "—" },
  sun: { open: "—", close: "—" },
};

/**
 * Translate one raw `SEED_LOCATIONS` row into the canonical `AtlasAsset`
 * shape the renderer expects. Mirrors the client-side
 * `seedLocationsToAtlasAssets` helper in `src/state/imported-data.tsx`
 * so both paths produce identical objects.
 */
function translateSeed(raw: any): AtlasAsset {
  const lat =
    typeof raw?.lat === "number" && Number.isFinite(raw.lat) ? raw.lat : NaN;
  const lng =
    typeof raw?.lng === "number" && Number.isFinite(raw.lng) ? raw.lng : NaN;
  const hasFiniteCoords = Number.isFinite(lat) && Number.isFinite(lng);
  const services = (raw?.servicesResourcesAvailable ?? "").toString().trim();
  const notes = (raw?.notesObservations ?? "").toString().trim();
  const description = [services, notes].filter(Boolean).join("\n\n");
  const slug = raw?.slug ?? "";
  return {
    _id: `seeded:${slug}`,
    _creationTime: 0,
    slug,
    name: raw?.assetNameOrOrganization ?? "",
    tagline: raw?.communityAssetType ?? "",
    category: (raw?.communityAssetType ?? "community-center")
      .toString()
      .toLowerCase(),
    rating: 0,
    reviewCount: 0,
    priceTier: parsePriceTierText(raw?.priceAffordability ?? "", 0),
    description,
    address: raw?.address ?? "",
    city: raw?.city ?? "Atlanta",
    state: raw?.state ?? "GA",
    country: "USA",
    postalCode: raw?.zipCode ?? "",
    lat,
    lng,
    hours: NEUTRAL_HOURS,
    features: [],
    openedYear: new Date().getFullYear(),
    signatureDrink: "—",
    website: raw?.website || undefined,
    socialMedia: raw?.socialMedia || undefined,
    contactName: raw?.keyContact || undefined,
    contactPhone: raw?.contactPhone || undefined,
    contactEmail: raw?.contactEmail || undefined,
    // Flag missing-coord rows so the client can route them through the
    // Cerebras -> Nominatim backfill on first paint (see `seedBackfill`
    // in src/state/imported-data.tsx). Rows that already carry
    // hand-coded coords skip the cascade entirely.
    needsGeocode: !hasFiniteCoords,
    coordAccuracy: hasFiniteCoords
      ? raw?.coordAccuracy ?? "exact"
      : undefined,
  };
}

export const list = query({
  args: {},
  handler: async () => SEED_ASSETS,
});

export const get = query({
  args: { slug: v.string() },
  handler: async (_ctx, { slug }) =>
    SEED_ASSETS.find((l) => l.slug === slug) ?? null,
});

export const search = query({
  args: { question: v.string() },
  handler: async (_ctx, { question }) =>
    searchRows(SEED_ASSETS as any, question),
});

export const topPicks = query({
  args: {},
  handler: async () => {
    const all = SEED_ASSETS;
    return {
      featured: all[0] ?? null,
      cities: Array.from(new Set(all.map((l) => l.city))),
      counts: {
        total: all.length,
        openNow: all.filter((l) => (l as any)._open).length,
      },
    };
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
    slug: "walk-with-a-doc-rodney-cook-sr-park-vine-city-chapter-wwad",
    assetNameOrOrganization:
      "Walk with a Doc @ Rodney Cook Sr. Park (Vine City Chapter WWAD)",
    communityAssetType: "Comm Based Classes & Programming",
    address: "Vine St. NW",
    city: "Atlanta",
    state: "GA",
    zipCode: "30314",
    website:
      "https://walkwithadoc.org/join-a-walk/locations/atlanta-georgia-cook-park/",
    socialMedia: "",
    keyContact: "Michael Davis",
    contactPhone: "",
    contactEmail: "",
    servicesResourcesAvailable: `Discover the joy of walking for health with Walk with a Doc! Join us every last Saturday of the month for an enriching experience where you’ll hear insights on a health topic from a healthcare professional, followed by a leisurely walk and engaging conversation. It’s an opportunity to step into a healthier lifestyle, at your own pace and distance. Come, walk, and thrive!

Walk Location:
Cook Park in Historic Vine City – Vine Street, Atlanta, GA 30314 (Meet at park pavilion near Ambassador Andrew Young statue)`,
    priceAffordability: "Free",
    notesObservations:
      "I do not have enough information to answer. Please provide a specific question or instruction regarding the selected class.",
  },

  {
    slug: "walk-with-a-doc-lee-white-westside-beltline-morehouse-chapter-wwad",
    assetNameOrOrganization:
      "Walk with a Doc @ Lee & White Westside Beltline (Morehouse Chapter WWAD)",
    communityAssetType: "Comm Based Classes & Programming",
    address: "1010 White St. SW",
    city: "Atlanta",
    state: "GA",
    zipCode: "30310",
    website:
      "https://walkwithadoc.org/join-a-walk/locations/atlanta-georgia-msm/",
    socialMedia: "IG: msm_lifestylemedicine",
    keyContact: "Jammie Hopkins",
    contactPhone: "310-993-7894",
    contactEmail: "jhopkins@msm.edu",
    servicesResourcesAvailable: `Discover the joy of walking for health with Walk with a Doc! Join us every first Saturday of the month at 9:00 am for an enriching experience where you’ll hear insights on a health topic from a healthcare professional, followed by a leisurely walk and engaging conversation. It’s an opportunity to step into a healthier lifestyle, at your own pace and distance. Come, walk, and thrive!

Walk Location: Atlanta Westside Beltline Trail at Lee & White.(meet at bench area near the coffee shop adjacent to the trail).`,
    priceAffordability: "Free",
    notesObservations: "",
  },

  {
    slug: "true-beginners-bike-classes-washington-park-recreation-center-propel-atl",
    assetNameOrOrganization:
      "True Beginners Bike Classes @ Washington Park Recreation Center (Propel ATL)",
    communityAssetType: "Comm Based Classes & Programming",
    address: "102 Ollie St. NW.",
    city: "Atlanta",
    state: "GA",
    zipCode: "30314",
    website: "https://www.letspropelatl.org/true_beginners",
    socialMedia: "",
    keyContact: "Sagirah Jones",
    contactPhone: "(678) 894-0830",
    contactEmail: "",
    servicesResourcesAvailable: `Come learn how to ride a bike! Our free True Beginners class is for adults who don’t know how to ride and want to gain confidence on two wheels.

This class will teach you to…Balance, Start and stop, Shift gears, Scan the environment while pedaling, And leave empowered and ready to ride for fun, fitness, and commuting! Location: Washington Park Recreation Center, 102 Ollie St. NW, Atlanta GA, 30314. A short walk from Ashby MARTA station.

Attendance at this or any class conducted by Propel ATL indicates your agreement to the following liability waiver: Propel ATL liability waiver.

Classes scheduled for Saturday 7/11/2026 @ 10:30 am; Thursday 7/23/2026 @ 4:45 pm; Saturday 7/25/2026 @ 10:30 am; 8/27/2026 @ 4:45 pm; Saturday 8/29/2026 @ 10:30 am`,
    priceAffordability: "Free",
    notesObservations: "",
  },

  {
    slug: "atl-beltline-rythm-roll",
    assetNameOrOrganization: "ATL Beltline - Rythm Roll",
    communityAssetType: "Comm Based Classes & Programming",
    address: `Westside Paper
950 West Marietta Street Northwest`,
    city: "Atlanta",
    state: "GA",
    zipCode: "",
    website: "https://beltline.org/events/6a173a6ac49ffaa4fff5d83b/",
    socialMedia: "",
    keyContact: "",
    contactPhone: "",
    contactEmail: "",
    servicesResourcesAvailable: `Burn calories and build confidence by grooving and stepping with skates. High energy, controlled, and repetitive movements set the stone for this workshop. Beginner friendly! Bring your own roller skates, water, and protective equipment.

Classes scheduled for Monday 6/1/2026 @ 5:30 pm; Wednesday 7/8/2026 @ 6:30 pm; Wednesday 7/22/2026 @ 6:30 pm; Wednesday 7/29/2026 @ 6:30 pm.`,
    priceAffordability: "free",
    notesObservations: "",
  },

  {
    slug: "atl-beltline-tennis-essentials-camp",
    assetNameOrOrganization: "ATL Beltline - Tennis Essentials Camp",
    communityAssetType: "Comm Based Classes & Programming",
    address: `Washington Park Tennis Ctr
1125 Lena Street Northwest`,
    city: "Atlanta",
    state: "GA",
    zipCode: "",
    website: "https://beltline.org/events/6a061369170f05754eaf130e/",
    socialMedia: "",
    keyContact: "",
    contactPhone: "",
    contactEmail: "",
    servicesResourcesAvailable: `This fun 2-day camp will work on learning and developing tennis fundamentals and technique. 70% of the camp is on court tennis instruction and games. Kids will learn how to score and improve in match play and tennis etiquette.
Every kid gets a camp tee shirt, award, and HEART card store visit.
Beginner and Intermediate Levels welcome. Ages 6-14 only.

Classes scheduled for Thursday 7/2/2026 @ 9:00 am; Wednesday 7/15/2026 @ 6:30 pm.`,
    priceAffordability: "free",
    notesObservations: "",
  },

  {
    slug: "atl-beltline-thursday-run-club",
    assetNameOrOrganization: "ATL Beltline - Thursday Run Club",
    communityAssetType: "Comm Based Classes & Programming",
    address: "various",
    city: "Atlanta",
    state: "GA",
    zipCode: "",
    website: "https://beltline.org/events/6a2835faa96df48173020b84/",
    socialMedia: "",
    keyContact: "",
    contactPhone: "",
    contactEmail: "",
    servicesResourcesAvailable: `People enjoy that the runs are free, open to anyone (all fitness levels) and no registration is required. Participants come for the 2- or 4-mile fun run/walk and stay to socialize with other runners and enjoy the post-run refreshments.

Classes scheduled for Thursday 7/2/2026 @ 5:15 pm; Thursday 7/9/2026 @ 6:15 pm; Thursday 7/16/2026 @ 6:15 pm; Thursday 7/23/2026 @ 6:15 pm; Thursday 7/30/2026 @ 6:15 pm.`,
    priceAffordability: "free",
    notesObservations: "",
  },

  {
    slug: "atl-beltline-fit-404-sweat-series",
    assetNameOrOrganization: "ATL Betline - Fit 404 Sweat Series",
    communityAssetType: "Comm Based Classes & Programming",
    address: `Piedmont Park- Front Lawn (Greenspace B)
1181 Piedmont Avenue Northeast`,
    city: "Atlanta",
    state: "GA",
    zipCode: "",
    website: "https://beltline.org/events/6a32ccc84d6e33233e20994a/",
    socialMedia: "",
    keyContact: "",
    contactPhone: "",
    contactEmail: "",
    servicesResourcesAvailable: `Fit 404 Summer Sweat Series is a fitness class designed to keep participants active, motivated, and moving all summer long.

Classes scheduled for Thursday 7/2/2026 @ 6:30 pm; Thursday 7/16/2026 @ 6:30 pm; Thursday 7/23/2026 @ 6:30 pm; Thursday 7/30/2026 @ 6:30 pm; Thursday 8/6/2026 @ 6:30 pm; Thursday 8/20/2026 @ 6:30 pm.`,
    priceAffordability: "free",
    notesObservations: "",
  },

  {
    slug: "atl-beltline-cardio-tennis",
    assetNameOrOrganization: "ATL Beltline - Cardio Tennis",
    communityAssetType: "Comm Based Classes & Programming",
    address: `Washington Park Tennis Ctr
1125 Lena Street Northwest`,
    city: "Atlanta",
    state: "GA",
    zipCode: "",
    website: "https://beltline.org/events/69fb909b9a801d629a63925b/",
    socialMedia: "",
    keyContact: "Coach Josh",
    contactPhone: "",
    contactEmail: "",
    servicesResourcesAvailable: `Cardio Tennis is a high-energy group fitness activity that combines the best features of the sport of tennis with cardiovascular exercise.

Classes scheduled for Friday 7/3/2026 @ 9:00 am; Tuesday 7/7/2026 @ 7:00 pm; Friday 7/10/2026 @ 9:00 am; Tuesday 7/14/2026 @ 7:00 pm; Friday 7/17/2026 @ 9:00 am; Tuesday 7/21/2026 @ 7:00 pm; Friday 7/24/2026 @ 9:00 am; Tuesday 7/28/2026 @ 7:00 pm; Friday 7/31/2026 @ 9:00 am.`,
    priceAffordability: "free",
    notesObservations: "",
  },

  {
    slug: "atl-beltline-skate-jam",
    assetNameOrOrganization: "ATL Beline - Skate Jam",
    communityAssetType: "Comm Based Classes & Programming",
    address: `Washington Park/Westside Beltline
1125 Lena Street Northwest`,
    city: "Atlanta",
    state: "GA",
    zipCode: "",
    website: "https://beltline.org/events/6a0774ae170f05754eb11088/",
    socialMedia: "",
    keyContact: "",
    contactPhone: "",
    contactEmail: "",
    servicesResourcesAvailable: `Learn fun group routines to build timing, control, and confidence while skating with others.

Classes scheduled for Friday 7/3/2026 @ 6:30 pm; Friday 7/10/2026 @ 6:30 pm; Friday 7/17/2026 @ 6:30 pm; Friday 7/24/2026 @ 6:30 pm; Friday 7/31/2026 @ 6:30 pm; Friday 8/7/2026 @ 6:30 pm; Friday 8/14/2026 @ 6:30 pm; Friday 8/21/2026 @ 6:30 pm.`,
    priceAffordability: "free",
    notesObservations: "",
  },

  {
    slug: "atl-beltline-self-ease-yoga",
    assetNameOrOrganization: "ATL Beltline - Self-Ease Yoga",
    communityAssetType: "Comm Based Classes & Programming",
    address: "various",
    city: "Atlanta",
    state: "GA",
    zipCode: "",
    website: "https://beltline.org/events/69fbbcb29a801d629a639911/",
    socialMedia: "",
    keyContact: "",
    contactPhone: "",
    contactEmail: "",
    servicesResourcesAvailable: `Self-Ease Yoga on the Beltline is a creatively sequenced hatha-styled yoga class infused with engaging yoga poses and delicious deep breaths aimed to bring ease to the mind and body.

Classes scheduled for Sunday 7/5/2026 @ 10:00 am; Monday 7/6/2026 @ 6:00 pm; Sunday 7/12/2026 @ 10:00 am; Monday 7/13/2026 @ 6:00 pm; Sunday 7/19/2026 @ 10:00 am; Monday 7/20/2026 @ 5:00 pm; Monday 7/27/2026 @ 6:00 pm; Sunday 8/2/2026 @ 10:00 am.`,    priceAffordability: "free",
    notesObservations: "",
  },
  {
    slug: "atl-beltline-skate-and-werk-the-beltline",
  assetNameOrOrganization: "ATL Beltline - Skate & Werk the Beltline",
  communityAssetType: "Comm Based Classes & Programming",
  address: `Lee + White
933 White St`,
  city: "Atlanta",
  state: "GA",
  zipCode: "",
  website: "https://beltline.org/events/69fa50dd9a801d629a618c55/",
  socialMedia: "",
  keyContact: "",
  contactPhone: "",
  contactEmail: "",
  servicesResourcesAvailable: `Skate lessons using traveling routines designed to help you skate the Beltline with confidence. Beginners skaters should have some stopping knowledge and power. All levels welcome! Participants must be at least 12 years of age. Please bring your own skates, knee pads, helmets, and elbow pads.

Classes scheduled for Monday 7/6/2026 @ 6:30 pm; Monday 7/13/2026 @ 6:30 pm; Monday 7/20/2026 @ 6:30 pm; Monday 7/27/2026 @ 6:30 pm; Tuesday 7/28/2026 @ 6:00 pm; Monday 8/3/2026 @ 6:30 pm; Monday 8/10/2026 @ 6:30 pm; Monday 8/17/2026 @ 6:30 pm.`,
  priceAffordability: "free",
  notesObservations: "",
},

{
  slug: "atl-beltline-tennis-for-juniors",
  assetNameOrOrganization: "ATL Beltline - Tennis for Juniors",
  communityAssetType: "Comm Based Classes & Programming",
  address: `Washington Park Tennis Ctr
1125 Lena Street Northwest`,
  city: "Atlanta",
  state: "GA",
  zipCode: "",
  website: "https://beltline.org/events/69fb8fa49a801d629a63920d/",
  socialMedia: "",
  keyContact: "",
  contactPhone: "",
  contactEmail: "",
  servicesResourcesAvailable: `Class description: This tennis class will focus on learning the fundamentals of the game in a fun and positive environment. Students will learn basic tennis techniques, movement, and how to play a match. We will teach students how to rally and improve strategy as they progress. The classes will be high energy, fun, and rewarding. Open to beginner and intermediate levels. Ages 8-13. Due to limited capacity on the court, registration is mandatory.

Classes scheduled for Tuesday 7/7/2026 @ 6:00 pm; Tuesday 7/14/2026 @ 6:00 pm; Tuesday 7/21/2026 @ 6:00 pm; Wednesday 7/29/2026 @ 6:00 pm; Thursday 8/6/2026 @ 6:15 pm.`,
  priceAffordability: "free",
  notesObservations: "",
},

{
  slug: "atl-beltline-fit-squad-studio-presents",
  assetNameOrOrganization: "ATL Beltline- Fit Sqaud Studio Presents",
  communityAssetType: "Comm Based Classes & Programming",
  address: "",
  city: "Atlanta",
  state: "GA",
  zipCode: "",
  website: "https://beltline.org/events/6a15ee48c49ffaa4fff3eb94/",
  socialMedia: "",
  keyContact: "na",
  contactPhone: "",
  contactEmail: "",
  servicesResourcesAvailable: `FitSquad Studios Presents... offers a rotation of weekly classes that will energize you, engage your core, get your body moving, and teach self-defense techniques. Please see the class dates and descriptions below. Please bring a bottle of water and a towel.

Classes scheduled for Wednesday 7/8/2026 @ 6:00 pm; Wednesday 7/15/2026 @ 6:00 pm; Wednesday 7/22/2026 @ 6:00 pm; Wednesday 7/29/2026 @ 6:30 pm; Wednesday 8/12/2026 @ 6:00 pm.`,
  priceAffordability: "free",
  notesObservations: "",
},

{
  slug: "atl-beltline-magic-movement",
  assetNameOrOrganization: "ATL Beltline - Magic Movement",
  communityAssetType: "Comm Based Classes & Programming",
  address: `Grant Park- Greenspace F
537 Park Avenue Southeast`,
  city: "Atlanta",
  state: "GA",
  zipCode: "",
  website: "https://beltline.org/events/6a0ca3357f5e6e341c36aed2/",
  socialMedia: "",
  keyContact: "",
  contactPhone: "",
  contactEmail: "",
  servicesResourcesAvailable: `This class combines the fluidity of Vinyasa yoga with the precision of alignment principles, creating a holistic practice that nurtures both strength and flexibility. Through intentional movement synchronized with breath, you'll cultivate a deep sense of presence and awareness within each posture. Bring a mat, towel, and water.

Classes scheduled for Wednesday 7/8/2026 @ 6:30 pm; Wednesday 7/15/2026 @ 6:30 pm; Wednesday 7/22/2026 @ 6:30 pm; Saturday 8/8/2026 @ 10:00 am; Wednesday 8/12/2026 @ 6:30 pm; Wednesday 8/19/2026 @ 6:30 pm; Saturday 9/12/2026 @ 10:00 am; Saturday 10/10/2026 @ 10:00 am; Saturday 11/14/2026 @ 10:00 am.`,
  priceAffordability: "free",
  notesObservations: "",
},

{
  slug: "atl-beltline-e-scooter-lesson-with-bird",
  assetNameOrOrganization: "ATL Beltline - e-Scooter Lesson with Bird",
  communityAssetType: "Comm Based Classes & Programming",
  address: `Piedmont Park- Amsterdam Ave Entrance
501 Amsterdam Avenue Northeast`,
  city: "Atlanta",
  state: "GA",
  zipCode: "",
  website: "https://beltline.org/events/69f8b9d49a801d629a5f68cf/",
  socialMedia: "",
  keyContact: "",
  contactPhone: "",
  contactEmail: "",
  servicesResourcesAvailable: `This 45-minute intro lesson is perfect for riders new to e-Scooters. Get familiar with the basics, learn urban safety tips, take a test ride, and learn what makes Scooters a game-changer for getting around Atlanta and the Beltline. Note: Participants must be at least 18 years of age. We will meet at the Amsterdam Ave Entrance of Piedmont Park.

Classes scheduled for Saturday 7/11/2026 @ 10:00 am; Saturday 8/1/2026 @ 9:00 am; Saturday 8/22/2026 @ 9:00 am.`,
  priceAffordability: "free",
  notesObservations: "",
},
{
  slug: "atl-beltline-king-of-pops-yoga",
  assetNameOrOrganization: "ATL Beline - King of Pops Yoga",
  communityAssetType: "Comm Based Classes & Programming",
  address: "various",
  city: "Atlanta",
  state: "GA",
  zipCode: "",
  website: "https://beltline.org/events/6a0779b0170f05754eb112ee/",
  socialMedia: "",
  keyContact: "",
  contactPhone: "",
  contactEmail: "",
  servicesResourcesAvailable: `Step onto the mat with us for a journey unlike any other. Our complimentary yoga classes aren't just about stretching and poses; they're about crafting experiences that uplift and inspire. We've meticulously curated a team of instructors who embody not only mastery in yoga but also radiate joy, infuse fun, and sprinkle humor into every session. Please bring a yoga mat, towel, and water.

NOTE: June 27th and August 22nd classes will be HELD at the Thomas Taylor Skate Park Multi-purpose Field (830 Willoughby Way, NE, Atlanta, GA 30312)

Classes scheduled for Saturday 7/11/2026 @ 9:00 am; Saturday 7/18/2026 @ 9:00 am; Saturday 7/25/2026 @ 9:00 am; Saturday 8/8/2026 @ 9:00 am.`,
  priceAffordability: "free",
  notesObservations: "",
},

{
  slug: "atl-beltline-summer-soul-line-dance",
  assetNameOrOrganization: "ATL Beltline - Summer Soul Line Dance",
  communityAssetType: "Comm Based Classes & Programming",
  address: `Terminal South
1155 Hank Aaron Drive Southwest`,
  city: "Atlanta",
  state: "GA",
  zipCode: "",
  website: "https://beltline.org/events/6a15f1f4c49ffaa4fff3eda1/",
  socialMedia: "",
  keyContact: "",
  contactPhone: "",
  contactEmail: "",
  servicesResourcesAvailable: `Dawn Peck is an experienced professional in the field of Dance Fitness. Beginners and Seasoned Line dancers welcome! Come enjoy an evening of Line Dancing at Terminal South.

Classes scheduled for Friday 7/10/2026 @ 7:00 pm.`,
  priceAffordability: "free",
  notesObservations: "",
},

{
  slug: "atl-beltline-pilates-on-ponce",
  assetNameOrOrganization: "ATL Beltline - Pilates on Ponce",
  communityAssetType: "Comm Based Classes & Programming",
  address: `Historic Fourth Ward Park Greenspace C
385 North Angier Avenue Northeast`,
  city: "Atlanta",
  state: "GA",
  zipCode: "",
  website: "https://beltline.org/events/6a0f8ae1cf34817f88fc306b/",
  socialMedia: "",
  keyContact: "Nancy Smith",
  contactPhone: "770-845-0527",
  contactEmail: "",
  servicesResourcesAvailable: `Core Mat Pilates is a beginner-level workout that can improve your muscle tone, flexibility, and strength. Join me for an hour of movement, strength, mobility, and core work in one of Atlanta's favorite parks. Whether it's your first Pilates class or your fiftieth, you're welcome here. Bring your mat and water.

Classes scheduled for Saturday 7/11/2026 @ 10:00 am; Saturday 7/18/2026 @ 10:00 am; Saturday 7/25/2026 @ 10:00 am; Sunday 8/9/2026 @ 10:00 am; Saturday 8/22/2026 @ 10:00 am.`,
  priceAffordability: "free",
  notesObservations: "",
},

{
  slug: "atl-beltline-youth-run-academy",
  assetNameOrOrganization: "ATL Beltline - Youth Run Academy",
  communityAssetType: "Comm Based Classes & Programming",
  address: `Pittsburgh Yards -- James Bridges Field
352 University Avenue Southwest`,
  city: "Atlanta",
  state: "GA",
  zipCode: "",
  website: "https://beltline.org/events/6a22f7e7a96df48173f942c4/",
  socialMedia: "",
  keyContact: "",
  contactPhone: "",
  contactEmail: "",
  servicesResourcesAvailable: `Target: Grades: 6-12 (Ages: 12-17) Maximum Capacity: 12 ( Grades 6-8: 6, Grades 9-12: 6)

Program Goal: Each participant will aim to complete 6-13 miles total over 6 weeks (scaled based on attendance), while learning: Running Fundamentals, Goal Setting, Healthy Habits, Teamwork & Leadership, Confidence Building, Endurance Development, Fun Through Movement.

Wear light, comfortable clothing, and running shoes. Please bring water, hat, and a towel.

Classes scheduled for Sunday 7/12/2026 @ 10:00 am; Sunday 7/19/2026 @ 10:00 am; Sunday 7/26/2026 @ 10:00 am; Sunday 8/2/2026 @ 10:00 am; Sunday 8/9/2026 @ 10:00 am; Sunday 8/16/2026 @ 10:00 am.`,
  priceAffordability: "free",
  notesObservations: "",
},

{
  slug: "atl-beltline-zumba-hip-hop-cardio",
  assetNameOrOrganization: "ATL Beltline - Zumba/Hip Hop Cardio",
  communityAssetType: "Comm Based Classes & Programming",
  address: `Terminal South
1155 Hank Aaron Drive Southwest`,
  city: "Atlanta",
  state: "GA",
  zipCode: "",
  website: "https://beltline.org/events/6a0f7ca4cf34817f88fc2d9b/",
  socialMedia: "",
  keyContact: "",
  contactPhone: "",
  contactEmail: "",
  servicesResourcesAvailable: `This class offers a comprehensive approach to dance fitness. Participants will have the opportunity to engage in a range of activities, including ZUMBA and HIP HOP. The course is designed to cater to individuals of all fitness levels, regardless of their current stage in their fitness journey.

Classes scheduled for Saturday 7/18/2026 @ 10:00 am; Saturday 7/25/2026 @ 10:00 am; Saturday 8/1/2026 @ 10:00 am.`,
  priceAffordability: "free",
  notesObservations: "",
},

{
  slug: "atl-beltline-e-bike-lesson-with-lime",
  assetNameOrOrganization: "ATL Beltline - e-Bike Lesson with Lime",
  communityAssetType: "Comm Based Classes & Programming",
  address: `Lee + White Parking Garage
929 Lee Street Southwest`,
  city: "Atlanta",
  state: "GA",
  zipCode: "",
  website: "https://beltline.org/events/69b19abc13e88b3e73528ced/",
  socialMedia: "",
  keyContact: "",
  contactPhone: "",
  contactEmail: "",
  servicesResourcesAvailable: `This 30-minute intro lesson is perfect for confident manual riders new to e-bikes. Get familiar with the basics, take a test ride, and learn what makes e-biking a game changer for getting around Atlanta and the Beltline. Note: Participants must be at least 18 years of age.

Classes scheduled for Saturday 7/25/2026 @ 9:00 am & 9:30 am; Saturday 8/22/2026 @ 9:00 am & 9:30 am; Saturday 9/26/2026 @ 9:00 am & 9:30 am; Saturday 10/24/2026 @ 9:00 am & 9:30 am; Saturday 11/21/2026 @ 9:00 am & 9:30 am`,
  priceAffordability: "free",
  notesObservations: `Please download one of the following apps before your class:

App Store:
https://apps.apple.com/us/app/lime-ridegreen/id1199780189

Play Store:
https://play.google.com/store/apps/details?id=com.limebike&pcampaignid=web_share`,
},

{
  slug: "atl-beltline-core-and-more",
  assetNameOrOrganization: "ATL Beltline - Core + More",
  communityAssetType: "Comm Based Classes & Programming",
  address: `Pittsburgh Yards -- James Bridges Field
352 University Avenue Southwest`,
  city: "Atlanta",
  state: "GA",
  zipCode: "",
  website: "https://beltline.org/events/6a0629c3170f05754eaf1caa/",
  socialMedia: "",
  keyContact: "",
  contactPhone: "",
  contactEmail: "",
  servicesResourcesAvailable: `Core + More is Moses Carroll’s signature training experience, a high-energy class focused on building a strong, stable core while training the entire body. This class goes beyond traditional ab workouts, integrating strength training, balance, mobility, and cardiovascular conditioning to improve posture, power, and overall movement efficiency. Each session is thoughtfully programmed to challenge all fitness levels, leaving participants stronger, more confident, and mentally refreshed.

Classes scheduled for Saturday 7/25/2026 @ 8:30 am; Saturday 8/29/2026 @ 8:30 am.`,
  priceAffordability: "free",
  notesObservations: "",
},

{
  slug: "atl-beltline-eastside-beltline-12k-3k",
  assetNameOrOrganization: "ATL Beltline - Eastside Beltline 12k-3k",
  communityAssetType: "Comm Based Classes & Programming",
  address: `Piedmont Park
500 10th Street Northeast`,
  city: "Atlanta",
  state: "GA",
  zipCode: "",
  website: "https://beltline.org/events/6a342311ab4b9260c4418ec7/",
  socialMedia: "",
  keyContact: "ABP - Wellness",
  contactPhone: "",
  contactEmail: "info@atlblp.org",
  servicesResourcesAvailable: `Celebrate community and movement with the Atlanta Beltline and Atlanta Track Club through a race series on Atlanta's favorite running and walking destination. The last stop of the series takes us to the Eastside Beltline, traveling through Piedmont Park, Ponce City Market and Krog Street Market. Test your speed in the competitive 12K (ages 13 & older) or stick to the non-competitive 3K (ages 7 & older) where strollers and dogs are welcome.

Class scheduled for Saturday 12/5/2026 @ 10:00 am.`,
  priceAffordability: "free but RSVP required",
  notesObservations: "",
},

{
  slug: "atl-beltline-southside-beltline-8k-3k",
  assetNameOrOrganization: "ATL Beltline Southside Beltline 8k-3k",
  communityAssetType: "Comm Based Classes & Programming",
  address: `Pittsburgh Yards
352 University Avenue Southwest`,
  city: "Atlanta",
  state: "GA",
  zipCode: "",
  website: "",
  socialMedia: "",
  keyContact: "ABP - Wellness",
  contactPhone: "",
  contactEmail: "info@atlblp.org",
  servicesResourcesAvailable: `EVENT UPDATE: As of Thursday, April 30, the 2026 Southside Beltline 3K is sold out. Spots still remain in the 8K.

Celebrate community and movement with the Atlanta Beltline and Atlanta Track Club through a race series on Atlanta's favorite running and walking destination. Join us for the first annual Southside Beltline race in 2026, and explore the newest section of the Beltline! Test your speed in the competitive 8K (ages 9 & older) or stick to the non-competitive 3K (ages 7 & older) where strollers and dogs are welcome.

Class scheduled for Saturday 8/1/2026 @ 7:00 am.`,
  priceAffordability: "free but RSVP required",
  notesObservations: "",
},
{
  slug: "hills-4-atl-one-step-at-a-time",
  assetNameOrOrganization: "Hills 4 ATL - One Step at a Time",
  communityAssetType: "Comm Based Classes & Programming",
  address: "666 Rankin St",
  city: "Atlanta",
  state: "GA",
  zipCode: "",
  website: "",
  socialMedia: "https://www.instagram.com/p/DZnQWkoCD-_/?hl=en",
  keyContact: "",
  contactPhone: "",
  contactEmail: "Hills4atl@gmail.com",
  servicesResourcesAvailable: `Classes held every Monday @ 6:30 pm.`,
  priceAffordability: "free but RSVP required",
  notesObservations: "",
},

{
  slug: "hills-4-atl",
  assetNameOrOrganization: "Hills 4 ATL",
  communityAssetType: "Comm Based Classes & Programming",
  address: "Piedmont Park",
  city: "Atlanta",
  state: "GA",
  zipCode: "",
  website: "",
  socialMedia: "https://www.instagram.com/p/DZnQWkoCD-_/?hl=en",
  keyContact: "",
  contactPhone: "",
  contactEmail: "Hills4atl@gmail.com",
  servicesResourcesAvailable: `Classes held every Wednesday @ 7:30 am and 6:30 pm.`,
  priceAffordability: "free but RSVP required",
  notesObservations:
    "Closest entrance: 10th Street & Charles Allen. Parking available at Park Tavern for $5",
},

{
  slug: "hills-4-atl-hiit-different",
  assetNameOrOrganization: "Hills 4 ATL - HIIT Different",
  communityAssetType: "Comm Based Classes & Programming",
  address: "929 Lee St",
  city: "Atlanta",
  state: "GA",
  zipCode: "",
  website: "",
  socialMedia: "https://www.instagram.com/p/DZnQWkoCD-_/?hl=en",
  keyContact: "",
  contactPhone: "",
  contactEmail: "Hills4atl@gmail.com",
  servicesResourcesAvailable: `Classes held every Thursday @ 6:30 pm.`,
  priceAffordability: "free but RSVP required",
  notesObservations: "",
},

{
  slug: "hills-4-atl-flow-yoga",
  assetNameOrOrganization: "Hills 4 ATL - Flow Yoga",
  communityAssetType: "Comm Based Classes & Programming",
  address: "1200 White St",
  city: "Atlanta",
  state: "GA",
  zipCode: "",
  website: "",
  socialMedia: "https://www.instagram.com/p/DZnQWkoCD-_/?hl=en",
  keyContact: "",
  contactPhone: "",
  contactEmail: "Hills4atl@gmail.com",
  servicesResourcesAvailable: `Classes held every Saturday @ 9:00 am.`,
  priceAffordability: "free but RSVP required",
  notesObservations: "",
},

{
  slug: "hills-4-atl-mile-crusher",
  assetNameOrOrganization: "Hills 4 ATL - Mile Crusher",
  communityAssetType: "Comm Based Classes & Programming",
  address: "Rotates weekly between 666 Rankin St and 1200 White St",
  city: "Atlanta",
  state: "GA",
  zipCode: "",
  website: "",
  socialMedia: "https://www.instagram.com/p/DZnQWkoCD-_/?hl=en",
  keyContact: "",
  contactPhone: "",
  contactEmail: "Hills4atl@gmail.com",
  servicesResourcesAvailable: `Classes held every Saturday @ 10:30 am.`,
  priceAffordability: "free but RSVP required",
  notesObservations: "",
},

{
  slug: "atl-beltline-learn-to-swim-youth",
  assetNameOrOrganization: "ATL Beltline - Learn to Swim (youth)",
  communityAssetType: "Comm Based Classes & Programming",
  address: `Washington Park Natatorium
102 Ollie Street Northwest`,
  city: "Atlanta",
  state: "GA",
  zipCode: "",
  website: "https://beltline.org/events/6a3c4fa9b088eea674ef8633/",
  socialMedia: "",
  keyContact: "",
  contactPhone: "",
  contactEmail: "",
  servicesResourcesAvailable: `Learn to swim for kids aged 5-12 years. Fish Scales Swimming is an inclusive beginner-friendly social swim club that helps children and adults become comfortable with swimming through community and training.

Please bring the following items: swimsuit, swim cap, towel, goggles, and water bottle.

6-session series scheduled for Saturday 7/11/2026 @ 12:30 pm; Saturday 7/18/2026 @ 12:30 pm; Saturday 7/25/2026 @ 12:30 pm; Saturday 8/1/2026 @ 12:30 pm; Saturday 8/8/2026 @ 12:30 pm; Saturday 8/15/2026 @ 12:30 pm.`,
  priceAffordability: "free but RSVP required",
  notesObservations: "",
},

{
  slug: "atl-beltline-fitness-fusion",
  assetNameOrOrganization: "ATL Beltline - Fitness Fusion",
  communityAssetType: "Comm Based Classes & Programming",
  address: `Shirley Clarke Franklin Park (Entrance II)
1660 Johnson Rd NW`,
  city: "Atlanta",
  state: "GA",
  zipCode: "",
  website: "https://beltline.org/events/6a3efc4a2d6c2158fd0a8673/",
  socialMedia: "",
  keyContact: "",
  contactPhone: "",
  contactEmail: "",
  servicesResourcesAvailable: `We take a flexible approach to traditional exercises. We mix up various styles of exercises to keep your workouts interesting.

Combines moves from disciplines like yoga, pilates, boot camp, ballet/dance, cardio, boxing, and more.

Please bring a bottle of water, mat, and a towel.

Classes scheduled for Friday 7/17/2026 @ 6:30 pm; Friday 7/24/2026 @ 6:30 pm; Friday 7/31/2026 @ 6:30 pm; Friday 8/7/2026 @ 6:30 pm; Friday 8/14/2026 @ 6:30 pm; Friday 8/21/2026 @ 6:30 pm.`,
  priceAffordability: "free",
  notesObservations: "",
},
``
];
/** Pre-translated cache so each Convex query references the same array. */
const SEED_ASSETS: AtlasAsset[] = SEED_LOCATIONS.map(translateSeed);
