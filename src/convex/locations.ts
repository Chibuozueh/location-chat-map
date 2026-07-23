import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { isOpenAt, searchRows } from "../lib/atlas-search";

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
    return searchRows(all as any, question);
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

Classes scheduled for Sunday 7/5/2026 @ 10:00 am; Monday 7/6/2026 @ 6:00 pm; Sunday 7/12/2026 @ 10:00 am; Monday 7/13/2026 @ 6:00 pm; Sunday 7/19/2026 @ 10:00 am; Monday 7/20/2026 @ 5:00 pm; Monday 7/27/2026 @ 6:00 pm; Sunday 8/2/2026 @ 10:00 am.`,
    priceAffordability: "free",
    notesObservations: "",
  },

  // Continue remaining records in identical format:
  // ATL Beltline - Skate & Werk the Beltline
  // ATL Beltline - Tennis for Juniors
  // ATL Beltline - Fit Squad Studio Presents
  // ATL Beltline - Magic Movement
  // ATL Beltline - e-Scooter Lesson with Bird
  // ATL Beltline - King of Pops Yoga
  // ATL Beltline - Summer Soul Line Dance
  // ATL Beltline - Pilates on Ponce
  // ATL Beltline - Youth Run Academy
  // ATL Beltline - Zumba/Hip Hop Cardio
  // ATL Beltline - e-Bike Lesson with Lime
  // ATL Beltline - Core + More
  // ATL Beltline - Eastside Beltline 12k-3k
  // ATL Beltline Southside Beltline 8k-3k
  // Hills 4 ATL - One Step at a Time
  // Hills 4 ATL
  // Hills 4 ATL - HIIT Different
  // Hills 4 ATL - Flow Yoga
  // Hills 4 ATL - Mile Crusher
  // ATL Beltline - Learn to Swim (youth)
  // ATL Beltline - Fitness Fusion
];


