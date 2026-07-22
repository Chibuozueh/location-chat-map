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
  type ImportSummary,
  importCsv,
} from "@/lib/csv-import";
import type { LocationDoc } from "@/components/atlas/types";
import { api } from "@/convex/_generated/api";

export type GeocodeProgress = {
  total: number; // pending at start of pass
  done: number; // finished (cached + fetched + failed)
  cached: number;
  fetched: number;
  failed: number;
  active: boolean;
};

type ImportedState = {
  rows: AtlasAsset[]; // rows with valid lat/lng that are queryable + mappable
  pending: Array<{
    /** Stable id used as React key + savedResultsMap key. */
    id: string;
    doc: AtlasAsset; // has lat = NaN, lng = NaN until geocoded
  }>;
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
  fetched: 0,
  failed: 0,
  active: false,
};

const EMPTY: ImportedState = {
  rows: [],
  pending: [],
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

// Pin Atlanta metro so a single cached fallback exists for "no street but
// known city/zips". These are NOT used to fabricate map pins for unknown
// addresses — they're a fallback only when an address-level hit fails AND
// the user wants it. Currently we drop them instead (more honest), but the
// constants are here for future use.
//
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ATLANTA_FALLBACK_COORDS = { lat: 33.749, lng: -84.388 };

// Nominatim public usage policy: ≤ 1 req/sec. We add a tiny slack of 100ms.
const NOMINATIM_SPACING_MS = 1100;

export function ImportedDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ImportedState>(EMPTY);
  const [importing, setImporting] = useState(false);
  const geocode = useAction(api.geocode.geocodeAddress);

  // Cache by canonical address key (street|postalcode) so repeated rows
  // are instant. We persist this cache across the session, not across
  // reloads.
  const coordCacheRef = useRef<Map<string, { lat: number; lng: number }>>(
    new Map(),
  );

  // The geocode loop is keyed off the pending list length so an external
  // `clear()` aborts it cleanly.
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const importFromFile = useCallback(async (file: File) => {
    setImporting(true);
    cancelRef.current.cancelled = false;
    try {
      const text = await file.text();
      const summary = importCsv(text, file.name);
      const readyCount = summary.rows.length;
      const pendingCount = summary.pending.length;

      if (!readyCount && !pendingCount) {
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

      setState({
        rows: ready,
        pending,
        failed: [],
        filename: summary.filename,
        importedAt: Date.now(),
        totalParsed: summary.totalParsed,
        rejected: summary.rejected,
        progress: {
          total: pendingCount,
          done: 0,
          cached: 0,
          fetched: 0,
          failed: 0,
          active: pendingCount > 0,
        },
      });

      // First message describes what just landed.
      const skipped = summary.rejected;
      const placed = readyCount;
      const pendingNote =
        pendingCount > 0 ? ` · geocoding ${pendingCount}` : "";
      toast.success(
        `Showing only your uploaded data: ${placed} ${placed === 1 ? "row" : "rows"} from ${file.name}` +
          (skipped ? ` · ${skipped} skipped` : "") +
          pendingNote,
      );
    } catch (err) {
      console.error("CSV import error", err);
      toast.error(`Couldn't parse ${file.name}. Make sure it's a CSV or TSV file.`);
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

  // Geocode loop. We re-run whenever a new set of pending items appears
  // (signaled by filename + importedAt). Uses an internal cursor so we
  // don't lose progress if React re-renders.
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
        let source: "cached" | "fetched" | null = null;

        if (key && coordCacheRef.current.has(key)) {
          coord = coordCacheRef.current.get(key)!;
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
              source = "fetched";
              if (key) coordCacheRef.current.set(key, coord);
            }
          } catch (err) {
            console.warn("[geocode] action threw", err);
          }
        }

        if (cancel.cancelled) return;

        setState((prev) => {
          if (cancel.cancelled) return prev;
          // If the imported set has been replaced (clear+reupload) bail.
          if (prev.importedAt !== state.importedAt) return prev;

          const remainingPending = prev.pending.filter((p) => p.id !== item.id);
          let nextRows = prev.rows;
          if (coord && source) {
            const placed: AtlasAsset = {
              ...doc,
              lat: coord.lat,
              lng: coord.lng,
              needsGeocode: false,
            };
            nextRows = [...prev.rows, placed];
          } else {
            const failed = {
              id: item.id,
              reason: key
                ? `Could not locate "${doc.address}, ${doc.city}, ${doc.state} ${doc.postalCode}".`
                : "Row has no street or ZIP for geocoding.",
              doc,
            };
            prev.failed.push(failed);
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
              cached: prev.progress.cached + (source === "cached" ? 1 : 0),
              fetched: prev.progress.fetched + (source === "fetched" ? 1 : 0),
              failed: !coord ? prev.progress.failed + 1 : prev.progress.failed,
              active: done < prev.progress.total,
            },
          };
        });

        // Honor Nominatim usage policy: ≤ 1 req/sec, with a little slack.
        if (source === "fetched") {
          await new Promise((r) => setTimeout(r, NOMINATIM_SPACING_MS));
        }
      }
    };

    void run();
    // We intentionally only re-run when a brand-new upload lands.
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
    <ImportedContext.Provider value={value}>{children}</ImportedContext.Provider>
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
 *
 *  Pass `replace: true` when the user wants their upload to fully replace
 *  the curated default assets (e.g. a custom asset map). In replace mode
 *  the seeded list is ignored and only uploaded rows are returned. */
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

  const chatOnlyFinal: AnyAsset[] = [...chatOnly];
  return { mappable, chatOnly: chatOnlyFinal };
}
