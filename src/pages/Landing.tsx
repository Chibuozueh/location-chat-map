import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { LayoutGrid, Map as MapIcon, Minimize2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { AppHeader } from "@/components/atlas/AppHeader";
import { AtlasHero } from "@/components/atlas/AtlasHero";
import { MapView } from "@/components/atlas/MapView";
import { ChatPanel } from "@/components/atlas/ChatPanel";
import { LocationGrid } from "@/components/atlas/LocationGrid";
import { CategoryFilter } from "@/components/atlas/CategoryFilter";
import {
  ImportedDataProvider,
  clusterByAddress,
  mergeAssets,
  useImportedData,
  type AnyAsset,
} from "@/state/imported-data";
import type { LocationDoc } from "@/components/atlas/types";
import { ATLANTA_ZIP_CENTROIDS, type AtlasAsset } from "@/lib/csv-import";

/**
 * Canonical category key. Maps spelling variants
 * ("Comm Based Classes & Programming", "Community Classes & Programming",
 * "community-classes-&-programming") onto a single shared bucket so they
 * render under one tab and the tab click filters them all together.
 * Without this, every minor casing / punctuation variant in the upstream
 * spreadsheet spawns a redundant tab and its rows silently disappear
 * from the user's view.
 */
function canonCategory(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[,._-]+/g, " ")
    .replace(/\bcomm(unity|unal|unity-?based)?\b/g, "community")
    .replace(/\bbased\b/g, "")
    .replace(/\bclasses\s+and\s+programs?\b/g, "classes & programming")
    .replace(/\s+/g, " ")
    .trim();
}

function LandingInner() {
  // The atlas's only data source is the live Google Sheet (auto-fetched
  // below). We no longer pull SEED_LOCATIONS from Convex — the imported
  // rows are the single source of truth for the map and chat. We still
  // type it as LocationDoc[] so the call sites below read naturally;
  // `seeded` is just an empty array passed to `mergeAssets` so the merged
  // bucket is exactly what `importedState` contains.
  const seeded: LocationDoc[] = [];
  // `topPicks.cities` used to feed hero-side "cities covered" chips from
  // seed data. We keep the prop but feed an empty array so the hero doesn't
  // render stale seeded cities.
  const cities: string[] = [];
  const { state: importedState, importFromUrl } = useImportedData();

  // Default Google Sheets URL — the live asset spreadsheet. Single source
  // of truth: editing the spreadsheet and refreshing the page shows the
  // updated data immediately.
  const GOOGLE_SHEETS_URL =
    "https://docs.google.com/spreadsheets/d/1zmV_whgwxfL7xEOvQXbWLU3i56fgPko1Q01UbWf7jVA/export?format=csv";

  // Auto-fetch the Google Sheets CSV on first paint (once). The Sheet is
  // the only data source — no seed backfill, no curated fallback list.
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
  /** Selected asset category filter; null means "all". */
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const exploreRef = useRef<HTMLDivElement | null>(null);

  // When the user picks a category, scroll them to the map area so the
  // new "<CategoryBreakdown>" banner + map pins + address-only list are
  // visible. Without this scroll, clicking a tab while scrolled up the
  // page would silently swap the filter and leave the user looking at
  // the hero, with no visible feedback that the selection took effect.
  useEffect(() => {
    if (!selectedCategory) return;
    const id = requestAnimationFrame(() => {
      exploreRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
    return () => cancelAnimationFrame(id);
  }, [selectedCategory]);

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

  // Derive the ordered list of unique asset categories from the loaded data.
  const allAssets = useMemo(
    () => [...merged.mappable, ...merged.chatOnly],
    [merged.mappable, merged.chatOnly],
  );

  // Categories collapse by canonical key so spelling variants share a tab.
  // The representative stored in `categories` is the canonical key
  // itself; `prettifyCategoryLabel` in CategoryFilter typeset will turn
  // it into a readable label, and `selectedCategory === canon` is the
  // wire-shape matchesCategory compares against below.
  const categoryGroups = useMemo(() => {
    const map = new Map<string, { representative: string; count: number }>();
    for (const a of allAssets) {
      const canon = canonCategory(a.category);
      if (!canon) continue;
      const existing = map.get(canon);
      if (existing) existing.count++;
      else map.set(canon, { representative: canon, count: 1 });
    }
    return Array.from(map.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
  }, [allAssets]);

  const categories = useMemo(
    () => categoryGroups.map(([, info]) => info.representative),
    [categoryGroups],
  );

  // Filter helpers. Category and open-now can be composed.
  const matchesCategory = useCallback(
    (asset: AnyAsset) => {
      if (!selectedCategory) return true;
      return (
        canonCategory(asset.category) === canonCategory(selectedCategory)
      );
    },
    [selectedCategory],
  );
  const isOpenNow = useCallback(
    (asset: AnyAsset) => isAssetOpenNow(asset),
    [],
  );

  const filteredMappable = useMemo(
    () => merged.mappable.filter((a) => matchesCategory(a)),
    [merged.mappable, matchesCategory],
  );
  const filteredChatOnly = useMemo(
    () => merged.chatOnly.filter((a) => matchesCategory(a)),
    [merged.chatOnly, matchesCategory],
  );

  // ZIP-centroid augmentation. When a row in this category is sitting in
  // `merged.chatOnly` (failed geocode OR PO Box OR no street at all)
  // AND it carries a valid Atlanta ZIP, plot it on the map at the ZIP's
  // centroid — styled with a different coordAccuracy so the user can see
  // at a glance which pins are approximate vs exact. This is the fix
  // for "31 in community classes only shows 2 on the map": without
  // this fallback, every "Vine St. NW" / "various" / no-street row
  // silently dropped off the map because Nominatim can't pin a precise
  // house number. The ZIP centroid is at least the right neighborhood.
  const augmentedMappable = useMemo(() => {
    const zipped: AtlasAsset[] = [];
    for (const a of merged.chatOnly) {
      if (!matchesCategory(a)) continue;
      if (Number.isFinite(a.lat) && Number.isFinite(a.lng)) continue;
      const zip = (a.postalCode ?? "").trim();
      const coord = ATLANTA_ZIP_CENTROIDS[zip];
      if (!coord) continue;
      zipped.push({
        ...a,
        lat: coord.lat,
        lng: coord.lng,
        coordAccuracy: "zip-centroid" as const,
      });
    }
    return [...filteredMappable, ...zipped];
  }, [filteredMappable, merged.chatOnly, matchesCategory]);

  // Group mappable assets by address so the map renders one pin per shared
  // address. Members of each cluster are preserved (used for the picker).
  // Note: we feed `augmentedMappable` (precise + ZIP-centroid) so every
  // asset with a valid Atlanta ZIP plots somewhere on the map.
  const clusters = useMemo(
    () => clusterByAddress(augmentedMappable as LocationDoc[]),
    [augmentedMappable],
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
      c.members.some((m) => isOpenNow(m as AnyAsset)),
    );
  }, [clusters, openNowFilter, isOpenNow]);
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
          cities={cities}
          onExplore={handleExploreMap}
          onExploreAssets={handleExploreAssets}
          mapFocus={mapFocus}
          openNowFilter={openNowFilter}
          onToggleOpenNow={handleToggleOpenNow}
        />

        <div className="mt-6">
          <CategoryFilter
            categories={categories}
            selected={selectedCategory}
            onSelect={setSelectedCategory}
            counts={categories.reduce((acc, c) => {
              acc[c] = allAssets.filter(
                (a) => canonCategory(a.category) === c,
              ).length;
              return acc;
            }, {} as Record<string, number>)}
          />
        </div>

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
                <>
                  {/* Count breakdown banner — sits ABOVE the map so the
                      user sees the discrepancy between tab count (e.g.
                      "31") and actual plotted pins (e.g. 2) immediately,
                      without scrolling past the map. The "View all as
                      list" CTA flips the same view-state to "sheet"
                      so every row in this category is reachable in one
                      click. */}
                  {selectedCategory && (
                    <CategoryBreakdown
                      total={filteredMappable.length + filteredChatOnly.length}
                      plotted={augmentedMappable.length}
                      onViewList={() => setView("sheet")}
                    />
                  )}
                  <MapView
                    clusters={displayClusters}
                    selectedSlug={selected}
                    pickerClusterKey={pickerClusterKey}
                    onSelect={handleSelectSlug}
                    onOpenPicker={handleOpenPicker}
                    onClosePicker={handleClosePicker}
                  />
                  {/* Address-only list. Sits below the map for users who
                      scroll. Every row in the filter that didn't geocode
                      lands here, sorted by name. */}
                  {selectedCategory && (
                    <AddressOnlyList
                      mappable={filteredMappable}
                      chatOnly={filteredChatOnly}
                      onSelect={handleSelectSlug}
                    />
                  )}
                </>
              ) : (
                <LocationGrid
                  locations={[...filteredMappable, ...filteredChatOnly] as LocationDoc[]}
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
            Atlanta Atlas · showing{" "}
            {importedState.source === "upload"
              ? "only your uploaded spreadsheet"
              : importedState.rows.length > 0
                ? "the live Google Sheet spreadsheet"
                : "the live Google Sheet spreadsheet (loading)"}
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

/**
 * Address-only list that sits just under the map when a category filter
 * is active. The map above plots whatever rows have finite lat/lng; this
 * list surfaces every other row in the current category (chatOnly +
 * any mappable whose coord-cache hit failed) so the visible count of
 * "31 assets" matches what the user can actually reach in the UI.
 * Hidden when the row would be empty. Hidden in the Sheet view because
 * LocationGrid already lists every row.
 */
function AddressOnlyList({
  mappable,
  chatOnly,
  onSelect,
}: {
  mappable: LocationDoc[];
  chatOnly: LocationDoc[];
  onSelect: (slug: string | null) => void;
}) {
  const unmapped: LocationDoc[] = [
    ...chatOnly,
    ...mappable.filter(
      (m) => !Number.isFinite(m.lat) || !Number.isFinite(m.lng),
    ),
  ];
  if (unmapped.length === 0) return null;
  return (
    <div className="mt-3 max-h-56 overflow-y-auto rounded-2xl border border-dashed border-accent/40 bg-accent/5 p-3 text-[12px]">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-accent">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
        {unmapped.length} more in this category — address-only (not on the map)
      </div>
      <ul className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {unmapped.map((m) => {
          const addressBits =
            [m.address, m.city].filter(Boolean).join(", ") ||
            "Address unavailable";
          return (
            <li key={m.slug}>
              <button
                type="button"
                onClick={() => onSelect(m.slug)}
                className="block w-full rounded-lg border border-border/60 bg-background/70 px-2.5 py-1.5 text-left hover:border-accent/60 hover:bg-accent/10"
              >
                <div className="truncate font-medium text-foreground">
                  {m.name}
                </div>
                <div className="truncate text-[10.5px] text-muted-foreground">
                  {addressBits}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Count breakdown that sits above the map when a category filter is
 * active. Surfaces the discrepancy between the tab count (e.g. 31)
 * and the actual plotted pins (e.g. 2) so the user sees at a glance
 * how many addresses fell through to address-only. The "View all as
 * list" CTA flips the same view-state to "sheet" without losing the
 * active category, so the user doesn't have to remember which tab
 * they clicked.
 */
function CategoryBreakdown({
  total,
  plotted,
  onViewList,
}: {
  total: number;
  plotted: number;
  onViewList: () => void;
}) {
  const unmapped = Math.max(total - plotted, 0);
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent/40 bg-accent/5 px-3 py-2 text-[11.5px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        <span className="font-medium text-foreground">
          {total} in this category
        </span>
        <span className="text-muted-foreground">
          · {plotted} plotted on the map · {unmapped} address-only
        </span>
      </div>
      <button
        type="button"
        onClick={onViewList}
        className="rounded-full border border-accent/50 bg-accent/10 px-3 py-1 text-[11px] font-medium text-accent transition hover:bg-accent/20"
      >
        View all as list →
      </button>
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
