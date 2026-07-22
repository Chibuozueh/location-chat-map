import { motion } from "framer-motion";
import { ArrowRight, Coffee, Sparkles } from "lucide-react";
import { Link } from "react-router";

export function AtlasHero(props: {
  total: number;
  openNow: number;
  avgRating: number;
  cities: string[];
  onExplore: () => void;
}) {
  const { total, openNow, avgRating, cities, onExplore } = props;
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
            className="inline-flex items-center gap-2 self-start rounded-full border border-border/60 bg-background/70 px-3 py-1 text-[11px] text-muted-foreground shadow-card backdrop-blur"
          >
            <Sparkles className="h-3 w-3 text-accent" />
            An atlas of independent coffee culture
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="mt-4 font-display text-balance text-[44px] font-semibold leading-[1.05] tracking-[-0.02em] md:text-[56px]"
          >
            Find the
            <span className="px-2 text-accent">perfect cup</span>
            <br />
            with a map that talks back.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mt-4 max-w-xl text-balance text-[14.5px] leading-relaxed text-muted-foreground md:text-[15.5px]"
          >
            Search the atlas by rating, hours, price, or features — and chat with
            an assistant that reads the entire spreadsheet of curated cafés so you
            don't have to.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mt-6 flex flex-wrap items-center gap-3"
          >
            <button
              onClick={onExplore}
              className="group inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground shadow-pop transition hover:bg-primary/95"
            >
              Explore the map
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </button>
            <Link
              to="/auth"
              className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-4 py-2 text-[13px] font-medium text-foreground backdrop-blur transition hover:border-accent/60"
            >
              <Coffee className="h-3.5 w-3.5 text-accent" />
              Sign in to save routes
            </Link>
          </motion.div>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="flex flex-col justify-center gap-3 md:items-end"
        >
          <div className="grid grid-cols-3 gap-2 md:gap-3">
            <Stat label="cafés" value={total} />
            <Stat label="avg rating" value={avgRating.toFixed(1)} suffix="★" />
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
