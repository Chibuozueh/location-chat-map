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
  },
  // The atlas's "locations" data is intentionally NOT stored in Convex:
  // the canonical sources are either the embedded SEED_LOCATIONS in
  // convex/locations.ts (translated to AtlasAsset shape on the fly) or
  // a user-uploaded CSV that flows through the client-side importer in
  // src/state/imported-data.tsx. This keeps Convex as the auth backend
  // only and avoids the schema/type mismatch that arises from trying to
  // shoe-horn raw spreadsheet column names into a fixed-shape table.
);

export default schema;
