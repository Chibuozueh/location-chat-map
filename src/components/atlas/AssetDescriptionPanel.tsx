import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AtSign,
  Globe,
  Mail,
  MapPin,
  Phone,
  X,
} from "lucide-react";
import {
  CATEGORY_LABEL,
  FEATURE_LABEL,
  PRICE_SYMBOL,
  type LocationDoc,
} from "./types";
import {
  hasAiStandardizedAddress,
  resolveDisplayAddress,
} from "@/lib/csv-import";

/**
 * Prefix https:// to bare hostnames so <a href> resolves correctly.
 * (Local copy — kept colocated with this component rather than
 * extracted to a shared util to avoid cross-file refactoring.)
 */
function normalizeUrl(s: string): string {
  const t = s.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  if (/^www\./i.test(t)) return `https://${t}`;
  return `https://${t}`;
}

/** Keep only digits + # * + so tel: links are well-formed. */
function sanitizePhone(s: string): string {
  return s.replace(/[^0-9+#*]/g, "");
}

/**
 * Layout-anchored floating description panel — sibling of the
 * pin-anchored `<DescriptionCard>` rendered inside `<MapView>`.
 *
 * Use case: when the user is in **Sheet / Tools** view and picks an
 * asset row (or the chat cites one, or the chat-panel "Look up"
 * autocomplete), the pin-anchored variant inside `<MapView>` does
 * not render because there's no map. This component shows the same
 * description, contact strip, and tag-line chrome as a fixed position
 * overlay on the right side of the page so the picked asset is
 * always visible regardless of which view is active.
 *
 * Layout:
 *   - Mobile: full-width bottom sheet (sticks to the bottom of the
 *     viewport via `fixed inset-x-3 bottom-3`).
 *   - Desktop: bottom-right floating panel (right-6 bottom-6,
 *     max-w-md).
 *
 * The component is mount/unmount-aware via `<AnimatePresence>` plus
 * `key={loc.slug}` so each new selection animates in fresh.
 */
export function AssetDescriptionPanel({
  loc,
  onClose,
}: {
  loc: LocationDoc | null;
  onClose: () => void;
}) {
  // ESC closes the panel from anywhere in the document.
  useEffect(() => {
    if (!loc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loc, onClose]);

  return (
    <AnimatePresence>
      {loc && (
        <motion.div
          key={loc.slug}
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 240, damping: 26 }}
          role="dialog"
          aria-label={`Description for ${loc.name}`}
          className="pointer-events-auto fixed inset-x-3 bottom-3 top-auto z-[700] flex max-h-[80vh] flex-col overflow-hidden rounded-2xl border border-[#6e0e1e] bg-[#faf7f2] shadow-pop ring-1 ring-[#6e0e1e1f] sm:bottom-6 sm:left-auto sm:right-6 sm:top-auto sm:max-h-[78vh] sm:w-[330px]"
        >
          {/* Header — category tag + asset name + tagline + close */}
          <div className="flex items-start justify-between gap-2 border-b border-[#6e0e1e33] bg-[#6e0e1e0d] px-4 py-3">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6e0e1e]">
                {CATEGORY_LABEL[loc.category] ?? loc.category}
              </div>
              <div className="mt-0.5 truncate font-display text-[15px] font-semibold leading-tight text-[#0e0a0b]">
                {loc.name}
              </div>
              {loc.tagline && (
                <div className="mt-1 line-clamp-2 text-[12px] leading-snug text-[#0e0a0b]/70">
                  {loc.tagline}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close description"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#6e0e1e] transition hover:bg-[#6e0e1e1a]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Scrollable description — primary affordance */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#0e0a0b]">
              {loc.description ? (
                loc.description
              ) : (
                <span className="text-muted-foreground">
                  No description provided in the spreadsheet.
                </span>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[#6e0e1e1f] pt-3">
              <span className="rounded-full border border-[#6e0e1e] bg-[#6e0e1e0d] px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-[#6e0e1e]">
                ★ {loc.rating.toFixed(1)}
              </span>
              <span className="rounded-full border border-border/60 bg-background/40 px-2 py-0.5 text-[10.5px] text-muted-foreground">
                {PRICE_SYMBOL[loc.priceTier] ?? "—"}
              </span>
              {loc.features.slice(0, 3).map((f) => (
                <span
                  key={f}
                  className="rounded-full border border-border/60 bg-background/40 px-2 py-0.5 text-[10px] text-secondary-foreground"
                >
                  {FEATURE_LABEL[f] ?? f}
                </span>
              ))}
            </div>
          </div>

          {/* AI-cleaned address strip — compact, clickable, replaces the
              previous toggle+reveal block. Falls back gracefully to the
              raw address when the AI didn't standardize. */}
          {(() => {
            const addr = resolveDisplayAddress(loc);
            const aiOk = hasAiStandardizedAddress(loc);
            const line = [addr.street, [addr.city, addr.state, addr.postalCode].filter(Boolean).join(", ")]
              .filter(Boolean)
              .join(", ");
            if (!line && !loc.address) return null;
            const gmapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
              [addr.street, addr.city, addr.state, addr.postalCode]
                .filter(Boolean)
                .join(", "),
            )}`;
            return (
              <a
                href={gmapsHref}
                target="_blank"
                rel="noreferrer"
                className="flex shrink-0 items-start gap-1.5 border-t border-[#6e0e1e1f] px-3 py-2 text-[11px] leading-snug text-secondary-foreground transition hover:bg-[#6e0e1e0d]"
                title={
                  aiOk
                    ? "Atlas Map AI standardized this address"
                    : "Showing the raw spreadsheet address"
                }
              >
                <MapPin className="mt-[2px] h-3 w-3 shrink-0 text-[#6e0e1e]" />
                <span className="flex-1 tabular-nums text-[#0e0a0b]">
                  {line || loc.address}
                </span>
                {!aiOk && loc.cleanedConfidence === "unavailable" && (
                  <span className="rounded-full border border-border bg-background/40 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                    raw
                  </span>
                )}
              </a>
            );
          })()}

          {/* Contact strip — always visible at the bottom */}
          {(loc.website ||
            loc.socialMedia ||
            loc.contactName ||
            loc.contactPhone ||
            loc.contactEmail) && (
            <div className="shrink-0 flex flex-wrap gap-1.5 border-t border-[#6e0e1e1f] bg-[#faf7f2] px-4 py-3">
              {loc.contactName && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/40 px-2.5 py-1 text-[11.5px] text-secondary-foreground">
                  <AtSign className="h-3 w-3 text-[#6e0e1e]" />
                  <span className="truncate max-w-[140px]">{loc.contactName}</span>
                </span>
              )}
              {loc.website && (
                <a
                  href={normalizeUrl(loc.website)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#6e0e1e] bg-[#6e0e1e0d] px-2.5 py-1 text-[11.5px] font-semibold text-[#6e0e1e] transition hover:bg-[#6e0e1e1f]"
                >
                  <Globe className="h-3 w-3" /> Website
                </a>
              )}
              {loc.socialMedia && (
                <a
                  href={normalizeUrl(loc.socialMedia)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/40 px-2.5 py-1 text-[11.5px] font-medium text-secondary-foreground transition hover:border-[#6e0e1e] hover:bg-[#6e0e1e0d]"
                >
                  <AtSign className="h-3 w-3 text-[#6e0e1e]" /> Social
                </a>
              )}
              {loc.contactPhone && (
                <a
                  href={`tel:${sanitizePhone(loc.contactPhone)}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/40 px-2.5 py-1 text-[11.5px] font-medium text-secondary-foreground transition hover:border-[#6e0e1e] hover:bg-[#6e0e1e0d]"
                >
                  <Phone className="h-3 w-3 text-[#6e0e1e]" />
                  <span className="tabular-nums truncate max-w-[120px]">
                    {loc.contactPhone}
                  </span>
                </a>
              )}
              {loc.contactEmail && (
                <a
                  href={`mailto:${loc.contactEmail}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/40 px-2.5 py-1 text-[11.5px] font-medium text-secondary-foreground transition hover:border-[#6e0e1e] hover:bg-[#6e0e1e0d]"
                >
                  <Mail className="h-3 w-3 text-[#6e0e1e]" /> Email
                </a>
              )}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
