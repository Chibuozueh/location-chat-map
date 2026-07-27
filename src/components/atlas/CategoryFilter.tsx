import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { prettifyCategoryLabel } from "./types";

export type CategoryFilterProps = {
  categories: string[];
  selected: string | null;
  onSelect: (category: string | null) => void;
  counts?: Record<string, number>;
  /**
   * Live count of unmappable rows (no coords AND no ZIP-rescue). When
   * > 0, an extra "Unmapped" pill renders at the end of the tab row
   * with a dashed accent border; clicking it sets the sentinel value
   * `__unmapped__` as `selected`. The landing page interprets this
   * sentinel as "show me the rows that didn't make it onto the map"
   * and auto-switches to the sheet view.
   */
  unmappedCount?: number;
};

export function CategoryFilter({
  categories,
  selected,
  onSelect,
  counts,
  unmappedCount,
}: CategoryFilterProps) {
  const allCount = categories.reduce((sum, c) => sum + (counts?.[c] ?? 0), 0);

  return (
    <Tabs
      value={selected ?? "all"}
      onValueChange={(value) => onSelect(value === "all" ? null : value)}
      className="w-full"
    >
      <TabsList className="inline-flex h-auto w-full flex-wrap justify-start gap-1 rounded-xl bg-transparent p-0">
        <TabsTrigger
          value="all"
          className="rounded-full border border-border/60 bg-background/70 px-3 py-1.5 text-[11px] font-medium text-muted-foreground data-[state=active]:border-accent data-[state=active]:bg-accent data-[state=active]:text-primary-foreground"
        >
          All
          {allCount > 0 && (
            <span className="ml-1.5 rounded-full bg-background/40 px-1.5 py-px text-[10px] tabular-nums">
              {allCount}
            </span>
          )}
        </TabsTrigger>
        {categories.map((category) => {
          const count = counts?.[category] ?? 0;
          return (
            <TabsTrigger
              key={category}
              value={category}
              className="rounded-full border border-border/60 bg-background/70 px-3 py-1.5 text-[11px] font-medium text-muted-foreground data-[state=active]:border-accent data-[state=active]:bg-accent data-[state=active]:text-primary-foreground"
            >
              {prettifyCategoryLabel(category)}
              {count > 0 && (
                <span className="ml-1.5 rounded-full bg-background/40 px-1.5 py-px text-[10px] tabular-nums">
                  {count}
                </span>
              )}
            </TabsTrigger>
          );
        })}
        {unmappedCount !== undefined && unmappedCount > 0 && (
          <TabsTrigger
            value="__unmapped__"
            className="rounded-full border border-dashed border-accent/60 bg-accent/5 px-3 py-1.5 text-[11px] font-medium text-accent data-[state=active]:border-accent data-[state=active]:bg-accent data-[state=active]:text-primary-foreground"
          >
            Unmapped
            <span className="ml-1.5 rounded-full bg-background/40 px-1.5 py-px text-[10px] tabular-nums">
              {unmappedCount}
            </span>
          </TabsTrigger>
        )}
      </TabsList>
    </Tabs>
  );
}
