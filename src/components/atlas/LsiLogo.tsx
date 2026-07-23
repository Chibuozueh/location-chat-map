import { cn } from "@/lib/utils";

/**
 * LSI × Lewis Scholars Imhotep Project partnership wordmark.
 *
 * Renders only the 3-line typographic lockup:
 *   "Morehouse College" (small, gray uppercase tracking) — optional
 *   "Lewis Scholars"     (medium, bold display serif, maroon)
 *   "Imhotep Project"    (small, gray uppercase tracking)
 *
 * The companion SVG mark (`LsiMark`) is retained below for future use
 * (e.g. hero sections, partnership footers) but is no longer rendered
 * inline beside the wordmark in the header.
 *
 * Colors:
 *   - Morehouse maroon → #6E0E1E (wordmark accent)
 */

type LockupSize = "sm" | "md" | "lg";

const containerBySize: Record<
  LockupSize,
  { box: string; college: string; scholars: string; project: string }
> = {
  sm: {
    box: "h-10",
    college: "text-[10px]",
    scholars: "text-[14px]",
    project: "text-[11px]",
  },
  md: {
    box: "h-14",
    college: "text-[11px]",
    scholars: "text-[15px]",
    project: "text-[11.5px]",
  },
  lg: {
    box: "h-18",
    college: "text-[12px]",
    scholars: "text-[18px]",
    project: "text-[12.5px]",
  },
};

export function LsiMark({
  size = 38,
  className,
}: {
  size?: number;
  className?: string;
}) {
  // viewBox 120 wide × 140 tall so the vertical composable reads cleanly
  // from chip-sizes up to large-format lockups. Kept for future use.
  return (
    <svg
      viewBox="0 0 120 140"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={(size * 140) / 120}
      className={cn("shrink-0", className)}
      aria-hidden
    >
      {/* Sun-burst rays radiating from the head (gilded yellow). */}
      <g fill="#F5C518">
        <rect x="58.4" y="4" width="3.2" height="10" rx="1.2" />
        <rect
          x="58.4"
          y="4"
          width="3.2"
          height="10"
          rx="1.2"
          transform="rotate(30 60 28)"
        />
        <rect
          x="58.4"
          y="4"
          width="3.2"
          height="10"
          rx="1.2"
          transform="rotate(60 60 28)"
        />
        <rect
          x="58.4"
          y="4"
          width="3.2"
          height="10"
          rx="1.2"
          transform="rotate(90 60 28)"
        />
        <rect
          x="58.4"
          y="4"
          width="3.2"
          height="10"
          rx="1.2"
          transform="rotate(120 60 28)"
        />
        <rect
          x="58.4"
          y="4"
          width="3.2"
          height="10"
          rx="1.2"
          transform="rotate(150 60 28)"
        />
      </g>

      {/* Head — solid yellow circle, outlined in black. */}
      <circle cx="60" cy="28" r="9" fill="#F5C518" stroke="#111111" strokeWidth="1.6" />

      {/* Stickman body — black underlay + yellow overlay. */}
      <g
        stroke="#111111"
        strokeWidth="6.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        style={{ paintOrder: "stroke" }}
      >
        <path d="M60 37 L60 68" />
        <path d="M60 44 L40 30" />
        <path d="M60 44 L80 30" />
        <path d="M60 68 L48 88" />
        <path d="M60 68 L72 88" />
      </g>
      <g
        stroke="#F5C518"
        strokeWidth="5.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d="M60 37 L60 68" />
        <path d="M60 44 L40 30" />
        <path d="M60 44 L80 30" />
        <path d="M60 68 L48 88" />
        <path d="M60 68 L72 88" />
      </g>

      {/* Crimson ribbon banner with notched ends. */}
      <g>
        <polygon
          points="14,96 22,86 106,90 98,100 106,110 22,114 14,104"
          fill="#7A1218"
          opacity="0.55"
          transform="translate(0,2)"
        />
        <polygon
          points="18,92 26,82 102,86 94,98 102,110 26,114 18,104"
          fill="#C8242E"
          stroke="#111111"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <polygon
          points="56,86 64,98 56,110 48,98"
          fill="#A31C26"
          opacity="0.55"
        />
      </g>

      {/* Marquee block — bold black rounded rect. */}
      <g>
        <rect
          x="22"
          y="108"
          width="76"
          height="26"
          rx="4"
          fill="#111111"
          stroke="#F5C518"
          strokeWidth="1.6"
        />
        <rect x="22" y="131" width="76" height="3" fill="#F5C518" />
      </g>
    </svg>
  );
}

export function LsiLogo({
  size = "sm",
  withWordmark = true,
  hideInstitution = false,
  className,
}: {
  size?: LockupSize;
  withWordmark?: boolean;
  /** Drop the redundant "Morehouse College" line when sitting beside the
   *  primary Morehouse app logo in the header. */
  hideInstitution?: boolean;
  className?: string;
}) {
  const cfg = containerBySize[size];
  return (
    <div
      className={cn(
        "inline-flex items-center gap-3 rounded-md bg-card/60 px-2.5 py-1.5",
        cfg.box,
        className,
      )}
    >
      {withWordmark && (
        <div className="flex flex-col leading-none">
          {!hideInstitution && (
            <span
              className={cn(
                "font-sans font-semibold uppercase tracking-[0.18em] text-foreground/70",
                cfg.college,
              )}
            >
              Morehouse College
            </span>
          )}
          <span
            className={cn(
              "font-display font-bold uppercase tracking-[-0.005em] text-[#6E0E1E]",
              cfg.scholars,
              !hideInstitution && "mt-0.5",
            )}
          >
            Lewis Scholars
          </span>
          <span
            className={cn(
              "mt-0.5 font-sans font-medium uppercase tracking-[0.22em] text-foreground/80",
              cfg.project,
            )}
          >
            Imhotep Project
          </span>
        </div>
      )}
    </div>
  );
}
