import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Accessibility,
  AtSign,
  Bath,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Globe,
  Heart,
  Mail,
  MapPin,
  Navigation,
  Phone,
  Sparkles,
  Star,
  TramFront,
  Users,
  Wifi,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  CATEGORY_LABEL,
  FEATURE_LABEL,
  PRICE_SYMBOL,
  PRICE_TONE,
  type LocationDoc,
} from "./types";

const FEATURE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "public-wifi": Wifi,
  "transit-accessible": TramFront,
  "wheelchair-accessible": Accessibility,
  "youth-programs": Users,
  "senior-programs": Heart,
  restrooms: Bath,
  "open-weekends": CalendarDays,
  free: Sparkles,
};

function dayLabel(i: number): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][i];
}

/** Prefix https:// to bare hostnames so <a href> resolves correctly. */
function normalizeUrl(s: string): string {
  const t = s.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  if (/^www\./i.test(t)) return `https://${t}`;
  return `https://${t}`;
}

/** Pretty-print a phone for display while keeping tel: clean. */
function sanitizePhone(s: string): string {
  return s.replace(/[^0-9+#*]/g, "");
}

function isCurrentlyOpen(loc: LocationDoc, now = new Date()): boolean {
  const dayKey =
    ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][now.getDay()] as
      | "sun"
      | "mon"
      | "tue"
      | "wed"
      | "thu"
      | "fri"
      | "sat";
  const d = loc.hours[dayKey];
  if (!d || d.open === "—" || d.close === "—") return false;
  const openM = (() => {
    const m = d.open.split(":");
    return parseInt(m[0], 10) * 60 + parseInt(m[1], 10);
  })();
  const closeM = (() => {
    const m = d.close.split(":");
    return parseInt(m[0], 10) * 60 + parseInt(m[1], 10);
  })();
  const curM = now.getHours() * 60 + now.getMinutes();
  return curM >= openM && curM < closeM;
}

function LocationCover({
  src,
  alt,
  initial,
  accent,
}: {
  src?: string;
  alt: string;
  initial: string;
  accent: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div
        className="grid h-full w-full place-items-center text-[44px] font-display font-semibold text-white/95"
        style={{
          background: `linear-gradient(135deg, ${accent} 0%, oklch(0.4 0.06 60) 100%)`,
        }}
        aria-label={alt}
      >
        {initial}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  );
}

export function LocationCard(props: {
  loc: LocationDoc | null;
  onClose: () => void;
}) {
  const { loc, onClose } = props;
  const [showAddress, setShowAddress] = useState(false);
  const [copied, setCopied] = useState(false);
  // Reset toggle when selection changes
  useEffect(() => {
    setShowAddress(false);
    setCopied(false);
  }, [loc?.slug]);
  if (!loc) return null;
  const open = isCurrentlyOpen(loc);
  const today = dayLabel(new Date().getDay());
  const accent = loc.accentColor || "#A47551";

  return (
    <motion.div
      key={loc.slug}
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 240, damping: 26 }}
      className="pointer-events-auto w-full max-w-xl overflow-hidden rounded-2xl border border-border/70 bg-card shadow-pop"
    >
      <div className="grid grid-cols-5 gap-0">
        <div className="col-span-5 h-44 overflow-hidden bg-muted sm:col-span-2 sm:h-full">
          <LocationCover
            src={loc.imageUrl}
            alt={loc.name}
            initial={loc.name.charAt(0)}
            accent={accent}
          />
        </div>
        <div className="col-span-5 relative flex flex-col gap-3 p-5 sm:col-span-3">
          <button
            onClick={onClose}
            className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-background/80 text-muted-foreground backdrop-blur transition hover:bg-background"
            aria-label="Close detail card"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: accent }}
            />
            {CATEGORY_LABEL[loc.category] ?? loc.category}
            <span className="ml-auto text-[11px] text-muted-foreground/80">
              {PRICE_TONE[loc.priceTier] ?? PRICE_SYMBOL[loc.priceTier]}
            </span>
          </div>
          <div>
            <h3 className="font-display text-[22px] font-semibold leading-tight tracking-[-0.01em]">
              {loc.name}
            </h3>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              {loc.tagline}
            </p>
          </div>
          <div className="flex items-center gap-3 text-[12.5px]">
            <span className="inline-flex items-center gap-1 font-medium">
              <Star className="h-3.5 w-3.5 fill-accent text-accent" />
              {loc.rating.toFixed(1)}
            </span>
            <span className="text-muted-foreground">
              {loc.reviewCount.toLocaleString()} monthly visits
            </span>
            <span className="ml-auto">
              <Badge
                variant={open ? "default" : "secondary"}
                className={open ? "bg-accent text-accent-foreground" : ""}
              >
                <span
                  className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${open ? "bg-white" : "bg-muted-foreground"}`}
                />
                {open ? "Open today" : "Closed now"}
              </Badge>
            </span>
          </div>
          {/* Address toggle + reveal — formerly an inline block; now collapsed by
              default so the description / contact strip remain the focal elements. */}
          {(loc.address || loc.city || loc.state || loc.postalCode) && (
            <div className="mt-1">
              <button
                type="button"
                onClick={() => setShowAddress((s) => !s)}
                aria-expanded={showAddress}
                aria-label={
                  showAddress ? "Hide asset address" : "Show asset address"
                }
                className="inline-flex items-center gap-1.5 rounded-full border border-[#6e0e1e] bg-[#6e0e1e0d] px-2.5 py-1 text-[12px] font-semibold text-[#6e0e1e] transition hover:bg-[#6e0e1e1f]"
              >
                <MapPin className="mt-[1px] h-3.5 w-3.5 shrink-0" />
                {showAddress ? "Hide address" : "Show address"}
                {showAddress ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
              <AnimatePresence initial={false}>
                {showAddress && (
                  <motion.div
                    key="addr"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                    className="overflow-hidden"
                  >
                    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-[#6e0e1e33] bg-[#6e0e1e0d] px-3 py-2 text-[12.5px] leading-relaxed text-[#0e0a0b]">
                      <div className="flex items-start gap-2">
                        <MapPin className="mt-[2px] h-3.5 w-3.5 shrink-0 text-accent" />
                        <span className="font-medium tabular-nums">
                          {loc.address}
                          {loc.address &&
                          (loc.city || loc.state || loc.postalCode)
                            ? ", "
                            : ""}
                          {[loc.city, loc.state, loc.postalCode]
                            .filter(Boolean)
                            .join(", ")}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 pl-[22px]">
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                            [loc.address, loc.city, loc.state, loc.postalCode]
                              .filter(Boolean)
                              .join(", "),
                          )}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-full border border-[#6e0e1e] bg-[#6e0e1e0d] px-2 py-0.5 text-[10.5px] font-semibold text-[#6e0e1e] transition hover:bg-[#6e0e1e1f]"
                        >
                          <Navigation className="h-3 w-3" /> Directions
                        </a>
                        <button
                          type="button"
                          onClick={() => {
                            const text = [
                              loc.address,
                              loc.city,
                              loc.state,
                              loc.postalCode,
                            ]
                              .filter(Boolean)
                              .join(", ");
                            if (!text) return;
                            if (
                              typeof navigator !== "undefined" &&
                              navigator.clipboard?.writeText
                            ) {
                              navigator.clipboard
                                .writeText(text)
                                .then(() => {
                                  setCopied(true);
                                  setTimeout(
                                    () => setCopied(false),
                                    2000,
                                  );
                                })
                                .catch(() => {});
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/40 px-2 py-0.5 text-[10.5px] font-medium text-secondary-foreground transition hover:border-accent/60 hover:bg-accent/10"
                        >
                          {copied ? (
                            <>
                              <Check className="h-3 w-3 text-accent" /> Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3 text-accent" /> Copy
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
          {/* Contact strip — only renders when at least one is populated. */}
          {(loc.contactName ||
            loc.website ||
            loc.socialMedia ||
            loc.contactPhone ||
            loc.contactEmail) && (
            <div className="flex flex-wrap gap-1.5">
              {loc.contactName && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/40 px-2.5 py-1 text-[11.5px] text-secondary-foreground">
                  <Users className="h-3 w-3 text-accent" />
                  {loc.contactName}
                </span>
              )}
              {loc.website && (
                <a
                  href={normalizeUrl(loc.website)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#6e0e1e33] bg-[#6e0e1e0d] px-2.5 py-1 text-[11.5px] font-medium text-[#6e0e1e] transition hover:border-[#6e0e1e] hover:bg-[#6e0e1e1f]"
                >
                  <Globe className="h-3 w-3" />
                  Website
                </a>
              )}
              {loc.socialMedia && (
                <a
                  href={normalizeUrl(loc.socialMedia)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/40 px-2.5 py-1 text-[11.5px] font-medium text-secondary-foreground transition hover:border-accent/60 hover:bg-accent/10"
                >
                  <AtSign className="h-3 w-3 text-accent" />
                  Social
                </a>
              )}
              {loc.contactPhone && (
                <a
                  href={`tel:${sanitizePhone(loc.contactPhone)}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/40 px-2.5 py-1 text-[11.5px] font-medium text-secondary-foreground transition hover:border-accent/60 hover:bg-accent/10"
                >
                  <Phone className="h-3 w-3 text-accent" />
                  {loc.contactPhone}
                </a>
              )}
              {loc.contactEmail && (
                <a
                  href={`mailto:${loc.contactEmail}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/40 px-2.5 py-1 text-[11.5px] font-medium text-secondary-foreground transition hover:border-accent/60 hover:bg-accent/10"
                >
                  <Mail className="h-3 w-3 text-accent" />
                  Email
                </a>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 text-[12px]">
            <div className="rounded-lg border border-border/60 bg-background/40 p-2.5">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Sparkles className="h-3 w-3" /> Signature program
              </div>
              <div className="mt-0.5 font-medium text-foreground">
                {loc.signatureDrink}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/40 p-2.5">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Globe className="h-3 w-3" /> Operator
              </div>
              <div className="mt-0.5 font-medium text-foreground">
                {loc.ownerName ?? "—"}
              </div>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-background/40 p-2.5 text-[11.5px] text-muted-foreground">
            <Clock className="mt-[1px] h-3 w-3 shrink-0" />
            <div className="grid w-full grid-cols-7 gap-1">
              {(
                [
                  ["mon", "M"],
                  ["tue", "T"],
                  ["wed", "W"],
                  ["thu", "T"],
                  ["fri", "F"],
                  ["sat", "S"],
                  ["sun", "S"],
                ] as const
              ).map(([d, dayLabelChar]) => {
                const isToday = d === today.toLowerCase();
                const h = loc.hours[d];
                const label =
                  h.open === "—" || h.close === "—"
                    ? "Closed"
                    : `${h.open}–${h.close}`;
                return (
                  <div
                    key={d}
                    className={`rounded px-1 py-0.5 text-center ${isToday ? "bg-accent/15 text-foreground" : ""}`}
                  >
                    <div className="text-[9.5px] uppercase tracking-wider">
                      {dayLabelChar}
                    </div>
                    <div className="text-[10px] tabular-nums">{label}</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {loc.features.map((f) => {
              const Icon = FEATURE_ICONS[f] ?? Globe;
              return (
                <span
                  key={f}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/40 px-2.5 py-1 text-[11px] text-secondary-foreground"
                >
                  <Icon className="h-3 w-3 text-accent" />
                  {FEATURE_LABEL[f] ?? f}
                </span>
              );
            })}
          </div>
          {loc.description && (
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              {loc.description}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}
