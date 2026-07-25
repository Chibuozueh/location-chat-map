import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { LayoutGrid, Map as MapIcon, Minimize2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { AppHeader } from "@/components/atlas/AppHeader";
import { AtlasHero } from "@/components/atlas/AtlasHero";
import { MapView } from "@/components/atlas/MapView";
import { ChatPanel } from "@/components/atlas/ChatPanel";
import { LocationGrid } from "@/components/atlas/LocationGrid";
import {
  ImportedDataProvider,
  clusterByAddress,
  mergeAssets,
  useImportedData,
  type AnyAsset,
} from "@/state/imported-data";
import type { LocationDoc } from "@/components/atlas/types";
import type { AtlasAsset } from "@/lib/csv-import";

function LandingInner() {
  // The Convex `list` query returns the embedded `SEED_LOCATIONS` already
  // translated into the canonical `AtlasAsset` shape, so we can use it
  // directly without an extra client-side adapter.
  const seeded =
    (useQuery(api.locations.list) as LocationDoc[] | undefined) ?? [];
  const top = useQuery(api.locations.topPicks);
  const { state: importedState, seedBackfill, importFromUrl } = useImportedData();

  // Default Google Sheets URL — the live asset spreadsheet.
  const GOOGLE_SHEETS_URL =
    "https://docs.google.com/spreadsheets/d/1zmV_whgwxfL7xEOvQXbWLU3i56fgPko1Q01UbWf7jVA/export?format=csv";

  // First-paint backfill: route SEED rows that lack lat/lng through the
  // existing Cerebras → Nominatim cascade. Tracked by a stable slug-list
  // signature so editing SEED_LOCATIONS in code (which changes the
  // signature) re-runs the backfill on the next refresh, while React's
  // double-mount / fast-refresh won't double-charge the geocoder.
  const seedBackfillSigRef = useRef<string | null>(null);
  useEffect(() => {
    if (seeded.length === 0) return;
    const sig = seeded
      .map((s) => s.slug)
      .sort()
      .join("|");
    if (seedBackfillSigRef.current === sig) return;
    seedBackfillSigRef.current = sig;
    seedBackfill(seeded);
  }, [seeded, seedBackfill]);

  // Auto-fetch the Google Sheets CSV on first paint (once).
  const sheetsFetchedRef = useRef(false);
  useEffect(() => {
    if (sheetsFetchedRef.current) return;
    sheetsFetchedRef.current = true;
    void importFromUrl(GOOGLE_SHEETS_URL);
  }, [importFromUrl]);

  const [selected, setSelected] = useState<string | null>(null);
  const [pickerClusterKey, setPickerClusterKey] = useState<string | null>(null);
  const [view, setView] = useState<"map" | "sheet">("map");
  /** When true, the chat aside collapses and the map fills the viewport
   *  at ~60% larger perceived area (full width + taller height). */
  const [mapFocus, setMapFocus] = useState(false);
  /** When true, only clusters whose members are currently open are shown. */
  const [openNowFilter, setOpenNowFilter] = useState(false);
  const exploreRef = useRef<HTMLDivElement | null>(null);

  // Helper: check whether an asset is currently open based on its hours.
  function isAssetOpenNow(asset: AnyAsset, now = new Date()): boolean {
    const dayKey = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][now.getDay()] as
      | "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
    const h = asset.hours?.[dayKey];
    if (!h || h.open === "—" || h.close === "—" || !h.open || !h.close) return false;
    const parse = (s: string) => {
      const parts = s.split(":").map(Number);
      return parts[0] * 60 + (parts[1] || 0);
    };
    const openM = parse(h.open);
    const closeM = parse(h.close);
    const curM = now.getHours() * 60 + now.getMinutes();
    return curM >= openM && curM < closeM;
  }

  const hasAnyImport =
    importedState.rows.length +
      importedState.pending.length +
      importedState.failed.length >
    0;

  // When the native CSV is auto-loaded (or a manual upload), the CSV
  // becomes the single source of truth for the atlas — the curated
  // Convex seeds are dropped so the map + chat only ever see the
  // uploaded rows. This matches the user's intent of "the file is the
  // asset map".
  const nativeSourceActive = importedState.source === "native";
  const useReplace = nativeSourceActive || hasAnyImport;

  const merged = useMemo<{
    mappable: (LocationDoc | AtlasAsset)[];
    chatOnly: (LocationDoc | AtlasAsset)[];
  }>(
    () =>
      mergeAssets(
        seeded,
        importedState.rows,
        [
          ...importedState.chatOnly,
          ...importedState.pending.map((p) => p.doc),
          ...importedState.failed.map((f) => f.doc),
        ],
        { replace: useReplace },
      ),
    [
      seeded,
      importedState.rows,
      importedState.chatOnly,
      importedState.pending,
      importedState.failed,
      useReplace,
    ],
  );

  const selectedDoc = useMemo(
    () =>
      [...merged.mappable, ...merged.chatOnly].find((l) => l.slug === selected) ?? null,
    [merged, selected],
  );

  // Group mappable assets by address so the map renders one pin per shared
  // address. Members of each cluster are preserved (used for the picker).
  const clusters = useMemo(
    () => clusterByAddress(merged.mappable as LocationDoc[]),
    [merged.mappable],
  );

  // Wrappers that keep the picker and selection mutually exclusive.
  const handleSelectSlug = useCallback((slug: string | null) => {
    if (slug !== null) setPickerClusterKey(null);
    setSelected(slug);
  }, []);
  const handleOpenPicker = useCallback((key: string) => {
    setSelected(null);
    setPickerClusterKey(key);
  }, []);
  const handleClosePicker = useCallback(() => {
    setPickerClusterKey(null);
  }, []);

  function scrollToMap() {
    exploreRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /** Toggle the focused-map mode and scroll the map into view. */
  const handleExploreMap = useCallback(() => {
    setMapFocus((prev) => {
      const next = !prev;
      // Scroll after the layout shift has been committed.
      requestAnimationFrame(() => {
        exploreRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
      return next;
    });
  }, []);

  /** Jump to the curated sheet view and scroll it into view. */
  const handleExploreAssets = useCallback(() => {
    setView("sheet");
    requestAnimationFrame(() => {
      exploreRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, []);

  const handleCollapseMap = useCallback(() => {
    setMapFocus(false);
  }, []);

  const totalVisible = merged.mappable.length + merged.chatOnly.length;

  // Open-now filter helpers
  const openNowCount = useMemo(
    () => merged.mappable.filter((a) => isAssetOpenNow(a as AnyAsset)).length,
    [merged.mappable],
  );
  const displayClusters = useMemo(() => {
    if (!openNowFilter) return clusters;
    return clusters.filter((c) =>
      c.members.some((m) => isAssetOpenNow(m as AnyAsset)),
    );
  }, [clusters, openNowFilter]);
  const handleToggleOpenNow = useCallback(() => {
    setOpenNowFilter((prev) => !prev);
  }, []);

  return (
    <div className="min-h-screen w-full">
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl px-4 pb-20 pt-6 md:px-6">
        <AtlasHero
          total={totalVisible}
          uploadedCount={
            importedState.filename
              ? Math.max(0, importedState.totalParsed - importedState.rejected)
              : null
          }
          openNow={openNowCount}
          cities={top?.cities ?? []}
          onExplore={handleExploreMap}
          onExploreAssets={handleExploreAssets}
          mapFocus={mapFocus}
          openNowFilter={openNowFilter}
          onToggleOpenNow={handleToggleOpenNow}
        />

        <div
          ref={exploreRef}
          className={`mt-8 grid gap-4 md:mt-10 md:gap-6 transition-[grid-template-columns] duration-300 ${
            mapFocus
              ? "grid-cols-1"
              : "lg:grid-cols-[1.5fr_1fr]"
          }`}
        >
          {/* Left: view toggle + Map/Sheet */}
          <section
            className={`flex flex-col transition-[min-height] duration-300 ${
              mapFocus
                ? "min-h-[calc(100vh-7rem)]"
                : "min-h-[560px]"
            }`}
          >
            <div className="mb-3 flex items-center gap-2">
              <div className="inline-flex items-center rounded-full border border-border/60 bg-card p-1 text-[11px] shadow-card">
                <button
                  onClick={() => {
                    setView("map");
                    if (mapFocus) setMapFocus(false);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 transition ${
                    view === "map"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <MapIcon className="h-3 w-3" />
                  Map
                </button>
                <button
                  onClick={() => {
                    setView("sheet");
                    if (mapFocus) setMapFocus(false);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 transition ${
                    view === "sheet"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <LayoutGrid className="h-3 w-3" />
                  Sheet
                </button>
              </div>
              <div className="hidden text-[11px] text-muted-foreground sm:block">
                Click a pin or chat citation to focus an asset
              </div>
              <div className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                Live data
              </div>
              {mapFocus && (
                <button
                  type="button"
                  onClick={handleCollapseMap}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/90 px-3 py-1.5 text-[11px] font-medium text-foreground shadow-card backdrop-blur transition hover:border-accent/60"
                  aria-label="Collapse map back to overview"
                >
                  <Minimize2 className="h-3 w-3 text-accent" />
                  Collapse
                </button>
              )}
            </div>

            <div className="relative flex-1">
              {view === "map" ? (
                <MapView
                  clusters={displayClusters}
                  selectedSlug={selected}
                  pickerClusterKey={pickerClusterKey}
                  onSelect={handleSelectSlug}
                  onOpenPicker={handleOpenPicker}
                  onClosePicker={handleClosePicker}
                />
              ) : (
                <LocationGrid
                  locations={[...merged.mappable, ...merged.chatOnly] as LocationDoc[]}
                  selectedSlug={selected}
                  onSelect={handleSelectSlug}
                  clusterSizes={((): Record<string, number> => {
                    const out: Record<string, number> = {};
                    for (const c of clusters) {
                      if (c.count > 1) {
                        for (const m of c.members) out[m.slug] = c.count;
                      }
                    }
                    return out;
                  })()}
                />
              )}
            </div>
          </section>

          {/* Right: chat panel — collapses out of view when the user
              requests the focused-map mode so the map can fill the row.
              Sized to the viewport so typing never requires scrolling the
              page; the inner messages area scrolls independently. */}
          {!mapFocus && (
            <aside
              className="sticky top-20 flex max-h-[calc(100dvh-6rem)] min-h-[520px] flex-col"
              style={{ height: "calc(100dvh - 6rem)" }}
            >
              <ChatPanel onCitation={(slug) => setSelected(slug)} />
            </aside>
          )}
        </div>

        {/* Description overlay is rendered inside MapView itself (the
            maroon-bordered DescriptionCard that anchors to the selected
            pin). Rendering a second card here would clip the map and
            double the description on screen. */}

        {/* Subtle footer */}
        <footer className="mt-12 flex flex-col items-start justify-between gap-2 border-t border-border/60 pt-6 text-[11.5px] text-muted-foreground sm:flex-row sm:items-center">
          <div>
            Atlanta Atlas · showing {hasAnyImport
              ? "only your uploaded spreadsheet"
              : "the 12 curated Southwest Atlanta defaults"}
            .
          </div>
          <div className="flex items-center gap-3">
            <span>
              Map:{" "}
              <a
                className="underline-offset-4 hover:underline"
                href="https://carto.com/attributions"
                target="_blank"
                rel="noreferrer"
              >
                CARTO
              </a>{" "}
              ·{" "}
              <a
                className="underline-offset-4 hover:underline"
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noreferrer"
              >
                OpenStreetMap
              </a>
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
}

export default function Landing() {
  return (
    <ImportedDataProvider>
      <LandingInner />
    </ImportedDataProvider>
  );
}
