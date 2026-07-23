import { Star } from "lucide-react";
import { motion } from "framer-motion";
import { CATEGORY_LABEL, PRICE_SYMBOL, type LocationDoc } from "./types";

export function LocationGrid(props: {
  locations: LocationDoc[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  /** For each slug, the size of its address cluster (only >1 entries kept). */
  clusterSizes?: Record<string, number>;
}) {
  const { locations, selectedSlug, onSelect, clusterSizes } = props;
  return (
    <div className="h-full w-full overflow-hidden rounded-2xl border border-border/70 bg-card shadow-card">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div>
          <div className="text-[12.5px] font-semibold tracking-[-0.005em]">
            Curated directory
          </div>
          <div className="text-[10.5px] text-muted-foreground">
            {locations.length} assets · sorted by community score
          </div>
        </div>
        <div className="hidden gap-2 text-[10px] text-muted-foreground sm:flex">
          <span className="rounded border border-border/60 px-2 py-0.5">
            Sheet view
          </span>
        </div>
      </div>
      <div className="max-h-full overflow-y-auto">
        <div className="hidden grid-cols-[1.6fr_1fr_0.5fr_0.5fr_0.5fr] gap-3 border-b border-border/60 px-4 py-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground sm:grid">
          <div>Asset</div>
          <div>Category</div>
          <div>Score</div>
          <div>Cost</div>
          <div>Since</div>
        </div>
        <ul className="divide-y divide-border/60">
          {locations.map((l, i) => {
            const selected = l.slug === selectedSlug;
            const sharedWith = clusterSizes?.[l.slug];
            return (
              <motion.li
                key={l.slug}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
              >
                <button
                  onClick={() => onSelect(l.slug)}
                  className={`grid w-full grid-cols-1 items-center gap-2 px-4 py-3 text-left text-[12.5px] transition hover:bg-accent/5 sm:grid-cols-[1.6fr_1fr_0.5fr_0.5fr_0.5fr] sm:gap-3 ${
                    selected ? "bg-accent/10" : ""
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <span
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[12px] font-semibold text-white"
                      style={{ background: l.accentColor || "#A47551" }}
                    >
                      {l.name.charAt(0)}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="block truncate font-medium text-foreground">
                          {l.name}
                        </span>
                        {sharedWith ? (
                          <span
                            className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-[#6e0e1e] bg-[#6e0e1e0d] px-1.5 py-px text-[9.5px] font-semibold tabular-nums text-[#6e0e1e]"
                            title={`${sharedWith} assets share this address`}
                          >
                            ×{sharedWith}
                          </span>
                        ) : null}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {l.address}
                      </span>
                    </span>
                  </span>
                  <span className="hidden text-muted-foreground sm:block">
                    {CATEGORY_LABEL[l.category] ?? l.category}
                  </span>
                  <span className="hidden items-center gap-1 sm:flex">
                    <Star className="h-3 w-3 fill-accent text-accent" />
                    <span className="tabular-nums">{l.rating.toFixed(1)}</span>
                    <span className="text-[10.5px] text-muted-foreground">
                      ({l.reviewCount.toLocaleString()})
                    </span>
                  </span>
                  <span className="hidden tabular-nums text-muted-foreground sm:block">
                    {PRICE_SYMBOL[l.priceTier] ?? "—"}
                  </span>
                  <span className="hidden tabular-nums text-muted-foreground sm:block">
                    {l.openedYear}
                  </span>
                </button>
              </motion.li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
