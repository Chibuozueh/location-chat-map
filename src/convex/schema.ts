import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const dayHoursSchema = {
  open: v.string(),
  close: v.string(),
};

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    locations: defineTable({
      slug: v.string(),
      name: v.string(),
      tagline: v.string(),
      category: v.string(),
      rating: v.number(),
      reviewCount: v.number(),
      priceTier: v.number(),
      description: v.string(),
      address: v.string(),
      city: v.string(),
      state: v.string(),
      country: v.string(),
      postalCode: v.string(),
      lat: v.number(),
      lng: v.number(),
      hours: v.object({
        mon: v.object(dayHoursSchema),
        tue: v.object(dayHoursSchema),
        wed: v.object(dayHoursSchema),
        thu: v.object(dayHoursSchema),
        fri: v.object(dayHoursSchema),
        sat: v.object(dayHoursSchema),
        sun: v.object(dayHoursSchema),
      }),
      features: v.array(v.string()),
      openedYear: v.number(),
      signatureDrink: v.string(),
      ownerName: v.optional(v.string()),
      imageUrl: v.optional(v.string()),
      accentColor: v.optional(v.string()),
    })
      .index("by_slug", ["slug"])
      .index("by_category", ["category"])
      .index("by_rating", ["rating"])
      .index("by_price", ["priceTier"])
      .searchIndex("search_name", {
        searchField: "name",
        filterFields: ["category", "city"],
      }),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
