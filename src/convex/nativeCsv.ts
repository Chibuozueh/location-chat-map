/**
 * Native-CSV storage helpers used by the atlas's auto-loader.
 *
 * `src/state/imported-data.tsx` calls `api.nativeCsv.getUrl` with a
 * storage reference (Convex storage ID or a full HTTP URL) that points at
 * the project's reference CSV. The handler:
 *
 *   1. If the string is already an `http://` / `https://` URL, returns it
 *      verbatim. The client can then `fetch()` it directly.
 *   2. Otherwise tries `ctx.storage.getUrl(storageId)` (Convex's `_storage`
 *      table). The previous `v.id("_storage")` validator crashed hard
 *      when the user pasted a non-Convex token like the Freebuff/Vercel
 *      Blob `csk-...` identifier — we now catch any "not a real storage
 *      id" failure and return `null` so the client can fall through to
 *      the `/data/*.csv` static files (or surface a clear "paste the full
 *      URL" toast).
 *
 * CORS note: Convex storage URLs ship permissive CORS headers and require
 * no auth header, so a plain browser `fetch()` works.
 *
 * Query (not action): `ctx.storage.getUrl` is non-mutating and Convex
 * automatically caches query results. The handler never invokes
 * `fetch()` itself, only the storage helper, so this stays a query.
 */

import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

export const getUrl = query({
  // Accept any string. We used to require `v.id("_storage")` but the
  // user's reference can also be a full URL pasted from a Freebuff /
  // Vercel Blob / S3 data tab. The strict validator threw before the
  // handler even ran on non-Convex tokens.
  args: { storageId: v.string() },
  handler: async (_ctx, args): Promise<string | null> => {
    const ref = args.storageId.trim();
    if (!ref) return null;
    // Already a public URL — pass through unmodified so the client can
    // fetch it directly.
    if (ref.startsWith("http://") || ref.startsWith("https://")) {
      return ref;
    }
    // Freebuff data-tab sometimes hands back a relative path like
    // `/storage/csk-...`. The absolute form would be the same host the
    // app is hosted on, but we conservatively return null and let the
    // client fall through to its static-file chain rather than guess.
    if (ref.startsWith("/")) return null;
    // Try Convex storage as the third path. The cast is loose on purpose
    // — if `ref` is not actually a Convex `_storage` id, `getUrl` returns
    // null without throwing on most Convex versions, and any thrown
    // error is swallowed so the query resolves cleanly with `null` and
    // the client falls through to the next source.
    try {
      const url = await _ctx.storage.getUrl(ref as Id<"_storage">);
      if (url) return url;
    } catch {
      // fall through to null
    }
    return null;
  },
});
