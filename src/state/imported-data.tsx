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
  totalParsed: 0,
  rejected: 0,
  progress: EMPTY_PROGRESS,
};

type ImportedContextValue = {
  state: ImportedState;
  importing: boolean;
  geocoding: boolean;
  importFromFile: (file: File) => Promise<void>;
  clear: () => void;
};

const ImportedContext = createContext<ImportedContextValue | null>(null);

// Nominatim public usage policy: ≤ 1 req/sec. We add a tiny slack of 100ms.
// Note: Atlanta-zip hits return instantly without a network call, so they
// won't trigger the spacing sleep.
const NOMINATIM_SPACING_MS = 1100;

export function ImportedDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ImportedState>(EMPTY);
  const [importing, setImporting] = useState(false);
  const geocode = useAction(api.geocode.geocodeAddress);

  // Cache by normalized address key so repeated rows are instant.
  const coordCacheRef = useRef<
    Map<string, { lat: number; lng: number; accuracy: CoordAccuracy }>
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
        totalParsed: summary.totalParsed,
        rejected: summary.rejected,
        progress: {
          total: pendingCount,
          done: 0,
          cached: 0,
          exact: 0,
          relaxed: 0,
          zipCentroid: 0,
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
  }, []);

  // Geocode loop. Runs whenever a brand-new upload lands (signaled by
  // importedAt). Uses the multi-tier cascade returned by the action.
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

        let coord: { lat: number; lng: number } | null = null;
        let accuracy: CoordAccuracy | null = null;
        let source: "cached" | "fetched" | "zippo" | null = null;

        if (key && coordCacheRef.current.has(key)) {
          const cached = coordCacheRef.current.get(key)!;
          coord = { lat: cached.lat, lng: cached.lng };
          accuracy = cached.accuracy;
          source = "cached";
        } else {
          try {
            const result = await geocode({
              street: doc.address,
              city: doc.city,
              state: doc.state,
              postalcode: doc.postalCode,
              country: doc.country || "USA",
            });
            if (result) {
              coord = { lat: result.lat, lng: result.lng };
              accuracy = result.accuracy;
              source = "fetched";
              if (key) {
                coordCacheRef.current.set(key, {
                  lat: result.lat,
                  lng: result.lng,
                  accuracy: result.accuracy,
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
      }
    };

    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.importedAt]);

  const value = useMemo<ImportedContextValue>(
    () => ({
      state,
      importing,
      geocoding: state.progress.active,
      importFromFile,
      clear,
    }),
    [state, importing, importFromFile, clear],
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
