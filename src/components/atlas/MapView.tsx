import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  Marker,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import {
  CATEGORY_LABEL,
  FEATURE_LABEL,
  PRICE_SYMBOL,
  type LocationDoc,
} from "./types";

const DEFAULT_CENTER: [number, number] = [33.74, -84.45];
const DEFAULT_ZOOM = 12;

function makePinIcon(selected: boolean, accent: string, name: string) {
  const fill = selected
    ? "#0e0a0b"
    : accent || "#6E0E1E";
  const words = name.trim().split(/\s+/).filter(Boolean).slice(0, 4);
  const labelHtml = words.map(escapeHtml).join("<br/>");
  const safeLabel = escapeHtml(words.join(" ")) || escapeHtml(name);
  return L.divIcon({
    html: `
      <div class="atlas-pin" aria-label="${safeLabel}">
        <div class="atlas-pin__label">${labelHtml}</div>
        <div class="atlas-pin__dot ${selected ? "atlas-pin__dot--selected" : ""}" style="background:${fill}"></div>
      </div>
    `,
    className: "atlas-pin-wrap",
    iconSize: [42, 104],
    iconAnchor: [21, 102],
    popupAnchor: [0, -102],
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&\"]/g, "");
}

function FlyTo({
  center,
  zoom,
}: {
  center: [number, number];
  zoom?: number;
}) {
  const map = useMap();
  useEffect(() => {
    if (!center) return;
    map.flyTo(center, zoom ?? 14, { duration: 0.7, easeLinearity: 0.25 });
  }, [center, zoom, map]);
  return null;
}

type AnchorPoint = { x: number; y: number; visible: boolean };

/**
 * Lives inside MapContainer. Computes the selected asset's screen-space
 * (container-point) coordinates relative to the map wrapper and reports
 * them up on every move / zoom / resize. Also clears the selection when
 * the user clicks empty map space.
 */
function PinAnchorTracker({
  selectedLoc,
  onPointChange,
  onBackgroundClick,
}: {
  selectedLoc: LocationDoc | null;
  onPointChange: (p: AnchorPoint) => void;
  onBackgroundClick: () => void;
}) {
  const map = useMap();
  useMapEvents({
    click: () => onBackgroundClick(),
  });

  useEffect(() => {
    if (!selectedLoc) {
      onPointChange({ x: 0, y: 0, visible: false });
      return;
    }
    const recompute = () => {
      const p = map.latLngToContainerPoint([selectedLoc.lat, selectedLoc.lng]);
      const size = map.getSize();
      const visible =
        p.x >= 0 && p.y >= 0 && p.x <= size.x && p.y <= size.y;
      onPointChange({ x: p.x, y: p.y, visible });
    };
    recompute();
    map.on("move", recompute);
    map.on("zoom", recompute);
    map.on("resize", recompute);
    return () => {
      map.off("move", recompute);
      map.off("zoom", recompute);
      map.off("resize", recompute);
    };
  }, [map, selectedLoc, onPointChange]);

  return null;
}

/**
 * Maroon-tinted floating description card anchored above the selected asset.
 * Sits in the wrapper DOM (NOT inside the leaflet panes) so it dodges the
 * leaflet popup stacking quirks and respects the card's own z-order.
 */
function DescriptionCard({
  loc,
  point,
  onClose,
}: {
  loc: LocationDoc;
  point: AnchorPoint;
  onClose: () => void;
}) {
  const cardWidth = 300;
  const offsetAbove = 56; // distance from pin tip to card bottom edge
  const left = Math.round(point.x - cardWidth / 2);
  const top = Math.round(point.y - offsetAbove);
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 240, damping: 22 }}
      style={{ left, top, width: cardWidth }}
      className="pointer-events-auto absolute z-[600] rounded-2xl border border-[#6e0e1e] bg-[#faf7f2] shadow-pop ring-1 ring-[#6e0e1e1f]"
      role="dialog"
      aria-label={`Description for ${loc.name}`}
    >
      {/* ▼ tail pointing down toward the pin */}
      <span
        aria-hidden
        className="absolute -bottom-2 left-1/2 z-10 inline-block h-3.5 w-3.5 -translate-x-1/2 rotate-45 border-b border-r border-[#6e0e1e] bg-[#faf7f2]"
      />
      <div className="flex items-start justify-between gap-2 rounded-t-2xl border-b border-[#6e0e1e33] bg-[#6e0e1e0d] px-4 py-2.5">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6e0e1e]">
            {CATEGORY_LABEL[loc.category] ?? loc.category}
          </div>
          <div className="mt-0.5 truncate font-display text-[14.5px] font-semibold leading-tight text-[#0e0a0b]">
            {loc.name}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close description"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#6e0e1e] transition hover:bg-[#6e0e1e1a]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="px-4 py-3">
        <div className="max-h-[180px] overflow-y-auto whitespace-pre-wrap text-[12.5px] leading-relaxed text-[#0e0a0b]">
          {loc.description ? (
            loc.description
          ) : (
            <span className="text-muted-foreground">
              No description provided in the spreadsheet.
            </span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
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
    </motion.div>
  );
}

export function MapView(props: {
  locations: LocationDoc[];
  selectedSlug: string | null;
  onSelect: (slug: string | null) => void;
}) {
  const { locations, selectedSlug, onSelect } = props;
  const [anchor, setAnchor] = useState<AnchorPoint>({
    x: 0,
    y: 0,
    visible: false,
  });

  const center = useMemo<[number, number]>(() => {
    const sel = selectedSlug
      ? locations.find((l) => l.slug === selectedSlug)
      : null;
    return sel ? [sel.lat, sel.lng] : DEFAULT_CENTER;
  }, [locations, selectedSlug]);

  const selectedLoc = useMemo(
    () =>
      selectedSlug
        ? locations.find((l) => l.slug === selectedSlug) ?? null
        : null,
    [locations, selectedSlug],
  );

  // ESC closes the floating description card.
  useEffect(() => {
    if (!selectedSlug) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSelect(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedSlug, onSelect]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-border/70 bg-card shadow-card">
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        scrollWheelZoom
        className="h-full w-full"
        zoomControl={false}
        attributionControl
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> · <a href="https://carto.com/attributions">CARTO</a>'
          subdomains={["a", "b", "c", "d"]}
        />
        <FlyTo key={selectedSlug ?? "default"} center={center} />
        <PinAnchorTracker
          selectedLoc={selectedLoc}
          onPointChange={setAnchor}
          onBackgroundClick={() => {
            if (selectedSlug) onSelect(null);
          }}
        />
        {locations.map((loc) => {
          const isSelected = loc.slug === selectedSlug;
          const icon = makePinIcon(
            isSelected,
            loc.accentColor || "",
            loc.name,
          );
          return (
            <Marker
              key={loc.slug}
              position={[loc.lat, loc.lng]}
              icon={icon}
              eventHandlers={{
                click: () => {
                  if (loc.slug === selectedSlug) onSelect(null);
                  else onSelect(loc.slug);
                },
              }}
            />
          );
        })}
      </MapContainer>

      {/* Decorative top-left attribution / count */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 rounded-full border border-border/60 bg-card/90 px-3 py-1.5 text-[11px] text-muted-foreground shadow-card backdrop-blur"
      >
        <span className="inline-block h-2 w-2 rounded-full bg-accent" />
        {locations.length} assets · Southwest Atlanta
      </motion.div>

      {/* Floating, toggleable description card anchored above the selected
          pin. Lives in the wrapper DOM (not leaflet panes) so the maroon
          card cannot be eclipsed by tile controls or popup stacking. */}
      <AnimatePresence>
        {selectedLoc && anchor.visible && (
          <DescriptionCard
            key={selectedLoc.slug}
            loc={selectedLoc}
            point={anchor}
            onClose={() => onSelect(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
