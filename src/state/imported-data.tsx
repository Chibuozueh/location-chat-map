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
import { useAction } from "convex/react";
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
// Stay well under common free-tier per-minute caps (e.g. Gemini 15 RPM).
const LLM_NORMALIZE_SPACING_MS = 8_000;

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

  const importFromFile = useCallback(async (file: File) => {
    setImporting(true);
    cancelRef.current.cancelled = false;
    try {
      const text = await file.text();
      const summary = importCsv(text, file.name);
      const readyCount = summary.rows.length;
      const pendingCount = summary.pending.length;
      const chatOnlyCount = summary.chatOnly.length;

      if (!readyCount && !pendingCount && !chatOnlyCount) {
        toast.error(
          `No valid rows in ${file.name}. Each row needs at least a Name.`,
        );
        return;
      }

      const ready = summary.rows.map((r) => r.doc);
      const pending = summary.pending.map((r, i) => ({
        id: `${i}-${r.doc.slug}`,
        doc: r.doc,
      }));
      const chatOnly = summary.chatOnly.map((r) => r.doc);

      setState({
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
          geminiCleaned: 0,
          geminiSkipped: 0,
          geminiError: 0,
          failed: 0,
          active: pendingCount > 0,
        },
      });

      const skipped = summary.rejected;
      const placed = readyCount + chatOnlyCount;
      const pendingNote =
        pendingCount > 0 ? ` · geocoding ${pendingCount}` : "";
      const chatOnlyNote =
        chatOnlyCount > 0 ? ` · ${chatOnlyCount} address-only` : "";
      toast.success(
        `Showing only your uploaded data: ${placed} ${placed === 1 ? "row" : "rows"} from ${file.name}` +
          (skipped ? ` · ${skipped} skipped` : "") +
          chatOnlyNote +
          pendingNote,
      );
    } catch (err) {
      console.error("CSV import error", err);
      toast.error(
        `Couldn't parse ${file.name}. Make sure it's a CSV or TSV file.`,
      );
    } finally {
      setImporting(false);
    }
  }, []);

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

    const run = async () => {
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

        setState((prev) => {
          if (cancel.cancelled) return prev;
          if (prev.importedAt !== state.importedAt) return prev;

          const remainingPending = prev.pending.filter(
            (p) => p.id !== item.id,
          );
          let nextRows = prev.rows;
          if (coord && accuracy) {
            const placed: AtlasAsset = {
              ...doc,
              lat: coord.lat,
              lng: coord.lng,
              needsGeocode: false,
              coordAccuracy: accuracy,
            };
            nextRows = [...prev.rows, placed];
          } else {
            prev.failed.push({
              id: item.id,
              reason: key
                ? `Could not locate "${doc.address}, ${doc.city}, ${doc.state} ${doc.postalCode}".`
                : "Row has no street or ZIP for geocoding.",
              doc,
            });
          }

          const done = prev.progress.done + 1;
          return {
            ...prev,
            rows: nextRows,
            pending: remainingPending,
            failed: prev.failed,
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
              failed: !coord ? prev.progress.failed + 1 : prev.progress.failed,
              active: done < prev.progress.total,
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
          await new Promise((r) => setTimeout(r, LLM_NORMALIZE_SPACING_MS));
        }
      }
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
