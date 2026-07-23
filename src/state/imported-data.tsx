// React Context + provider for parsed CSV uploads. Also drives the
// geocoding pass that converts addresses → lat/lng via the Nominatim
// Convex action. Client-side in-memory only.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAction, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  type AddressFragment,
  type AtlasAsset,
  type CoordAccuracy,
  type ImportSummary,
  importCsv,
} from "@/lib/csv-import";
import type { LocationDoc } from "@/components/atlas/types";
import { api } from "@/convex/_generated/api";

export type GeocodeProgress = {
  total: number; // pending at start of pass
  done: number; // finished (cached + fetched + failed)
  cached: number;
  /** Tier 1 or Tier 2 structured Nominatim match — high-confidence. */
  exact: number;
  /** Tier 3 relaxed match (street+zip only). */
  relaxed: number;
  /** Zip centroid (Atlanta table or Zippopotam.us fallback). */
  zipCentroid: number;
  /** Rows that the Gemini-normalize + re-run cascade recovered. */
  geminiCleaned: number;
  /** Rows Gemini returned ok=false for (no fabrication, gave up). */
  geminiSkipped: number;
  /** Rows where the Gemini call itself errored (transient). */
  geminiError: number;
  /** Number of times we've actually hit the MapChat `normalizeAddress`
   *  action (whether the result was a clean, skip, or error). Surfaced in
   *  the UI so the user can see the API is being called and how many
   *  calls have happened so far in this pass. */
  geminiCallsMade: number;
  /** Whichever provider answered the last successful MapChat call. Surfaced
   *  in the chip so the user can tell at a glance which key powered the
   *  normalizer ("MapChat · gemini-flash-latest" when MAP_CHAT_KEY is
   *  set, "Gemini · gemini-flash-latest" when only the chat chain is
   *  available, etc.). */
  mapProviderLabel: string | null;
  failed: number;
  active: boolean;
};

type ImportedState = {
  rows: AtlasAsset[];
  pending: Array<{
    id: string;
    doc: AtlasAsset; // has lat = NaN, lng = NaN until geocoded
  }>;
  chatOnly: AtlasAsset[]; // PO Box + any row that can't be geocoded but is searchable
  failed: Array<{ id: string; reason: string; doc: AtlasAsset }>;
  filename: string | null;
  importedAt: number | null;
  retryNonce: number; // bumped whenever the user retries failed geocodes
  totalParsed: number;
  rejected: number;
  progress: GeocodeProgress;
  /** Where the imported data originally came from. Drives the header chip
   *  so the user knows if the atlas is showing a manually-uploaded CSV
   *  vs. a static reference file shipped in `public/data/`. */
  source: "native" | "upload" | null;
  /** Pre-validation gate. False while the FIRST post-import pass is still
   *  running MapChat `normalizeAddress` + the geocode cascade over every
   *  pending row. While false, `state.rows` (and `state.failed`) are held
   *  empty so the map + chat show nothing from the import until the AI
   *  pre-validation completes end-to-end. Manual Retry clicks (after the
   *  gate has opened once) preserve `released: true` so the UI doesn't
   *  re-lock. */
  released: boolean;
};

const EMPTY_PROGRESS: GeocodeProgress = {
  total: 0,
  done: 0,
  cached: 0,
  exact: 0,
  relaxed: 0,
  zipCentroid: 0,
  geminiCleaned: 0,
  geminiSkipped: 0,
  geminiError: 0,
  geminiCallsMade: 0,
  mapProviderLabel: null,
  failed: 0,
  active: false,
};

const EMPTY: ImportedState = {
  rows: [],
  pending: [],
  chatOnly: [],
  failed: [],
  filename: null,
  importedAt: null,
  retryNonce: 0,
  totalParsed: 0,
  rejected: 0,
  progress: EMPTY_PROGRESS,
  source: null,
  released: true,
};

/** Filenames probed (in order) for the static `/data/*.csv` fallback.
 *  Vite serves everything in `public/` from the project root, so these
 *  resolve to `/data/atlas.csv` etc. The first one that returns 200 OK
 *  wins once the Convex-storage / URL paths are exhausted. */
const NATIVE_CSV_PATHS = ["/data/atlas.csv", "/data/assets.csv"] as const;

/**
 * Reference to the project's reference CSV. Resolved in this order:
 *
 *   1. `VITE_NATIVE_CSV_URL` — a full `http(s)://` URL pasted from a
 *      Freebuff / Vercel Blob / S3 data tab. Freebuff hands back opaque
 *      `csk-…` tokens that are NOT Convex `_storage` IDs, so this is the
 *      only reliable way to reference them today.
 *   2. `VITE_NATIVE_CSV_STORAGE_ID` — a 32-character Convex `_storage`
 *      id used to be the canonical format. Kept for backward compat.
 *   3. Otherwise we skip the storage path entirely and the static
 *      `/data/*.csv` chain takes over.
 *
 * The native CSV (URL or ID) is baked into the localStorage cache key
 * so re-uploading the reference file (which produces a new id) auto-
 * invalidates older cache entries without an explicit `clear()`.
 */
const NATIVE_CSV_REF: string | null = (() => {
  const fromUrl = import.meta.env?.VITE_NATIVE_CSV_URL;
  if (typeof fromUrl === "string" && fromUrl.trim().length > 0) {
    return fromUrl.trim();
  }
  const fromId = import.meta.env?.VITE_NATIVE_CSV_STORAGE_ID;
  if (typeof fromId === "string" && fromId.trim().length > 0) {
    return fromId.trim();
  }
  return null;
})();

/** Cache key for the cached native CSV. Uses the reference verbatim so
 *  re-uploading the reference (and getting a fresh id) auto-invalidates
 *  the older snapshot. */
const NATIVE_CACHE_KEY = `atlas.nativeCsv.v2.${
  NATIVE_CSV_REF ?? "static"
}`;

type ImportedContextValue = {
  state: ImportedState;
  importing: boolean;
  geocoding: boolean;
  importFromFile: (file: File) => Promise<void>;
  retry: () => void;
  clear: () => void;
};

const ImportedContext = createContext<ImportedContextValue | null>(null);

// Nominatim public usage policy: ≤ 1 req/sec. We add a tiny slack of 100ms.
// Note: Atlanta-zip hits return instantly without a network call, so they
// won't trigger the spacing sleep.
const NOMINATIM_SPACING_MS = 1100;

// Gemini / Nebius rate-limit safety for Tier-5 address normalization.
// 4 s between calls keeps the user-visible call counter ticking at a useful
// rate and still stays well under common free-tier per-minute caps
// (Gemini flash: 15 RPM → 1 call / 4 s). Override via localStorage key
// `atlas.llmSpacingMs` if a quota bump is needed later.
const DEFAULT_LLM_NORMALIZE_SPACING_MS = 4_000;

export function ImportedDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ImportedState>(EMPTY);
  const [importing, setImporting] = useState(false);
  const geocode = useAction(api.geocode.geocodeAddress);
  // Tier-5: the AI-assisted address normalizer. Gracefully returns
  // ok=false when no API key is set so this degrades into "no behavior
  // change" on a fresh install.
  const normalizeAddress = useAction(api.chatComplete.normalizeAddress);

  // Cache by normalized address key so repeated rows are instant.
  const coordCacheRef = useRef<
    Map<string, { lat: number; lng: number; accuracy: CoordAccuracy }>
  >(new Map());

  // Cache successful Gemini normalizations keyed by rawStreet + geoKey so
  // re-imports / Retry don't double-charge the model.
  const normalizeCacheRef = useRef<
    Map<
      string,
      | {
          ok: true;
          street: string;
          city?: string;
          state?: string;
          postalcode?: string;
        }
      | { ok: false }
    >
  >(new Map());

  // Cancellation flag so an external `clear()` aborts the loop cleanly.
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  // Saved off `state.chatOnly` (PO Box / address-only rows) at the start
  // of each import. The pre-validation gate keeps `state.chatOnly` empty
  // so neither the map's cluster pass nor the chat's search sees any
  // imported data; the post-loop `flush` restores these once validation
  // completes.
  const heldChatOnlyRef = useRef<AtlasAsset[]>([]);

  const importFromFile = useCallback(async (file: File) => {
    setImporting(true);
    cancelRef.current.cancelled = true;
    await new Promise((r) => setTimeout(r, 0));
    cancelRef.current.cancelled = false;
    try {
      const text = await file.text();
      await importFromText(text, file.name, "upload");
    } catch (err) {
      console.error("CSV import error", err);
      toast.error(
        `Couldn't parse ${file.name}. Make sure it's a CSV or TSV file.`,
      );
    } finally {
      setImporting(false);
    }
  }, []);

  /**
   * Import a CSV string into the provider. Shared by the file-picker flow
   * and the native auto-loader so both paths reuse the same parser +
   * state-update + toast logic.
   *
   * Pre-validation gate: if there are pending rows, we hold `rows`,
   * `chatOnly`, and `failed` empty until the geocode loop finishes — the
   * MapChat `normalizeAddress` action runs as Step 2 of every pending
   * row, so once the loop completes we have a fully-validated set ready
   * for the map + chat.
   */
  const importFromText = useCallback(
    async (
      text: string,
      filename: string,
      source: "native" | "upload",
    ): Promise<void> => {
      // Cancel any in-flight loop from a previous import so its trailing
      // setState can't corrupt this brand-new state.
      cancelRef.current.cancelled = true;
      await new Promise((r) => setTimeout(r, 0));

      const summary = importCsv(text, filename);
      const readyCount = summary.rows.length;
      const pendingCount = summary.pending.length;
      const chatOnlyCount = summary.chatOnly.length;

      if (!readyCount && !pendingCount && !chatOnlyCount) {
        toast.error(
          `No valid rows in ${filename}. Each row needs at least a Name.`,
        );
        cancelRef.current.cancelled = false;
        return;
      }

      const ready = summary.rows.map((r) => r.doc);
      const pending = summary.pending.map((r, i) => ({
        id: `${i}-${r.doc.slug}`,
        doc: r.doc,
      }));
      const chatOnly = summary.chatOnly.map((r) => r.doc);
      // Saved for the post-loop flush — the gate keeps `chatOnly` empty
      // until the pre-validation pass completes, then restores it.
      heldChatOnlyRef.current = chatOnly;

      const gateOpen = pendingCount === 0;

      setState({
        // Hide all rows during the gate so neither map nor chat can paint
        // any imported data until the AI pre-validation finishes.
        rows: gateOpen ? ready : [],
        pending,
        chatOnly: gateOpen ? chatOnly : [],
        failed: [],
        filename: summary.filename,
        importedAt: Date.now(),
        retryNonce: 0,
        totalParsed: summary.totalParsed,
        rejected: summary.rejected,
        progress: {
          total: pendingCount,
          done: 0,
          cached: 0,
          exact: 0,
          relaxed: 0,
          zipCentroid: 0,
          geminiCleaned: 0,
          geminiSkipped: 0,
          geminiError: 0,
          geminiCallsMade: 0,
          mapProviderLabel: null,
          failed: 0,
          active: pendingCount > 0,
        },
        source,
        released: gateOpen,
      });

      cancelRef.current.cancelled = false;

      const skipped = summary.rejected;
      const placed = readyCount + chatOnlyCount;
      const pendingNote =
        pendingCount > 0
          ? ` · pre-validating ${pendingCount} address${pendingCount === 1 ? "" : "es"} via MapChat`
          : "";
      const chatOnlyNote =
        chatOnlyCount > 0 ? ` · ${chatOnlyCount} address-only` : "";
      const sourceLabel = source === "native" ? "public/data" : "your upload";
      toast.success(
        `${placed} ${placed === 1 ? "row" : "rows"} from ${filename}` +
          (skipped ? ` · ${skipped} skipped` : "") +
          chatOnlyNote +
          pendingNote,
      );
    },
    [],
  );

  /**
   * Resolve the project's reference CSV into a public URL. Result is a
   * `string` when the reference was a URL (passed through) or a Convex
   * storage ID that resolved. `null` means the reference was an
   * unrecognised token (e.g. `csk-…` Freebuff blob); the client falls
   * through to the static `/data/*.csv` chain and toasts the user. The
   * query stays disabled when there's no reference at all, so a fresh
   * install doesn't burn a Convex round-trip.
   *
   * NOTE: this query is intentionally about the native CSV's URL, NOT
   * about which provider answers the chat. The map's AI normalizer
   * (callAddressNormalizer in convex/chatComplete.ts) uses MAP_CHAT_KEY
   * independently and never touches the chat Gemini key — so a noisy
   * CSV import can't starve the conversational chat.
   */
  const nativeStorageUrl = useQuery(
    api.nativeCsv.getUrl,
    NATIVE_CSV_REF
      ? { storageId: NATIVE_CSV_REF }
      : "skip",
  );

  /**
   * Probe the canonical native CSV sources and return the first one with
   * non-empty content. Order:
   *   1. Convex storage (project data-panel upload) — preferred source.
   *   2. Static `/data/atlas.csv` then `/data/assets.csv` (Vite serves
   *      anything under `public/` from the project root).
   * Returns null when no source has a usable file.
   *
   * If the storage file is removed (e.g. the user cleared the data tab)
   * the cache entry is evicted so the next session shows the fallback or
   * the curated defaults rather than the orphaned snapshot.
   */
  const fetchNativeCsv = useCallback(async (): Promise<{
    text: string;
    filename: string;
  } | null> => {
    // 1. Convex storage
    if (nativeStorageUrl) {
      try {
        const res = await fetch(nativeStorageUrl, { cache: "no-store" });
        if (res.ok) {
          const text = await res.text();
          if (text && text.trim()) {
            return { text, filename: "atlas.csv" };
          }
        } else if (res.status === 404) {
          try {
            window.localStorage.removeItem(NATIVE_CACHE_KEY);
          } catch {
            /* ignore */
          }
        } else {
          console.warn("[nativeCsv] storage fetch non-ok:", res.status);
        }
      } catch (err) {
        console.warn("[nativeCsv] storage fetch threw", err);
      }
    }
    // 2. Static files under /data
    for (const path of NATIVE_CSV_PATHS) {
      try {
        const res = await fetch(path, { cache: "no-store" });
        if (!res.ok) continue;
        const text = await res.text();
        if (!text || !text.trim()) continue;
        const filename = path.split("/").pop() || path;
        return { text, filename };
      } catch {
        continue;
      }
    }
    return null;
  }, [nativeStorageUrl]);

  /**
   * Hydrate from `localStorage` so the atlas appears instantly on
   * subsequent visits while the in-flight native fetch + parse runs in
   * the background. If the cache is stale or missing, we silently fall
   * through to the network fetch.
   */
  const hydrateFromCache = useCallback((): boolean => {
    if (typeof window === "undefined") return false;
    try {
      const raw = window.localStorage.getItem(NATIVE_CACHE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as {
        text: string;
        filename: string;
        cachedAt: number;
      };
      if (!parsed?.text) return false;
      // Fire-and-forget; setState inside importFromText handles UI.
      void importFromText(parsed.text, parsed.filename, "native");
      try {
        window.localStorage.setItem(
          NATIVE_CACHE_KEY,
          JSON.stringify({
            ...parsed,
            cachedAt: Date.now(),
          }),
        );
      } catch {
        /* quota — ignore */
      }
      return true;
    } catch {
      return false;
    }
  }, [importFromText]);

  const clear = useCallback(() => {
    cancelRef.current.cancelled = true;
    setState((prev) => {
      if (!prev.filename && !prev.rows.length) return prev;
      toast(`Cleared ${prev.rows.length + prev.pending.length} imported entries.`);
      return EMPTY;
    });
    coordCacheRef.current.clear();
    normalizeCacheRef.current.clear();
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(NATIVE_CACHE_KEY);
      } catch {
        /* ignore */
      }
    }
  }, []);

  /**
   * Native auto-loader: on first mount, hydrate from localStorage
   * (instant) and try to fetch a fresher copy from `public/data/`
   * (background). User-uploaded files take precedence — we never
   * overwrite an active user import.
   *
   * When a reference is configured but the storage query resolves to
   * `null` (the user's token — e.g. `csk-…` — is not a Convex `_storage`
   * id nor a URL), we toast a clear "paste the full URL" hint instead
   * of silently falling back. The fallback chain still kicks in
   * behind it for the static `/data/*.csv` files.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1. Instant: paint from the local cache if we have one.
      hydrateFromCache();

      // 2. Background: probe the canonical native paths and refresh.
      try {
        const fetched = await fetchNativeCsv();
        if (cancelled) return;
        if (!fetched) {
          if (NATIVE_CSV_REF && nativeStorageUrl === null) {
            // We configured a reference but the storage query resolved
            // to null — that means the token isn't a Convex storage id.
            // Toast the action the user needs to take.
            toast(
              "Native CSV reference didn't resolve. Paste the full URL in VITE_NATIVE_CSV_URL (or upload the file in the data tab and use VITE_NATIVE_CSV_STORAGE_ID with a real Convex _storage id).",
              { duration: 12_000 },
            );
          }
          return;
        }
        // Don't clobber a manual upload the user just made.
        setState((prev) => {
          if (prev.source === "upload" && prev.rows.length > 0) return prev;
          // Cache the raw text + filename so the next visit hydrates instantly.
          if (typeof window !== "undefined") {
            try {
              window.localStorage.setItem(
                NATIVE_CACHE_KEY,
                JSON.stringify({
                  text: fetched.text,
                  filename: fetched.filename,
                  cachedAt: Date.now(),
                }),
              );
            } catch {
              /* quota — ignore */
            }
          }
          // Run through the shared import pipeline.
          void importFromText(fetched.text, fetched.filename, "native");
          return prev;
        });
      } catch (err) {
        console.warn("[nativeCsv] fetch failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchNativeCsv, hydrateFromCache, importFromText, nativeStorageUrl]);

  // Re-run the cascade on every previously-failed row. We move the failed
  // entries back into pending, reset the failed counter, and bump
  // `retryNonce` so the geocode loop below re-fires without requiring the
  // user to re-upload. Cache holds only successful hits, so this is a
  // genuine fresh attempt for everything that previously couldn't be
  // located.
  const retry = useCallback(() => {
    if (state.failed.length === 0) return;
    const count = state.failed.length;
    toast(`Retrying ${count} geocode${count === 1 ? "" : "s"}…`);
    setState((prev) => {
      const moved = prev.failed.map((f) => ({
        id: f.id,
        doc: { ...f.doc, needsGeocode: true },
      }));
      return {
        ...prev,
        failed: [],
        pending: [...prev.pending, ...moved],
        retryNonce: prev.retryNonce + 1,
        progress: {
          ...prev.progress,
          total: prev.progress.total + prev.failed.length,
          failed: 0,
          geminiSkipped: 0,
          geminiError: 0,
          active: true,
        },
      };
    });
  }, [state.failed.length]);

  // Geocode loop. Runs whenever a brand-new upload lands (signaled by
  // importedAt) OR the user fires a Retry (signaled by retryNonce).
  //
  // Per-row flow (Gemini-first):
  //   1. Coord-cache hit on the raw address? — instant place, done.
  //   2. Gemini normalize FIRST. The model reformats the row into a
  //      standard address, fills missing city/state from Atlanta context,
  //      and may resolve local landmark references to their real
  //      addresses. The cleaned fragment is cached so re-imports /
  //      Retry don't double-charge the model.
  //   3. Run the deterministic cascade (structured Nominatim → relaxed
  //      → Atlanta zip-centroid table → Zippopotam.us) using the cleaned
  //      fragment. If Gemini was used AND the cascade returned anything,
  //      `coordAccuracy = "gemini-fixup"` so the user knows the AI parser
  //      was on the path (even if the cascade found it cleanly).
  useEffect(() => {
    if (!state.pending.length) return;
    if (!state.progress.active) return;
    const cancel = cancelRef.current;
    // Snapshot identifiers so a trailing setState from this loop can't
    // pollute a freshly-imported or cleared state — any later setState
    // bails when either ID has rotated forward.
    const snapImportedAt = state.importedAt;
    const snapRetryNonce = state.retryNonce;

    const run = async () => {
      // Local accumulators. Stays empty for retry passes whose `state.rows`
      // already has rows visible to the user — those flush inline below in
      // the inner setState. For the INITIAL pre-validation pass (when
      // `state.rows` started empty), this is what gets flushed at the end.
      const placedAcc: AtlasAsset[] = [];
      const failedAcc: Array<{
        id: string;
        reason: string;
        doc: AtlasAsset;
      }> = [];
      const consumedIds = new Set<string>();

      /**
       * Single cancel-aware flush point. Called at end-of-pass to release
       * the validated set to the map + chat, or on cancel to leave the
       * state untouched (the user explicitly aborted).
       */
      const flush = (placed: AtlasAsset[], failed: typeof failedAcc) => {
        setState((prev) => {
          if (cancel.cancelled) return prev;
          if (prev.importedAt !== snapImportedAt) return prev;
          if (prev.retryNonce !== snapRetryNonce) return prev;
          // Restore the held chatOnly (PO Box / address-only) rows now
          // that every pending row has been processed by MapChat. Retry
          // passes never touch chatOnly (it was already restored on the
          // initial flush); heldChatOnlyRef stays empty until the next
          // importFromText.
          const restoreChatOnly = heldChatOnlyRef.current;
          heldChatOnlyRef.current = [];
          if (!placed.length && !failed.length && !restoreChatOnly.length) {
            return prev.released
              ? prev
              : {
                  ...prev,
                  chatOnly: restoreChatOnly,
                  released: true,
                  progress: { ...prev.progress, active: false },
                };
          }
          return {
            ...prev,
            rows: [...prev.rows, ...placed],
            failed: [...prev.failed, ...failed],
            chatOnly: restoreChatOnly,
            progress: {
              ...prev.progress,
              failed: prev.progress.failed + failed.length,
            },
            released: true, // gate opens on the first flush
          };
        });
      };

      for (let i = 0; i < state.pending.length; i++) {
        if (cancel.cancelled) return;
        const item = state.pending[i];
        const doc = item.doc;
        const key = doc.geoKey || "";
        const rawStreet = (doc.address ?? "").trim();

        let coord: { lat: number; lng: number } | null = null;
        let accuracy: CoordAccuracy | null = null;
        let source: "cached" | "fetched" | "gemini-fixup" | null = null;
        let llmOutcome: "cleaned" | "skipped" | "errored" | null = null;
        let geminiAttempted = false;
        // Whichever provider answered this row's MapChat call. Stays null
        // until `geminiAttempted` is true.
        let lastProviderLabel: string | null = null;

        // Step 1: coord-cache hit on raw address → instant place.
        if (key && coordCacheRef.current.has(key)) {
          const cached = coordCacheRef.current.get(key)!;
          coord = { lat: cached.lat, lng: cached.lng };
          accuracy = cached.accuracy;
          source = "cached";
        }

        // Step 2: Gemini normalize FIRST (skip if no street OR no key).
        let addressForGeocode: AddressFragment = {
          street: doc.address ?? "",
          city: doc.city ?? "",
          state: doc.state ?? "",
          postalcode: doc.postalCode ?? "",
          country: doc.country || "USA",
        };

        if (!coord && rawStreet.length > 0 && key) {
          const cleanCacheKey = `clean:${key}`;
          const cachedClean = normalizeCacheRef.current.get(cleanCacheKey);
          let cleaned: {
            ok: true;
            street: string;
            city?: string;
            state?: string;
            postalcode?: string;
          } | null = null;

          if (cachedClean && cachedClean.ok) {
            cleaned = cachedClean;
            llmOutcome = "cleaned";
          } else if (cachedClean && !cachedClean.ok) {
            // Cached "Gemini refused" — skip the model call entirely.
            llmOutcome = "skipped";
          } else {
            geminiAttempted = true;
            // Log the outgoing call so the user can verify in DevTools
            // that the action is firing, and which row is on the wire.
            // Counter surfacing in the chat panel header is the
            // visible companion to this log; the console line is the
            // forensic check.
            console.info(
              `[atlas/llm-normalize] calling MapChat for "${doc.name}" (#${
                i + 1
              }/${state.pending.length}); raw street = "${rawStreet}", zip = "${
                doc.postalCode ?? ""
              }"`,
            );
            try {
              const clean = await normalizeAddress({
                rawStreet,
                rawCity: doc.city,
                rawState: doc.state,
                rawPostalCode: doc.postalCode,
                assetName: doc.name,
                knownCity: "Atlanta",
                knownState: "GA",
                knownCountry: "USA",
              });
              console.info(
                `[atlas/llm-normalize] MapChat returned for "${doc.name}":`,
                {
                  ok: !!clean.ok,
                  provider: clean.providerLabel ?? null,
                  street: clean.street ?? null,
                  city: clean.city ?? null,
                  state: clean.state ?? null,
                  postalcode: clean.postalcode ?? null,
                  confidence: clean.confidence ?? null,
                  error: clean.error ?? null,
                },
              );
              if (clean.ok && clean.street) {
                cleaned = {
                  ok: true,
                  street: clean.street,
                  city: clean.city,
                  state: clean.state,
                  postalcode: clean.postalcode,
                };
                normalizeCacheRef.current.set(cleanCacheKey, cleaned);
                llmOutcome = "cleaned";
                if (clean.providerLabel) lastProviderLabel = clean.providerLabel;
              } else if (
                clean.error &&
                /offline|timeout|not set|rejected|unparseable|returned|5\d\d|4\d\d/i.test(
                  clean.error,
                )
              ) {
                llmOutcome = "errored";
                normalizeCacheRef.current.set(cleanCacheKey, {
                  ok: false,
                });
                // Surface the MapChat key state in the chip so the user
                // can tell at a glance whether the dedicated map key was
                // configured but rate-limited, or simply not set.
                if (/MapChat.*offline|MAP_CHAT_KEY/i.test(clean.error)) {
                  lastProviderLabel = "MapChat · offline";
                }
              } else {
                llmOutcome = "skipped";
                normalizeCacheRef.current.set(cleanCacheKey, {
                  ok: false,
                });
              }
            } catch (err) {
              console.warn("[llm-normalize] threw", err);
              llmOutcome = "errored";
            }
          }

          if (cleaned) {
            addressForGeocode = {
              street: cleaned.street,
              city: cleaned.city ?? addressForGeocode.city,
              state: cleaned.state ?? addressForGeocode.state,
              postalcode: cleaned.postalcode ?? addressForGeocode.postalcode,
              country: "USA",
            };
          }
        }

        // Step 3: deterministic cascade on the chosen address.
        if (!coord) {
          try {
            const result = await geocode({
              street: addressForGeocode.street,
              city: addressForGeocode.city,
              state: addressForGeocode.state,
              postalcode: addressForGeocode.postalcode,
              country: addressForGeocode.country,
            });
            if (result) {
              coord = { lat: result.lat, lng: result.lng };
              // If Gemini was used on this row, mark it as a gemini-fixup
              // for transparency — even when the cascade returned `exact`.
              accuracy =
                llmOutcome === "cleaned" ? "gemini-fixup" : result.accuracy;
              source = llmOutcome === "cleaned" ? "gemini-fixup" : "fetched";
              if (key) {
                coordCacheRef.current.set(key, {
                  lat: result.lat,
                  lng: result.lng,
                  accuracy,
                });
              }
            }
          } catch (err) {
            console.warn("[geocode] action threw", err);
          }
        }

        if (cancel.cancelled) return;

        // Accumulate locally for the flush.
        if (coord && accuracy) {
          placedAcc.push({
            ...doc,
            lat: coord.lat,
            lng: coord.lng,
            needsGeocode: false,
            coordAccuracy: accuracy,
          });
        } else {
          failedAcc.push({
            id: item.id,
            reason: key
              ? `Could not locate "${doc.address}, ${doc.city}, ${doc.state} ${doc.postalCode}".`
              : "Row has no street or ZIP for geocoding.",
            doc,
          });
        }
        consumedIds.add(item.id);

        // Per-row setState only updates progress + consumes one slot from
        // `state.pending`. The actual rows / failed are flushed at the end
        // so the pre-validation gate stays closed until EVERY pending row
        // has been processed.
        setState((prev) => {
          if (cancel.cancelled) return prev;
          if (prev.importedAt !== snapImportedAt) return prev;
          if (prev.retryNonce !== snapRetryNonce) return prev;

          const remainingPending = prev.pending.filter(
            (p) => p.id !== item.id,
          );
          const done = prev.progress.done + 1;
          return {
            ...prev,
            pending: remainingPending,
            progress: {
              ...prev.progress,
              done,
              cached:
                prev.progress.cached + (source === "cached" ? 1 : 0),
              exact:
                prev.progress.exact +
                (source === "fetched" && accuracy === "exact" ? 1 : 0),
              relaxed:
                prev.progress.relaxed +
                (source === "fetched" && accuracy === "relaxed" ? 1 : 0),
              zipCentroid:
                prev.progress.zipCentroid +
                (source === "fetched" && accuracy === "zip-centroid"
                  ? 1
                  : 0),
              geminiCleaned:
                prev.progress.geminiCleaned +
                (llmOutcome === "cleaned" ? 1 : 0),
              geminiSkipped:
                prev.progress.geminiSkipped +
                (llmOutcome === "skipped" ? 1 : 0),
              geminiError:
                prev.progress.geminiError +
                (llmOutcome === "errored" ? 1 : 0),
              geminiCallsMade:
                prev.progress.geminiCallsMade + (geminiAttempted ? 1 : 0),
              mapProviderLabel:
                geminiAttempted && lastProviderLabel
                  ? lastProviderLabel
                  : prev.progress.mapProviderLabel,
              active: remainingPending.length > 0,
            },
          };
        });

        // Honor Nominatim usage policy: ≤ 1 req/sec, with a little slack.
        // Skip the sleep when the result came from cache or the local zip
        // table (instant hits).
        if (source === "fetched") {
          await new Promise((r) => setTimeout(r, NOMINATIM_SPACING_MS));
        }
        // Slow the Gemini call cadence to stay well below common free-tier
        // per-minute caps when parsing every row.
        if (geminiAttempted) {
          await new Promise((r) =>
            setTimeout(r, DEFAULT_LLM_NORMALIZE_SPACING_MS),
          );
        }
      }

      // Post-loop flush. Snapshot checks inside `flush()` guard against
      // races where the user cleared or re-imported mid-pass.
      flush(placedAcc, failedAcc);
    };

    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.importedAt, state.retryNonce]);

  const value = useMemo<ImportedContextValue>(
    () => ({
      state,
      importing,
      geocoding: state.progress.active,
      importFromFile,
      retry,
      clear,
    }),
    [state, importing, importFromFile, retry, clear],
  );

  return (
    <ImportedContext.Provider value={value}>
      {children}
    </ImportedContext.Provider>
  );
}

export function useImportedData() {
  const v = useContext(ImportedContext);
  if (!v)
    throw new Error("useImportedData must be used within <ImportedDataProvider>");
  return v;
}

export type AnyAsset = LocationDoc | AtlasAsset;

/**
 * Group of assets that share the same address. The map renders ONE marker
 * per cluster (with a count badge); the picker card lists member rows so
 * the user can drill into any one of them.
 *
 * Coordinates are taken from the first member (cluster members always share
 * the same lat/lng after geocoding — the same address resolves to one point).
 */
export type Cluster = {
  /** Stable normalized address key. */
  key: string;
  /** Display address used for the picker header. */
  address: string;
  city: string;
  state: string;
  postalCode: string;
  lat: number;
  lng: number;
  members: AnyAsset[];
  count: number;
};

/**
 * Normalize an address for cluster-key comparison. We collapse case +
 * trim and join `address | city | state | postal`. Lightweight (no
 * geocoder normalization) — sufficient for "two CSVs that say the same
 * address share a cluster" while still letting trivially different
 * addresses land in separate clusters.
 */
export function clusterKeyOf(a: Pick<AnyAsset, "address" | "city" | "state" | "postalCode">): string {
  const norm = (s?: string) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return [norm(a.address), norm(a.city), norm(a.state), norm(a.postalCode)]
    .filter(Boolean)
    .join("|");
}

/**
 * Group assets by normalized address key. Single-member clusters are still
 * returned (with count=1) so the map/grid can render them consistently.
 *
 * Order is preserved: the first member of each cluster becomes its
 * representative. Assets without an address/city fall into their own
 * single-member cluster keyed differently so they never merge by accident.
 */
export function clusterByAddress(assets: AnyAsset[]): Cluster[] {
  const buckets = new Map<string, { cluster: Cluster }>();
  for (const a of assets) {
    const key = clusterKeyOf(a);
    const exist = buckets.get(key);
    if (exist) {
      exist.cluster.members.push(a);
      exist.cluster.count = exist.cluster.members.length;
    } else {
      buckets.set(key, {
        cluster: {
          key,
          address: a.address ?? "",
          city: a.city ?? "",
          state: a.state ?? "",
          postalCode: a.postalCode ?? "",
          lat: a.lat,
          lng: a.lng,
          members: [a],
          count: 1,
        },
      });
    }
  }
  return Array.from(buckets.values()).map((b) => b.cluster);
}

/** Union seeded + imported with the imported overriding seeded by slug
 *  (case-insensitive). Seeded order is preserved; brand-new imports append.
 *  Rows with non-finite lat/lng remain in `chatOnly` so the chat can still
 *  answer about them without showing ghost pins on the map.
 *  Pass `replace: true` when the user wants their upload to fully replace
 *  the curated default assets (e.g. a custom asset map). */
export function mergeAssets(
  seeded: LocationDoc[],
  imported: AtlasAsset[],
  chatOnly: AtlasAsset[] = [],
  options: { replace?: boolean } = {},
): { mappable: AnyAsset[]; chatOnly: AnyAsset[] } {
  const importedByLower = new Map<string, AtlasAsset>();
  for (const i of imported) importedByLower.set(i.slug.toLowerCase(), i);

  const mappable: AnyAsset[] = [];
  const consumed = new Set<string>();

  if (!options.replace) {
    for (const s of seeded) {
      const k = s.slug.toLowerCase();
      const override = importedByLower.get(k);
      if (override) {
        mappable.push({ ...s, ...override });
        consumed.add(k);
      } else {
        mappable.push(s);
      }
    }
  }
  for (const i of imported) {
    if (!consumed.has(i.slug.toLowerCase())) mappable.push(i);
  }

  return { mappable, chatOnly: [...chatOnly] };
}
