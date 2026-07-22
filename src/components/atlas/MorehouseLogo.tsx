import { cn } from "@/lib/utils";

/**
 * The Atlanta Atlas mark — Morehouse Maroon stylized "M" with a thin
 * parchment outline, paired with the "MOREHOUSE" wordmark.
 *
 * Colors are pinned to Morehouse College brand:
 *   - Maroon PMS 202  → #6E0E1E  (primary)
 *   - White outline   → #FAF7F2  (paper)
 */

const M_GLYPH = "M12 14 L36 14 Q38.5 14 39.6 15.7 L50 33.4 L60.4 15.7 Q61.5 14 64 14 L88 14 L88 84 Q88 86 86 86 L72 86 Q70 86 70 84 L70 36 L57.4 56.6 Q56 59 53 59 L47 59 Q44 59 42.6 56.6 L30 36 L30 84 Q30 86 28 86 L14 86 Q12 86 12 84 Z";

export type LogoSize = "sm" | "md" | "lg";

const containerBySize: Record<LogoSize, { box: string; m: number; text: string; wordmark: boolean }> = {
  sm: { box: "h-8", m: 26, text: "text-[12.5px]", wordmark: true },
  md: { box: "h-10", m: 34, text: "text-[14px]", wordmark: true },
  lg: { box: "h-14", m: 46, text: "text-[19px]", wordmark: true },
};

export function MorehouseMark({
  size = 38,
  className,
  withOutline = true,
}: {
  size?: number;
  className?: string;
  withOutline?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <path
        d={M_GLYPH}
        fill="#6E0E1E"
        stroke={withOutline ? "#FAF7F2" : "transparent"}
        strokeWidth={withOutline ? 2.6 : 0}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MorehouseLogo({
  size = "sm",
  withWordmark = true,
  className,
}: {
  size?: LogoSize;
  withWordmark?: boolean;
  className?: string;
}) {
  const cfg = containerBySize[size];
  return (
    <div className={cn("inline-flex items-center gap-2.5", cfg.box, className)}>
      <MorehouseMark
        size={cfg.m}
        className="-mt-0.5"
      />
      {withWordmark && (
        <div className="flex flex-col leading-none">
          <span
            className={cn(
              "font-display font-bold uppercase tracking-[0.04em] text-[#6E0E1E]",
              cfg.text,
            )}
          >
            Morehouse
          </span>
          {size !== "sm" && (
            <span className="mt-1 font-sans text-[9.5px] uppercase tracking-[0.22em] text-foreground/60">
              Southwest ATL asset map
            </span>
          )}
        </div>
      )}
    </div>
  );
}
