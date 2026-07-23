import { motion } from "framer-motion";
import { ArrowRight, LayoutGrid, Minimize2, Sparkles } from "lucide-react";

export function AtlasHero(props: {
  total: number;
  uploadedCount: number | null;
  openNow: number;
  cities: string[];
  /** Toggles the focused-map mode (also scrolls the map into view). */
  onExplore: () => void;
  /** Switches the right-hand pane to the curated sheet view. */
  onExploreAssets: () => void;
  /** Whether the focused-map mode is currently active. */
  mapFocus: boolean;
}) {
  const {
    uploadedCount,
    openNow,
    cities,
    onExplore,
    onExploreAssets,
    mapFocus,
  } = props;
  // Native (seeded / curated) asset count — used as the fallback when no
  // CSV has been uploaded yet so the hero always reflects a real total.
  const nativeCount = props.total;
  return (
    <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-card shadow-card">
      <div className="absolute inset-0 gradient-paper" aria-hidden />
      <div
        className="absolute inset-0 grid-paper opacity-[0.35]"
        aria-hidden
      />
      <div className="relative grid grid-cols-1 gap-6 px-6 py-8 md:grid-cols-[1.4fr_1fr] md:px-10 md:py-12">
        <div className="flex flex-col">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 self-start rounded-full border border-[#6e0e1e33] bg-paper/80 px-3 py-1 text-[11px] font-medium tracking-[0.06em] text-[#6e0e1e] shadow-card backdrop-blur"
          >
            <Sparkles className="h-3 w-3" />
            Morehouse Atlas · Southwest Atlanta community assets
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="mt-4 font-display text-balance text-[44px] font-semibold leading-[1.05] tracking-[-0.02em] text-[#0e0a0b] md:text-[56px]"
          >
            Map every
            <span className="px-2 text-[#6e0e1e]">community asset</span>
            <br />
            across Southwest Atlanta.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mt-4 max-w-xl text-balance text-[14.5px] leading-relaxed text-muted-foreground md:text-[15.5px]"
          >
            Search the atlas by category, hours, cost, or accessibility — and
            chat with an assistant that reads the entire spreadsheet of curated
            Southwest Atlanta assets so you don't have to.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mt-6 flex flex-wrap items-center gap-3"
          >
            <button
              onClick={onExplore}
              aria-pressed={mapFocus}
              className="group inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground shadow-pop transition hover:bg-primary/95"
            >
              {mapFocus ? (
                <>
                  Collapse map
                  <Minimize2 className="h-3.5 w-3.5 transition-transform group-hover:scale-90" />
                </>
              ) : (
                <>
                  Explore the map
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onExploreAssets}
              className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-4 py-2 text-[13px] font-medium text-foreground backdrop-blur transition hover:border-accent/60"
            >
              <LayoutGrid className="h-3.5 w-3.5 text-accent" />
              Explore the assets
            </button>
          </motion.div>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="flex flex-col justify-center gap-3 md:items-end"
        >
          <div className="grid grid-cols-2 gap-2 md:gap-3">
            <AssetsStat
              uploadedCount={uploadedCount}
              nativeCount={nativeCount}
            />
            <Stat label="open now" value={openNow} />
          </div>
          <div className="rounded-xl border border-border/60 bg-background/70 px-3 py-2 text-[11.5px] text-muted-foreground backdrop-blur">
            <span className="font-medium text-foreground">
              {cities.length} cities
            </span>{" "}
            · reads spreadsheet rows live
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number | string;
  suffix?: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/70 px-3 py-3 shadow-card backdrop-blur">
      <div className="font-display text-[22px] font-semibold tabular-nums leading-none tracking-[-0.01em]">
        {value}
        {suffix && <span className="ml-0.5 text-[14px] text-accent">{suffix}</span>}
      </div>
      <div className="mt-1.5 text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

/**
 * Hero "assets" stat — styled with Morehouse maroon prominence.
 * Shows the uploaded-CSV row count when a file is loaded, otherwise the
 * native (curated seed) asset count so the number is always grounded in
 * real rows rather than an em-dash.
 */
function AssetsStat({
  uploadedCount,
  nativeCount,
}: {
  uploadedCount: number | null;
  nativeCount: number;
}) {
  const hasUpload = uploadedCount !== null;
  const displayValue = hasUpload ? uploadedCount : nativeCount;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 220, damping: 18 }}
      className={`relative overflow-hidden rounded-2xl border bg-background/80 px-3 py-3 shadow-pop backdrop-blur ${
        hasUpload
          ? "border-[#6e0e1e] bg-[#6e0e1e0d] ring-2 ring-[#6e0e1e33]"
          : "border-border/60"
      }`}
    >
      <div
        className={`font-display tabular-nums leading-none tracking-[-0.01em] ${
          hasUpload
            ? "text-[34px] font-extrabold text-[#6e0e1e]"
            : "text-[34px] font-extrabold text-muted-foreground/60"
        }`}
      >
        {displayValue}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.18em] text-[#6e0e1e]">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            hasUpload ? "bg-[#6e0e1e]" : "bg-muted-foreground/40"
          }`}
        />
        assets
      </div>
    </motion.div>
  );
}
