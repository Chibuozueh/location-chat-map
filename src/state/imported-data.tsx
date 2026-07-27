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
  isDefaultHours,
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
  /** Rows that the Cerebras AI cleanup successfully returned and the
   *  cascade then accepted. */
  cerebrasCleaned: number;
  /** Rows Cerebras returned ok=false for (no fabrication, gave up). */
  cerebrasSkipped: number;
  /** Rows where the Cerebras call itself errored (transient). */
  cerebrasError: number;
  /** Rows whose hours came from the OpenRouter `extractHours` AI
   *  fallback (regex fast path didn't recognize the format). Surfaced
   *  in the chip so the user can see AI hours calls landing too. */
  hoursAIParsed: number;
  /** Rows whose hours stayed on the `defaultHours()` shape (regex+AI
   *  both missed; description was either empty or unparseable).
   *  Useful for the chat-panel info popover when debugging. */
  hoursDefault: number;
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
  /** Tab currently being fetched during a multi-tab Google Sheet import.
   *  Drives the chip's "Importing tab 2 of 3 (Gyms & Fitness Spaces)" label
   *  so the user can see which tab is on the wire. `null` outside of the
   *  import pass. */
  currentTab: { name: string; idx: number; total: number } | null;
};

/** A single Google-Sheet tab discovered during the URL-import pass. */
export type DiscoveredTab = {
  gid: string;
  name: string | null;
  /** Number of non-empty rows contributed by this tab (header excluded for
   *  tabs after the first). Filled after the CSV fetch completes. */
  rowCount: number;
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
  /** Tabs discovered from the Google Sheet source, in import order. Each
   *  entry includes the gid, tab name, and parsed row count (header
   *  excluded for tabs after the first). Empty for non-Google sources
   *  and after a `clear()`. Surfaced in the chat panel's info popover
   *  so the user can confirm all expected tabs loaded. */
  discoveredTabs: DiscoveredTab[];
  /** Quick lookup: gid → row count from a Google Sheet import. Mirrors
   *  the values stored inside `discoveredTabs` so the UI can render
   *  per-tab counts without iterating the array. */
  tabRowCounts: Record<string, number>;
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
  cerebrasCleaned: 0,
  cerebrasSkipped: 0,
  cerebrasError: 0,
  cerebrasCallsMade: 0,
  cerebrasModelLabel: null,
  failed: 0,
  active: false,
  currentTab: null,
  hoursAIParsed: 0,
  hoursDefault: 0,
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
  discoveredTabs: [],
  tabRowCounts: {},
};

type ImportedContextValue = {
  state: ImportedState;
  importing: boolean;
  geocoding: boolean;
  importFromFile: (file: File) => Promise<void>;
  /** Fetch a CSV from a public URL and import it through the same pipeline. */
  importFromUrl: (url: string) => Promise<void>;
  retry: () => void;
  clear: () => void;
  /**
   * Route rows from an already-translated `LocationDoc[]` (typically
   * `api.locations.list` → SEED_LOCATIONS) through the existing
   * Cerebras → Nominatim geocode cascade. Rows with finite lat/lng
   * land directly in `state.rows`; missing-coord rows go into
   * `state.pending` so the per-row geocode loop picks them up.
   * Bumping `retryNonce` re-fires that loop without an "import" event.
   */
  seedBackfill: (seeded: LocationDoc[]) => void;
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
  // These function references come from `convex/_generated/api` and are
  // resolved at build time by `bun convex dev --once`. If a reference is
  // ever undefined (e.g. a stale generated file missing a recently-added
  // action), the action call below will throw — that's caught inside the
  // per-row loop and logged, not propagated up to crash the render tree.
  const geocode = useAction(api.geocode.geocodeAddress);
  // Tier-5: the AI-assisted address normalizer. Gracefully returns
  // ok=false when no API key is set so this degrades into "no behavior
  // change" on a fresh install.
  const normalizeAddress = useAction(api.chatComplete.normalizeAddress);
  // Hours-of-operation extractor — OpenRouter fallback for descriptions
  // that the regex fast path in `parseHoursFromDescription` doesn't
  // recognize. Routes through the SAME `Map_Router_Key` provider so
  // the user can verify hours+address extraction from a single env var.
  // Same env-var rule applies: when no key is set, returns ok=false so
  // rows gracefully stay on their regex-time or default hours.
  const extractHoursAction = useAction(api.chatComplete.extractHours);
  const discoverTabsAction = useAction(api.sheets.discoverTabs);

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

  // Cache successful hours-extraction calls keyed by slug. The
  // `extractHours` OpenRouter call is the only path that fills this
  // cache; the regex fast path doesn't need it because it lands
  // synchronously at parse time.
  const hoursCacheRef = useRef<Map<string, AtlasAsset["hours"]>>(new Map());

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
   * Discover the first `max` tabs of a public Google Sheet by fetching
   * its HTML page and parsing the embedded JavaScript bootstrap data
   * for tab metadata.
   *
   * Google stores tabs as a JSON-style array literal inside a `<script>`
   * block, of the form:
   *   ["<INDEX>","<GID>",[{"1":[[0,0,"<TABNAME>"]...]]]
   * The bytes in raw HTML also contain literal backslash-escapes
   * (`\"`, `\\u0026`, …) because the data is double-encoded JS.
   *
   * Matches look like (in raw HTML bytes):
   *   ,"380541745",[{\"1\":[[0,0,\"Basketball Courts\"
   *
   * We extract both the gid and the tab name when available; the name
   * decoder then strips `\"` and `\u00XX` escapes so the chip can show
   * the real title ("Gyms & Fitness Spaces" not "Gyms \\u0026 Fitness
   * Spaces").
   */
  /** Fetch the whitelisted tabs of a publicly-shared Google Sheet.
   *  Done server-side via a Convex action to avoid browser CORS issues
   *  when fetching the `/edit` HTML page directly. */
  const discoverSheetTabs = useCallback(
    async (sheetId: string): Promise<DiscoveredTab[]> => {
      try {
        return (await discoverTabsAction({ sheetId })) as DiscoveredTab[];
      } catch (err) {
        console.error("[discoverSheetTabs] action failed", err);
        return [];
      }
    },
    [discoverTabsAction],
  );

  /** Fetch a CSV (optionally from multiple tabs of a Google Sheet) and
   *  import it through the same pipeline. For Google Sheets URLs, the
   *  first 3 tabs are discovered from the sheet HTML and fetched one
   *  at a time. The active tab is surfaced via `progress.currentTab`
   *  so the chat panel chip can display
   *  "Importing tab 2 of 3 (Gyms & Fitness Spaces)" while we wait. */
  const importFromUrl = useCallback(async (url: string) => {
    setImporting(true);
    cancelRef.current.cancelled = true;
    await new Promise((r) => setTimeout(r, 0));
    cancelRef.current.cancelled = false;
    try {
      // Detect Google Sheets URL and extract the sheet ID.
      const match = url.match(
        /(?:docs\.google\.com\/spreadsheets\/d\/|spreadsheets\/d\/)([a-zA-Z0-9_-]+)/,
      );

      if (match) {
        const sheetId = match[1];
        // Discover tab gids + names from the sheet's HTML.
        const tabs = await discoverSheetTabs(sheetId);

        if (tabs.length === 0) {
          toast.error(
            "Couldn't find any tabs in this Google Sheet. Make sure it's shared as 'Anyone with the link can view'.",
          );
          return;
        }

        // Clear any leftover tab state from a previous import.
        setState((prev) => ({
          ...prev,
          progress: { ...prev.progress, currentTab: null },
          discoveredTabs: tabs.map((t) => ({ ...t })),
          tabRowCounts: {},
        }));

        // Fetch CSV for each tab and concatenate.
        const parts: string[] = [];
        let firstTab = true;
        const rowCounts: Record<string, number> = {};

        for (let i = 0; i < tabs.length; i++) {
          if (cancelRef.current.cancelled) return;
          const tab = tabs[i];
          // Surface which tab we're about to fetch so the chip can
          // show "Importing tab N of M (Name) …". Cleared at end.
          setState((prev) => ({
            ...prev,
            progress: {
              ...prev.progress,
              currentTab: {
                name: tab.name ?? `Tab ${i + 1}`,
                idx: i,
                total: tabs.length,
              },
            },
          }));

          const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${tab.gid}`;
          try {
            const resp = await fetch(csvUrl);
            if (!resp.ok) {
              console.warn(
                `[importFromUrl] Tab gid=${tab.gid} returned HTTP ${resp.status}, skipping.`,
              );
              continue;
            }
            const text = await resp.text();
            if (!text.trim()) continue;

            // Count non-empty lines. Header is the first line for tab 1
            // and is dropped from tabs 2+, so subtract it where present.
            const lines = text.split("\n").filter((l) => l.trim().length > 0);
            const rowCount = firstTab ? Math.max(0, lines.length - 1) : lines.length;
            rowCounts[tab.gid] = rowCount;
            tab.rowCount = rowCount;
            // Mirror the per-tab count into state so the chip sees it
            // update incrementally during the import.
            setState((prev) => ({
              ...prev,
              tabRowCounts: { ...prev.tabRowCounts, [tab.gid]: rowCount },
              discoveredTabs: prev.discoveredTabs.map((dt) =>
                dt.gid === tab.gid ? { ...dt, rowCount } : dt,
              ),
            }));

            if (firstTab) {
              // First tab: keep the header row.
              parts.push(text);
              firstTab = false;
            } else {
              // Subsequent tabs: strip the header row (first line).
              if (lines.length > 1) {
                parts.push(lines.slice(1).join("\n"));
              }
            }
          } catch (err) {
            console.warn(`[importFromUrl] Tab gid=${tab.gid} fetch failed`, err);
          }
        }

        // Clear the active-tab indicator — the import is about to go
        // through the geocode cascade which is tracked separately.
        setState((prev) => ({
          ...prev,
          progress: { ...prev.progress, currentTab: null },
        }));

        if (parts.length === 0) {
          toast.error("No data found in any of the sheet's tabs.");
          return;
        }

        const combined = parts.join("\n");
        const tabCount = tabs.length;
        const name = `Google Sheet (${sheetId.slice(0, 8)}…) · ${tabCount} tab${tabCount === 1 ? "" : "s"}`;
        await importFromText(combined, name, "native", tabs, rowCounts);
      } else {
        // Non-Google-sheet URL: fetch as plain CSV.
        const resp = await fetch(url);
        if (!resp.ok) {
          toast.error(`Could not fetch CSV from URL (HTTP ${resp.status}).`);
          return;
        }
        const text = await resp.text();
        const name = url.split("/").pop() ?? "remote.csv";
        await importFromText(text, name, "native", [], {});
      }
    } catch (err) {
      console.error("URL import error", err);
      toast.error(
        `Couldn't load CSV from the provided URL. Make sure it's publicly accessible.`,
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
      discoveredTabs: DiscoveredTab[] = [],
      tabRowCounts: Record<string, number> = {},
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
          cerebrasCleaned: 0,
          cerebrasSkipped: 0,
          cerebrasError: 0,
          cerebrasCallsMade: 0,
          cerebrasModelLabel: null,
          failed: 0,
          active: pendingCount > 0,
          currentTab: null,
          hoursAIParsed: 0,
          hoursDefault: 0,
        },
        source,
        released: true,
        discoveredTabs,
        tabRowCounts,
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

      // Native seed backfill: just dismiss the UI chip without destroying
      // the already-geocoded rows so assets don't vanish from the map.
      // The x button on the chip should only hide the status bar, not
      // unload all the data.
      if (prev.source === "native") {
        return {
          ...prev,
          filename: null,
          source: null,
          importedAt: null,
          progress: {
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
            currentTab: null,
            hoursAIParsed: 0,
            hoursDefault: 0,
          },
          // Dismiss the tab list too — the user is hiding the chip, so
          // the info popover shouldn't keep showing the old tab rows.
          // The next page-load auto-fetch will repopulate discoveredTabs.
          discoveredTabs: [],
          tabRowCounts: {},
          released: true,
        };
      }

      // User upload: full clear — user expects removing an upload to
      // unload its rows from the atlas.
      toast(`Cleared ${prev.rows.length + prev.pending.length} imported entries.`);
      return EMPTY;
    });
    // Only clear caches for upload-sourced clears; native seed geocode
    // rows stay cached so a re-show doesn't need fresh API calls.
    setState((prev) => {
      if (prev.source !== "upload") return prev;
      coordCacheRef.current.clear();
      normalizeCacheRef.current.clear();
      return prev;
    });
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
        // AI-cleaned address fragments from the Atlas Map AI normalize call.
        // Hoisted to the per-row scope so the placedDoc construction can
        // spread it onto the doc regardless of which `if (!coord)` branch
        // actually ran the normalization.
        let cleaned: {
          ok: true;
          street: string;
          city?: string;
          state?: string;
          postalcode?: string;
          providerLabel?: string;
          confidence?: "high" | "medium" | "low";
        } | null = null;
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

        // Step 2: Atlas Map AI normalize. Always invoked for rows
        // that still need geocoding — even ZIP-less rows with no
        // street in the spreadsheet and no geoKey. The AI's landmark-
        // resolution rules can fill in a real address from just the
        // asset-name hint + Atlanta context, which is the only path
        // that recovers "MARTA Bankhead" / "West Atlanta Watershed
        // Alliance"-style rows. Previously gated on
        // `rawStreet.length > 0 && key`, that gate silently bypassed
        // every row missing either field — exactly the 28 the user
        // was seeing. We always call now; rows without an address
        // still get passed `rawStreet=""` so the AI can use the
        // asset-name hint alone.
        let addressForGeocode: AddressFragment = {
          street: doc.address ?? "",
          city: doc.city ?? "",
          state: doc.state ?? "",
          postalcode: doc.postalCode ?? "",
          country: doc.country || "USA",
        };

        if (!coord) {
          const cleanCacheKey = `clean:${key}`;
          const cachedClean = normalizeCacheRef.current.get(cleanCacheKey);

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
              `[atlas/llm-normalize] calling Atlas Map AI for "${doc.name}" (#${
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
                `[atlas/llm-normalize] Atlas Map AI returned for "${doc.name}":`,
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
                // TRANSIENT FAILURE (rate-limit, network, 5xx, auth-
                // rejected). Don't poison the in-memory cache with this —
                // a Retry click should re-query the AI rather than
                // re-using the cached "skip" verdict and burning the row.
                llmOutcome = "errored";
                if (
                  /map ai.*offline|was rejected by|map_router_key|openrouter_api_key/i.test(
                    clean.error,
                  )
                ) {
                  lastProviderLabel = "Map AI · offline";
                }
              } else {
                // PERMANENT REFUSAL. The model returned ok=false with no
                // error message (e.g. "Couldn't recover a street line").
                // Cache the refusal so a Retry doesn't re-bill the model
                // for the same row in the same import.
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

        // Step 4: hours-of-operation extraction. The regex fast path in
        // `parseHoursFromDescription` already ran at CSV parse time and
        // filled `doc.hours` when the columns mentioned a recognizable
        // format ("Mon-Fri 9am-5pm", "24/7", etc.). For rows where the
        // regex couldn't parse, `doc.hours` is still on `defaultHours()`
        // — those rows get a second chance via OpenRouter's structured
        // JSON call. Cached on slug so re-imports / Retry are free.
        let hoursFromAI: AtlasAsset["hours"] | null = null;
        let hoursOutcome: "regex" | "ai" | "default" = "regex";
        const description = (doc.description ?? "").trim();
        if (isDefaultHours(doc.hours) && description.length > 0) {
          const hoursCacheKey = `hours:${doc.slug}`;
          const cached = hoursCacheRef.current.get(hoursCacheKey);
          if (cached) {
            hoursFromAI = cached;
            hoursOutcome = "ai";
          } else {
            try {
              const hoursResult = await extractHoursAction({
                description: doc.description ?? "",
                assetName: doc.name,
              });
              if (hoursResult.ok && hoursResult.hours) {
                hoursFromAI = hoursResult.hours;
                hoursOutcome = "ai";
                hoursCacheRef.current.set(hoursCacheKey, hoursFromAI);
              } else {
                hoursOutcome = "default";
              }
            } catch (err) {
              console.warn("[hours-extract] threw", err);
              hoursOutcome = "default";
            }
          }
        }

        // Decide this row's destination. Successful rows go into
        // `state.rows` immediately so the map plots them as they come in;
        // failed rows land in `state.failed` so the Retry chip surfaces
        // the moment geocoding is exhausted.
        // Build the AI-cleaned address fields inline so the spread into
        // `placedDoc` doesn't go through a closure — keeps the runtime
        // reference to `cleaned` lexically trivial. The fields land on
        // the doc only when the Atlas Map AI normalize call returned OK;
        // otherwise we persist either an `unavailable` confidence flag
        // (so the UI can surface "AI couldn't standardize") or nothing
        // at all (rows that bypassed AI entirely, e.g. cached coord hits).
        const cleanedFields: Record<string, unknown> =
          llmOutcome === "cleaned" && cleaned !== null
            ? {
                cleanedAddress: cleaned.street,
                cleanedCity: cleaned.city,
                cleanedState: cleaned.state,
                cleanedPostalCode: cleaned.postalcode,
                cleanedConfidence: cleaned.confidence || "low",
                cleanedProvider: cleaned.providerLabel,
                cleanedAt: Date.now(),
              }
            : llmOutcome === "skipped" || llmOutcome === "errored"
              ? { cleanedConfidence: "unavailable" as const }
              : {};

        const placedDoc: AtlasAsset | null =
          coord && accuracy
            ? {
                ...doc,
                lat: coord.lat,
                lng: coord.lng,
                needsGeocode: false,
                coordAccuracy: accuracy,
                // Apply the AI-extracted hours (if any) over the regex/
                // default schedule so the chat panel's "Open Now" filter
                // sees the user-confirmed schedule rather than the
                // generic M–F 10–17 placeholder.
                hours: hoursFromAI || doc.hours,
                ...cleanedFields,
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
              hoursAIParsed:
                prev.progress.hoursAIParsed +
                (hoursOutcome === "ai" ? 1 : 0),
              hoursDefault:
                prev.progress.hoursDefault +
                (hoursOutcome === "default" ? 1 : 0),
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

  /**
   * DEPRECATED: previously pushed the curated `SEED_LOCATIONS` rows
   * (returned from `api.locations.list`) into the geocode pipeline on
   * first paint. The atlas now sources all data from the live Google
   * Sheet (single source of truth), so the curated fallback is no
   * longer injected. The function is kept on the context for backward
   * compatibility with any callers still invoking it (a no-op).
   */
  const seedBackfill = useCallback((_seeded: LocationDoc[]) => {
    // No-op. The Google Sheet auto-import (`importFromUrl`) is now the
    // single source of truth; pulling SEED_LOCATIONS again would
    // double-count assets and contradict the sheet content.
  }, []);

  const value = useMemo<ImportedContextValue>(
    () => ({
      state,
      importing,
      geocoding: state.progress.active,
      importFromFile,
      importFromUrl,
      retry,
      clear,
      seedBackfill,
    }),
    [state, importing, importFromFile, importFromUrl, retry, clear, seedBackfill],
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
