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
  parsePriceTierText,
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
  /** Rows that the Cerebras AI cleanup successfully returned and the
   *  cascade then accepted. */
  cerebrasCleaned: number;
  /** Rows Cerebras returned ok=false for (no fabrication, gave up). */
  cerebrasSkipped: number;
  /** Rows where the Cerebras call itself errored (transient). */
  cerebrasError: number;
  /** Number of times we've actually hit the map-side `normalizeAddress`
   *  action (whether the result was a clean, skip, or error). Surfaced in
   *  the UI so the user can see the API is being called and how many
   *  calls have happened so far in this pass. */
  cerebrasCallsMade: number;
  /** Whichever Cerebras model answered the last successful map call.
   *  Surfaced in the chip so the user can tell at a glance which key
   *  (and which model) powered the normalizer ("Cerebras · gpt-oss-120b"
   *  when configured, "Cerebras · offline" when the key is unset or
   *  rejected). Gemini is no longer in the map chain. */
  cerebrasModelLabel: string | null;
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
   *  running Cerebras `normalizeAddress` + the geocode cascade over every
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
  cerebrasCleaned: 0,
  cerebrasSkipped: 0,
  cerebrasError: 0,
  cerebrasCallsMade: 0,
  cerebrasModelLabel: null,
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

  // Cache successful Cerebras normalizations keyed by rawStreet + geoKey so
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
   * Cerebras `normalizeAddress` action runs as Step 2 of every pending
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

      setState({
        // Rows already carrying lat/lng land in `rows` immediately.
        // Address-only / PO-Box rows land in `chatOnly` immediately too.
        // Pending rows paint dots one-by-one as the geocode loop runs
        // (see the per-row setState below), so the map never sits empty
        // during the pre-validation pass.
        rows: ready,
        pending,
        chatOnly,
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
          cerebrasCleaned: 0,
          cerebrasSkipped: 0,
          cerebrasError: 0,
          cerebrasCallsMade: 0,
          cerebrasModelLabel: null,
          failed: 0,
          active: pendingCount > 0,
        },
        source,
        released: true,
      });

      cancelRef.current.cancelled = false;

      const skipped = summary.rejected;
      const placed = readyCount + chatOnlyCount;
      const pendingNote =
        pendingCount > 0
          ? ` · ${pendingCount} more address${pendingCount === 1 ? "" : "es"} plotting…`
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
   * The atlas's canonical data lives inside `convex/locations.ts`
   * (`SEED_LOCATIONS`) and is returned to us already-translated via
   * `api.locations.list`. There is no per-environment CSV fetch to do
   * here, so this provider is now strictly a placeholder for
   * future user-upload flows.
   */
  const clear = useCallback(() => {
    cancelRef.current.cancelled = true;
    setState((prev) => {
      if (!prev.filename && !prev.rows.length) return prev;
      toast(`Cleared ${prev.rows.length + prev.pending.length} imported entries.`);
      return EMPTY;
    });
    coordCacheRef.current.clear();
    normalizeCacheRef.current.clear();
  }, []);

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
          cerebrasSkipped: 0,
          cerebrasError: 0,
          active: true,
        },
      };
    });
  }, [state.failed.length]);

  // Geocode loop. Runs whenever a brand-new upload lands (signaled by
  // importedAt) OR the user fires a Retry (signaled by retryNonce).
  //
  // Per-row flow (Cerebras-first):
  //   1. Coord-cache hit on the raw address? — instant place, done.
  //   2. Cerebras normalize FIRST. The model reformats the row into a
  //      standard address, fills missing city/state from Atlanta context,
  //      and may resolve local landmark references to their real
  //      addresses. The cleaned fragment is cached so re-imports /
  //      Retry don't double-charge the model.
  //   3. Run the deterministic cascade (structured Nominatim → relaxed
  //      → Atlanta zip-centroid table → Zippopotam.us) using the cleaned
  //      fragment. If Cerebras was used AND the cascade returned
  //      anything, `coordAccuracy = "cerebras-fixup"` so the user knows
  //      the AI parser was on the path (even when the cascade found it
  //      cleanly).
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
      /**
       * Progressive reveal: each successful row is appended to `state.rows`
       * in the per-row setState below so the map starts plotting dots as
       * soon as the first row clears geocoding. Failed rows are appended
       * to `state.failed` so the Retry chip appears immediately too. The
       * loop no longer needs a post-pass flush since `state.rows` /
       * `state.failed` stay in sync row-by-row.
       */

      for (let i = 0; i < state.pending.length; i++) {
        if (cancel.cancelled) return;
        const item = state.pending[i];
        const doc = item.doc;
        const key = doc.geoKey || "";
        const rawStreet = (doc.address ?? "").trim();

        let coord: { lat: number; lng: number } | null = null;
        let accuracy: CoordAccuracy | null = null;
        let source: "cached" | "fetched" | "cerebras-fixup" | null = null;
        let llmOutcome: "cleaned" | "skipped" | "errored" | null = null;
        let cerebrasAttempted = false;
        // Whichever Cerebras model answered this row's map call. Stays
        // null until `cerebrasAttempted` is true.
        let lastProviderLabel: string | null = null;

        // Step 1: coord-cache hit on raw address → instant place.
        if (key && coordCacheRef.current.has(key)) {
          const cached = coordCacheRef.current.get(key)!;
          coord = { lat: cached.lat, lng: cached.lng };
          accuracy = cached.accuracy;
          source = "cached";
        }

        // Step 2: Cerebras normalize FIRST (skip if no street OR no key).
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
            // Cached "Cerebras refused" — skip the model call entirely.
            llmOutcome = "skipped";
          } else {
            cerebrasAttempted = true;
            // Log the outgoing call so the user can verify in DevTools
            // that the action is firing, and which row is on the wire.
            // Counter surfacing in the chat panel header is the
            // visible companion to this log; the console line is the
            // forensic check.
            console.info(
              `[atlas/llm-normalize] calling Cerebras for "${doc.name}" (#${
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
                `[atlas/llm-normalize] Cerebras returned for "${doc.name}":`,
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
                // Surface the Cerebras key state in the chip so the user
                // can tell at a glance whether the dedicated map key is
                // configured but rate-limited, or simply not set. Gemini
                // is no longer in the map chain, so the only "offline"
                // label we emit here is the Cerebras one.
                if (/Cerebras.*offline|CEREBRAS_API_KEY/i.test(clean.error)) {
                  lastProviderLabel = "Cerebras · offline";
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
              // If Cerebras was used on this row, mark it as a
              // cerebras-fixup for transparency — even when the cascade
              // returned `exact`.
              accuracy =
                llmOutcome === "cleaned" ? "cerebras-fixup" : result.accuracy;
              source = llmOutcome === "cleaned" ? "cerebras-fixup" : "fetched";
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

        // Decide this row's destination. Successful rows go into
        // `state.rows` immediately so the map plots them as they come in;
        // failed rows land in `state.failed` so the Retry chip surfaces
        // the moment geocoding is exhausted.
        const placedDoc: AtlasAsset | null =
          coord && accuracy
            ? {
                ...doc,
                lat: coord.lat,
                lng: coord.lng,
                needsGeocode: false,
                coordAccuracy: accuracy,
              }
            : null;
        const failedItem: {
          id: string;
          reason: string;
          doc: AtlasAsset;
        } | null =
          !placedDoc
            ? {
                id: item.id,
                reason: key
                  ? `Could not locate "${doc.address}, ${doc.city}, ${doc.state} ${doc.postalCode}".`
                  : "Row has no street or ZIP for geocoding.",
                doc,
              }
            : null;

        // Per-row setState appends to `state.rows` / `state.failed` and
        // consumes one slot from `state.pending` in the same commit, so
        // the map + chat update incrementally as the loop runs instead of
        // waiting for the entire pass to complete.
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
            rows: placedDoc ? [...prev.rows, placedDoc] : prev.rows,
            failed: failedItem
              ? [...prev.failed, failedItem]
              : prev.failed,
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
              cerebrasCleaned:
                prev.progress.cerebrasCleaned +
                (llmOutcome === "cleaned" ? 1 : 0),
              cerebrasSkipped:
                prev.progress.cerebrasSkipped +
                (llmOutcome === "skipped" ? 1 : 0),
              cerebrasError:
                prev.progress.cerebrasError +
                (llmOutcome === "errored" ? 1 : 0),
              cerebrasCallsMade:
                prev.progress.cerebrasCallsMade + (cerebrasAttempted ? 1 : 0),
              cerebrasModelLabel:
                cerebrasAttempted && lastProviderLabel
                  ? lastProviderLabel
                  : prev.progress.cerebrasModelLabel,
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
        // Slow the Cerebras call cadence to stay well below common
        // free-tier per-minute caps when parsing every row. (Cerebras
        // is much more permissive than flash Gemini, but a 4 s default
        // keeps the user-visible call counter legible while also
        // avoiding rate limits on noisy 100-row imports.)
        if (cerebrasAttempted) {
          await new Promise((r) =>
            setTimeout(r, DEFAULT_LLM_NORMALIZE_SPACING_MS),
          );
        }
      }

      // No post-loop flush needed — every row was already appended to
      // `state.rows` / `state.failed` by the per-row setState above, so
      // the map and chat stay in sync row-by-row. The last iteration's
      // setState will also flip `progress.active` to false once `pending`
      // drains to zero.
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
 * Working-hours template applied to every seed row. The embedded SEED_LOCATIONS
 * in convex/locations.ts don't ship hourly data, but the renderer always
 * expects the shape so the chat panel can ask "open now?" without crashing.
 * We use a neutral "—" token so `isOpenAt()` returns false (correctly
 * surfacing the row as closed) while keeping the type checker happy.
 */
const SEED_DEFAULT_HOURS: AtlasAsset["hours"] = {
  mon: { open: "—", close: "—" },
  tue: { open: "—", close: "—" },
  wed: { open: "—", close: "—" },
  thu: { open: "—", close: "—" },
  fri: { open: "—", close: "—" },
  sat: { open: "—", close: "—" },
  sun: { open: "—", close: "—" },
};

/**
 * Translate the CSV-shape rows the user keeps in `src/convex/locations.ts`
 * into the canonical AtlasAsset shape the rest of the app reads. The
 * schema intentionally stores raw spreadsheet column names
 * (`assetNameOrOrganization`, `communityAssetType`, `zipCode`, etc.) so
 * the same source file mirrors the HUD-style spreadsheet verbatim, but
 * the renderer needs the friendly fields (`name`, `category`,
 * `postalCode`, `lat`, `lng`, `coordAccuracy`, `priceTier`, …). This
 * adapter runs client-side, uses the hand-coded lat/lng already on the
 * embedded rows, and does not call any geocoder — so the embedded
 * "native" data lands on the map instantly with no token cost.
 *
 * Empty cells are tolerated: missing contact / website / coords produce
 * `undefined` (rather than empty strings) so the LocationCard can hide
 * the phone / email / web rows entirely. The priceTier uses the same
 * "Free / Sliding / Paid" text classifier as the upload importer, so
 * "Free" and "free" both map to tier 0.
 */
export function seedLocationsToAtlasAssets(rows: Array<any>): AtlasAsset[] {
  return rows.map((r) => {
    const lat =
      typeof r.lat === "number" && Number.isFinite(r.lat) ? r.lat : NaN;
    const lng =
      typeof r.lng === "number" && Number.isFinite(r.lng) ? r.lng : NaN;
    const services = (r.servicesResourcesAvailable ?? "").toString().trim();
    const notes = (r.notesObservations ?? "").toString().trim();
    // Concatenate the user-facing "Services / Resources Available" and the
    // "Notes & Observations" so the long-form description the chat surfaces
    // contains both. We omit either side when empty to avoid dangling
    // blank paragraphs.
    const description = [services, notes].filter(Boolean).join("\n\n");
    const slug = r.slug ?? "";
    return {
      _id: `seeded:${slug}`,
      _creationTime: 0,
      slug,
      name: r.assetNameOrOrganization ?? "",
      tagline: r.communityAssetType ?? "",
      category: (r.communityAssetType ?? "community-center")
        .toString()
        .toLowerCase(),
      rating: 0,
      reviewCount: 0,
      priceTier: parsePriceTierText(r.priceAffordability ?? "", 0),
      description,
      address: r.address ?? "",
      city: r.city ?? "Atlanta",
      state: r.state ?? "GA",
      country: "USA",
      postalCode: r.zipCode ?? "",
      lat,
      lng,
      hours: SEED_DEFAULT_HOURS,
      features: [],
      openedYear: new Date().getFullYear(),
      signatureDrink: "—",
      website: r.website || undefined,
      socialMedia: r.socialMedia || undefined,
      contactName: r.keyContact || undefined,
      contactPhone: r.contactPhone || undefined,
      contactEmail: r.contactEmail || undefined,
      needsGeocode: false,
      coordAccuracy: r.coordAccuracy ?? (Number.isFinite(lat) ? "exact" : undefined),
    } satisfies AtlasAsset;
  });
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
    // Skip rows that lack finite lat/lng — they came from a SEED_LOCATIONS
    // entry (or a CSV import) that wasn't geocoded yet, so dropping them
    // here keeps Leaflet's Marker from choking on `Invalid LatLng (NaN,
    // NaN)`. The rows remain in `merged.mappable` so the sheet view and
    // chat search still see them.
    if (!Number.isFinite(a.lat) || !Number.isFinite(a.lng)) continue;
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
