import { useEffect, useMemo } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { motion } from "framer-motion";
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
    ? "oklch(0.235 0.01 50)"
    : accent || "oklch(0.62 0.124 50)";
  // Show the first 2 words of the asset name so the dot itself is useful
  // (e.g. "Senior / Zumba" instead of a single "S" letter).
  const words = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
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
    iconSize: [42, 50],
    iconAnchor: [21, 46],
    popupAnchor: [0, -42],
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&"]/g, "");
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

export function MapView(props: {
  locations: LocationDoc[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
}) {
  const { locations, selectedSlug, onSelect } = props;
  const center = useMemo<[number, number]>(() => {
    const sel = selectedSlug
      ? locations.find((l) => l.slug === selectedSlug)
      : null;
    return sel ? [sel.lat, sel.lng] : DEFAULT_CENTER;
  }, [locations, selectedSlug]);

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
              eventHandlers={{ click: () => onSelect(loc.slug) }}
            >
              <Popup closeOnEscapeKey maxWidth={300} minWidth={240}>
                <div className="p-4">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    {CATEGORY_LABEL[loc.category] ?? loc.category}
                  </div>
                  <div className="mt-1 font-display text-[15px] font-semibold leading-snug">
                    {loc.name}
                  </div>
                  {loc.tagline && (
                    <div className="mt-1 text-[12px] text-muted-foreground">
                      {loc.tagline}
                    </div>
                  )}
                  {/* Description box — primary content surfaced when
                      a pin is clicked. */}
                  {loc.description && (
                    <div className="mt-3 rounded-lg border border-border/60 bg-background/40 p-2.5 text-[12px] leading-relaxed text-foreground">
                      {loc.description}
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-2 text-[12px]">
                    <span className="font-medium">★ {loc.rating.toFixed(1)}</span>
                    <span className="text-muted-foreground">
                      ({loc.reviewCount.toLocaleString()})
                    </span>
                    <span className="ml-auto text-muted-foreground">
                      {PRICE_SYMBOL[loc.priceTier] ?? "—"}
                    </span>
                  </div>
                  {loc.features.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {loc.features.slice(0, 3).map((f) => (
                        <span
                          key={f}
                          className="rounded-full border border-border/60 bg-secondary/60 px-2 py-0.5 text-[10px] text-secondary-foreground"
                        >
                          {FEATURE_LABEL[f] ?? f}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
      {/* Decorative top-left attribution / legend */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 rounded-full border border-border/60 bg-card/90 px-3 py-1.5 text-[11px] text-muted-foreground shadow-card backdrop-blur"
      >
        <span className="inline-block h-2 w-2 rounded-full bg-accent" />
        {locations.length} assets · Southwest Atlanta
      </motion.div>
    </div>
  );
}
