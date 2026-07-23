import { cn } from "@/lib/utils";

/**
 * LSI mark — a celebratory figure (gilded sun-burst + arms-raised stickman)
 * standing on a crimson ribbon banner, with "LSI" rendered in a classic
 * marquee block. Pinned to the Atlanta Atlas theme colors:
 *
 *   - Gilded yellow  → #F5C518  (figure / accent)
 *   - Crimson red    → #C8242E  (ribbon / banner)
 *   - Marquee black  → #111111  (type block)
 *   - Parchment      → #FAF7F2  (outline / type on marquee)
 *
 * The single inline-SVG mark is rendered at any size; the wordmark variant
 * pairs the mark with a small "LSI" lockup and a sub-rule.
 */

type LogoSize = "sm" | "md" | "lg";

const containerBySize: Record<
  LogoSize,
  { box: string; mark: number; text: string; wordmark: boolean }
> = {
  sm: { box: "h-8", mark: 26, text: "text-[12.5px]", wordmark: true },
  md: { box: "h-10", mark: 34, text: "text-[14px]", wordmark: true },
  lg: { box: "h-14", mark: 46, text: "text-[19px]", wordmark: true },
};

export function LsiMark({
  size = 38,
  className,
}: {
  size?: number;
  className?: string;
}) {
  // viewBox is 120 wide x 140 tall so the vertical mark (rays + figure +
  // ribbon + marquee) reads cleanly at every size from 16px to 96px.
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

      {/* Head — solid yellow circle. */}
      <circle cx="60" cy="28" r="9" fill="#F5C518" stroke="#111111" strokeWidth="1.6" />

      {/* Arms raised in a V — stylized stickman body & arms (gilded). */}
      <g
        stroke="#F5C518"
        strokeWidth="5.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        {/* Body */}
        <path d="M60 37 L60 68" />
        {/* Left arm up-and-out */}
        <path d="M60 44 L40 30" />
        {/* Right arm up-and-out */}
        <path d="M60 44 L80 30" />
        {/* Legs (splayed, celebratory stance) */}
        <path d="M60 68 L48 88" />
        <path d="M60 68 L72 88" />
      </g>
      {/* Black outline layer — re-traces the yellow figure on top of it so
          the stickman holds its shape against light card backgrounds. */}
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
        {/* Body */}
        <path d="M60 37 L60 68" />
        {/* Left arm up-and-out */}
        <path d="M60 44 L40 30" />
        {/* Right arm up-and-out */}
        <path d="M60 44 L80 30" />
        {/* Legs (splayed, celebratory stance) */}
        <path d="M60 68 L48 88" />
        <path d="M60 68 L72 88" />
      </g>

      {/* Crimson ribbon banner with notched ends. */}
      <g>
        {/* Drop-shadow strip behind the ribbon for a subtle depth cue. */}
        <polygon
          points="14,96 22,86 106,90 98,100 106,110 22,114 14,104"
          fill="#7A1218"
          opacity="0.55"
          transform="translate(0,2)"
        />
        {/* Main ribbon body. */}
        <polygon
          points="18,92 26,82 102,86 94,98 102,110 26,114 18,104"
          fill="#C8242E"
          stroke="#111111"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        {/* Center ribbon diamond accent. */}
        <polygon
          points="56,86 64,98 56,110 48,98"
          fill="#A31C26"
          opacity="0.55"
        />
      </g>

      {/* Marquee block — bold black rounded rect.
          Kept type-free at icon-sizes (the AppHeader always pairs this mark with
          an explicit "LSI" wordmark, so any text here would alias into a smudge).
          At lg/md it reads as a clean theatrical-sign silhouette. */}
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
        {/* Subtle pinstripe ribbon of yellow at the very bottom. */}
        <rect x="22" y="131" width="76" height="3" fill="#F5C518" />
      </g>
    </svg>
  );
}

export function LsiLogo({
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
      <LsiMark size={cfg.mark} className="-mt-0.5" />
      {withWordmark && (
        <div className="flex flex-col leading-none">
          <span
            className={cn(
              "font-display font-bold uppercase tracking-[0.04em] text-[#111111]",
              cfg.text,
            )}
          >
            LSI
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
