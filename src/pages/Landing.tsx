import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { LayoutGrid, Map as MapIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { AppHeader } from "@/components/atlas/AppHeader";
import { AtlasHero } from "@/components/atlas/AtlasHero";
import { MapView } from "@/components/atlas/MapView";
import { ChatPanel } from "@/components/atlas/ChatPanel";
import { LocationCard } from "@/components/atlas/LocationCard";
import { LocationGrid } from "@/components/atlas/LocationGrid";
import type { LocationDoc } from "@/components/atlas/types";

export default function Landing() {
  const locations = (useQuery(api.locations.list) as LocationDoc[] | undefined) ?? [];
  const top = useQuery(api.locations.topPicks);
  const seed = useMutation(api.locations.seed);

  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"map" | "sheet">("map");
  const exploreRef = useRef<HTMLDivElement | null>(null);

  // Auto-seed once on first mount if the table is empty.
  useEffect(() => {
    if (locations.length === 0) {
      seed({ force: false }).catch(() => {});
    }
  }, [locations.length, seed]);

  const selectedDoc = useMemo(
    () => locations.find((l) => l.slug === selected) ?? null,
    [locations, selected],
  );

  function scrollToMap() {
    exploreRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="min-h-screen w-full">
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl px-4 pb-20 pt-6 md:px-6">
        <AtlasHero
          total={top?.counts.total ?? locations.length}
          openNow={top?.counts.openNow ?? 0}
          avgRating={top?.counts.avgRating ?? 0}
          cities={top?.cities ?? []}
          onExplore={scrollToMap}
        />

        <div ref={exploreRef} className="mt-8 grid gap-4 md:mt-10 md:gap-6 lg:grid-cols-[1.5fr_1fr]">
          {/* Left: view toggle + Map/Sheet */}
          <section className="flex min-h-[560px] flex-col">
            <div className="mb-3 flex items-center gap-2">
              <div className="inline-flex items-center rounded-full border border-border/60 bg-card p-1 text-[11px] shadow-card">
                <button
                  onClick={() => setView("map")}
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
                  onClick={() => setView("sheet")}
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
                Click a pin or chat citation to focus a café
              </div>
              <div className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                Live data
              </div>
            </div>

            {view === "map" ? (
              <MapView
                locations={locations}
                selectedSlug={selected}
                onSelect={setSelected}
              />
            ) : (
              <LocationGrid
                locations={locations}
                selectedSlug={selected}
                onSelect={setSelected}
              />
            )}
          </section>

          {/* Right: chat panel */}
          <aside className="flex min-h-[560px] flex-col">
            <ChatPanel onCitation={(slug) => setSelected(slug)} />
          </aside>
        </div>

        {/* Detail drawer — only when a city is focused */}
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-20 flex justify-center px-4">
          <AnimatePresence>
            {selectedDoc && (
              <LocationCard
                loc={selectedDoc}
                onClose={() => setSelected(null)}
              />
            )}
          </AnimatePresence>
        </div>

        {/* Subtle footer */}
        <footer className="mt-12 flex flex-col items-start justify-between gap-2 border-t border-border/60 pt-6 text-[11.5px] text-muted-foreground sm:flex-row sm:items-center">
          <div>
            Atlas · a sample experience demonstrating a map + AI chat that reads
            structured location data.
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
