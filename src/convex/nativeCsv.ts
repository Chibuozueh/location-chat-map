/**
 * Convex-storage helpers used by the atlas's native-CSV auto-loader.
 *
 * `src/state/imported-data.tsx` calls `api.nativeCsv.getUrl` with a storage
 * id (e.g. the one surfaced by the project's data panel). We resolve that id
 * to a public signed URL via `ctx.storage.getUrl`, then the browser fetches
 * the URL directly. The URL embeds a signature token; Convex storage URLs
 * are un-guessable in practice but anyone holding the exact URL string can
 * read the file. The endpoint ships permissive CORS so a plain browser
 * fetch works without extra auth headers.
 *
 * Query (not action): `ctx.storage.getUrl` is non-mutating and Convex
 * automatically caches query results, so using a query is faster and
 * cheaper than an action for a stable storage id.
 */

import { query } from "./_generated/server";
import { v } from "convex/values";

export const getUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args): Promise<string | null> => {
    return await ctx.storage.getUrl(args.storageId);
  },
});
