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

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables,

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()),
      image: v.optional(v.string()),
      email: v.optional(v.string()),
      emailVerificationTime: v.optional(v.number()),
      isAnonymous: v.optional(v.boolean()),

      role: v.optional(roleValidator),
    }).index("email", ["email"]),

    locations: defineTable({
      assetNameOrOrganization: v.string(),
      communityAssetType: v.string(),
      address: v.string(),
      city: v.string(),
      state: v.string(),
      zipCode: v.string(),

      website: v.string(),
      socialMedia: v.string(),

      keyContact: v.string(),
      contactPhone: v.string(),
      contactEmail: v.string(),

      servicesResourcesAvailable: v.string(),
      priceAffordability: v.string(),
      notesObservations: v.string(),
    })
      .index("by_asset_name", ["assetNameOrOrganization"])
      .index("by_asset_type", ["communityAssetType"])
      .index("by_city", ["city"])
      .index("by_state", ["state"])
      .searchIndex("search_asset_name", {
        searchField: "assetNameOrOrganization",
        filterFields: ["communityAssetType", "city"],
      }),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
