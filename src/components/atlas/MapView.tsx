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
import { ArrowRight, AtSign, Globe, Mail, Phone, Plus, Minus, X } from "lucide-react";
import {
  CATEGORY_LABEL,
  FEATURE_LABEL,
  PRICE_SYMBOL,
  type LocationDoc,
} from "./types";
import type { Cluster } from "@/state/imported-data";
import { useIsMobile } from "@/hooks/use-mobile";

const DEFAULT_CENTER: [number, number] = [33.74, -84.45];
const DEFAULT_ZOOM = 12;

function escapeHtml(s: string): string {
  return s.replace(/[<>&\\\"]/g, "");
}

/**
 * Build the divIcon for a cluster. The label is still the first member's
 * first 4 words; when the cluster contains 2+ assets we attach a small
 * maroon count badge to the dot so the user knows the pin represents
 * multiple locations before clicking.
 */
function makePinIcon(
  selected: boolean,
  accent: string,
  name: string,
  count: number,
) {
  const fill = selected ? "#0e0a0b" : accent || "#6E0E1E";
  const words = name.trim().split(/\s+/).filter(Boolean).slice(0, 4);
  const labelHtml = words.map(escapeHtml).join("<br/>");
  const safeLabel = escapeHtml(words.join(" ")) || escapeHtml(name);
  const badge =
    count > 1
      ? `<div class="atlas-pin__count" aria-label="${count} assets at this location" style="position:absolute;top:-6px;right:-10px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#6E0E1E;color:#faf7f2;font:600 10.5px/18px ui-sans-serif,system-ui,sans-serif;text-align:center;border:1.5px solid #faf7f2;box-sizing:border-box;letter-spacing:0;box-shadow:0 1px 2px rgba(0,0,0,.18);">${count > 99 ? "99+" : count}</div>`
      : "";
  return L.divIcon({
    html: `
      <div class="atlas-pin" aria-label="${safeLabel}${count > 1 ? ` · ${count} assets here` : ""}">
        <div class="atlas-pin__label">${labelHtml}</div>
        <div class="atlas-pin__dot ${selected ? "atlas-pin__dot--selected" : ""}" style="background:${fill};position:relative;">
          ${badge}
        </div>
      </div>
    `,
    className: "atlas-pin-wrap",
    iconSize: [42, 104],
    iconAnchor: [21, 102],
    popupAnchor: [0, -102],
  });
}

/** Prefix https:// to bare hostnames so <a href> resolves correctly. */
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

/** Floating zoom‑in / zoom‑out buttons layered over the map. */
function ZoomControls() {
  const map = useMap();
  return (
    <div className="absolute right-3 top-3 z-[500] flex flex-col gap-px overflow-hidden rounded-lg border border-border/60 bg-card shadow-card">
      <button
        type="button"
        onClick={() => map.zoomIn()}
        aria-label="Zoom in"
        className="inline-flex h-8 w-8 items-center justify-center text-foreground transition hover:bg-accent/10 active:bg-accent/20"
      >
        <Plus className="h-4 w-4" />
      </button>
      <div className="h-px bg-border/60" />
      <button
        type="button"
        onClick={() => map.zoomOut()}
        aria-label="Zoom out"
        className="inline-flex h-8 w-8 items-center justify-center text-foreground transition hover:bg-accent/10 active:bg-accent/20"
      >
        <Minus className="h-4 w-4" />
      </button>
    </div>
  );
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
 * Computes the screen-space (container-point) coordinates for an arbitrary
 * lat/lng and reports them up on every move / zoom / resize. Also clears the
 * overlay when the user clicks empty map space.
 */
function PinAnchorTracker({
  point,
  onPointChange,
  onBackgroundClick,
}: {
  point: { lat: number; lng: number } | null;
  onPointChange: (p: AnchorPoint) => void;
  onBackgroundClick: () => void;
}) {
  const map = useMap();
  useMapEvents({
    click: () => onBackgroundClick(),
  });

  useEffect(() => {
    if (!point) {
      onPointChange({ x: 0, y: 0, visible: false });
      return;
    }
    const recompute = () => {
      const p = map.latLngToContainerPoint([point.lat, point.lng]);
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
  }, [map, point, onPointChange]);

  return null;
}

/**
 * Maroon-tinted floating description card anchored above a single asset
 * (when the cluster count is 1, or after the user picks a member out of a
 * multi-asset cluster).
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
  const isMobile = useIsMobile();
  const cardWidth = 300;
  const offsetAbove = 56;
  const left = Math.round(point.x - cardWidth / 2);
  const top = Math.round(point.y - offsetAbove);
  // On desktop, clamp left so the card doesn't clip off the left edge.
  const clampedLeft = Math.max(8, left);

  // On mobile, anchor as a bottom sheet within the map instead of pin-anchored.
  // Contact links are always visible at the bottom of the card; only the
  // description text scrolls above them.
  if (isMobile) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ type: "spring", stiffness: 240, damping: 26 }}
        className="pointer-events-auto absolute inset-x-3 bottom-3 z-[600] flex flex-col rounded-2xl border border-[#6e0e1e] bg-[#faf7f2] shadow-pop ring-1 ring-[#6e0e1e1f]"
        style={{ maxHeight: "calc(100% - 1.5rem)" }}
        role="dialog"
        aria-label={`Description for ${loc.name}`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 rounded-t-2xl border-b border-[#6e0e1e33] bg-[#6e0e1e0d] px-3 py-2">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6e0e1e]">
              {CATEGORY_LABEL[loc.category] ?? loc.category}
            </div>
            <div className="mt-0.5 truncate font-display text-[14px] font-semibold leading-tight text-[#0e0a0b]">
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
        {/* Scrollable description */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <div className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-[#0e0a0b]">
            {loc.description ? (
              loc.description
            ) : (
              <span className="text-muted-foreground">
                No description provided in the spreadsheet.
              </span>
            )}
          </div>
        </div>
        {/* Contact links — always visible at the bottom */}
        {(loc.website ||
          loc.socialMedia ||
          loc.contactName ||
          loc.contactPhone ||
          loc.contactEmail) && (
          <div className="flex shrink-0 flex-wrap gap-1.5 border-t border-[#6e0e1e1f] px-3 py-2">
            {loc.contactName && (
              <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2 py-0.5 text-[10.5px] text-secondary-foreground">
                <AtSign className="h-3 w-3 text-[#6e0e1e]" />
                <span className="truncate max-w-[120px]">{loc.contactName}</span>
              </span>
            )}
            {loc.website && (
              <a
                href={normalizeUrl(loc.website)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-[#6e0e1e] bg-[#6e0e1e0d] px-2 py-0.5 text-[10.5px] font-semibold text-[#6e0e1e] transition hover:bg-[#6e0e1e1f]"
              >
                <Globe className="h-3 w-3" /> Website
              </a>
            )}
            {loc.contactPhone && (
              <a
                href={`tel:${sanitizePhone(loc.contactPhone)}`}
                className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2 py-0.5 text-[10.5px] font-medium text-secondary-foreground transition hover:border-[#6e0e1e] hover:bg-[#6e0e1e0d]"
              >
                <Phone className="h-3 w-3 text-[#6e0e1e]" />
                <span className="tabular-nums truncate max-w-[110px]">
                  {loc.contactPhone}
                </span>
              </a>
            )}
            {loc.contactEmail && (
              <a
                href={`mailto:${loc.contactEmail}`}
                className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2 py-0.5 text-[10.5px] font-medium text-secondary-foreground transition hover:border-[#6e0e1e] hover:bg-[#6e0e1e0d]"
              >
                <Mail className="h-3 w-3 text-[#6e0e1e]" /> Email
              </a>
            )}
          </div>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 240, damping: 22 }}
      style={{ left: clampedLeft, top, width: cardWidth }}
      className="pointer-events-auto absolute z-[600] rounded-2xl border border-[#6e0e1e] bg-[#faf7f2] shadow-pop ring-1 ring-[#6e0e1e1f]"
      role="dialog"
      aria-label={`Description for ${loc.name}`}
    >
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
        {(loc.website ||
          loc.socialMedia ||
          loc.contactName ||
          loc.contactPhone ||
          loc.contactEmail) && (
          <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-[#6e0e1e1f] pt-2.5">
            {loc.contactName && (
              <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2 py-0.5 text-[10.5px] text-secondary-foreground">
                <AtSign className="h-3 w-3 text-[#6e0e1e]" />
                <span className="truncate max-w-[120px]">{loc.contactName}</span>
              </span>
            )}
            {loc.website && (
              <a
                href={normalizeUrl(loc.website)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-[#6e0e1e] bg-[#6e0e1e0d] px-2 py-0.5 text-[10.5px] font-semibold text-[#6e0e1e] transition hover:bg-[#6e0e1e1f]"
              >
                <Globe className="h-3 w-3" /> Website
              </a>
            )}
            {loc.socialMedia && (
              <a
                href={normalizeUrl(loc.socialMedia)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2 py-0.5 text-[10.5px] font-medium text-secondary-foreground transition hover:border-[#6e0e1e] hover:bg-[#6e0e1e0d]"
              >
                <AtSign className="h-3 w-3 text-[#6e0e1e]" /> Social
              </a>
            )}
            {loc.contactPhone && (
              <a
                href={`tel:${sanitizePhone(loc.contactPhone)}`}
                className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2 py-0.5 text-[10.5px] font-medium text-secondary-foreground transition hover:border-[#6e0e1e] hover:bg-[#6e0e1e0d]"
              >
                <Phone className="h-3 w-3 text-[#6e0e1e]" />
                <span className="tabular-nums truncate max-w-[110px]">
                  {loc.contactPhone}
                </span>
              </a>
            )}
            {loc.contactEmail && (
              <a
                href={`mailto:${loc.contactEmail}`}
                className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2 py-0.5 text-[10.5px] font-medium text-secondary-foreground transition hover:border-[#6e0e1e] hover:bg-[#6e0e1e0d]"
              >
                <Mail className="h-3 w-3 text-[#6e0e1e]" /> Email
              </a>
            )}
          </div>
        )}
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

/**
 * Floating picker card anchored above a multi-asset cluster. Lists every
 * member so the user can drill into any one of them.
 */
function ClusterPickerCard({
  cluster,
  point,
  onPick,
  onClose,
}: {
  cluster: Cluster;
  point: AnchorPoint;
  onPick: (slug: string) => void;
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  const cardWidth = 320;
  const offsetAbove = 56;
  const left = Math.round(point.x - cardWidth / 2);
  const top = Math.round(point.y - offsetAbove);
  const clampedLeft = Math.max(8, left);

  // On mobile, render as a bottom sheet within the map.
  if (isMobile) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ type: "spring", stiffness: 240, damping: 26 }}
        className="pointer-events-auto absolute inset-x-3 bottom-3 z-[600] rounded-2xl border border-[#6e0e1e] bg-[#faf7f2] shadow-pop ring-1 ring-[#6e0e1e1f]"
        style={{ maxHeight: "calc(100% - 1.5rem)" }}
        role="dialog"
        aria-label={`${cluster.count} assets at ${cluster.address}`}
      >
        <div className="flex items-start justify-between gap-2 rounded-t-2xl border-b border-[#6e0e1e33] bg-[#6e0e1e0d] px-3 py-2">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6e0e1e]">
              {cluster.count} assets at this address
            </div>
            <div className="mt-0.5 truncate font-display text-[13px] font-semibold leading-tight text-[#0e0a0b]">
              {cluster.address}
              {cluster.city ? `, ${cluster.city}` : ""}
              {cluster.state ? ` ${cluster.state}` : ""}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close picker"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#6e0e1e] transition hover:bg-[#6e0e1e1a]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="overflow-y-auto px-2 py-2" style={{ maxHeight: "35vh" }}>
          {cluster.members.map((m, i) => {
            const desc =
              (m as LocationDoc | { description?: string }).description ?? "";
            const accent = (m as LocationDoc).accentColor || "#A47551";
            return (
              <div
                key={m.slug}
                className="rounded-xl border border-border/40 bg-background/30 px-2.5 py-2 transition hover:border-[#6e0e1e] hover:bg-[#6e0e1e0a]"
              >
                <button
                  type="button"
                  onClick={() => onPick(m.slug)}
                  className="flex w-full items-start gap-2.5 text-left"
                >
                  <span
                    className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[12px] font-semibold text-white"
                    style={{ background: accent }}
                  >
                    {m.name?.charAt(0) ?? "•"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold text-foreground">
                      {m.name}
                    </span>
                    <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground">
                      {CATEGORY_LABEL[m.category ?? ""] ?? m.category ?? "Asset"}
                      {desc ? " · " : ""}
                      {desc && desc.length > 80
                        ? `${desc.slice(0, 78).trimEnd()}…`
                        : desc}
                    </span>
                  </span>
                  <ArrowRight
                    className="mt-1 h-3.5 w-3.5 shrink-0 text-[#6e0e1e]"
                    aria-hidden
                  />
                  <span className="sr-only">. Asset {i + 1} of {cluster.count}.</span>
                </button>
              </div>
            );
          })}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 240, damping: 22 }}
      style={{ left: clampedLeft, top, width: cardWidth }}
      className="pointer-events-auto absolute z-[600] rounded-2xl border border-[#6e0e1e] bg-[#faf7f2] shadow-pop ring-1 ring-[#6e0e1e1f]"
      role="dialog"
      aria-label={`${cluster.count} assets at ${cluster.address}`}
    >
      <span
        aria-hidden
        className="absolute -bottom-2 left-1/2 z-10 inline-block h-3.5 w-3.5 -translate-x-1/2 rotate-45 border-b border-r border-[#6e0e1e] bg-[#faf7f2]"
      />
      <div className="flex items-start justify-between gap-2 rounded-t-2xl border-b border-[#6e0e1e33] bg-[#6e0e1e0d] px-4 py-2.5">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6e0e1e]">
            {cluster.count} assets at this address
          </div>
          <div className="mt-0.5 truncate font-display text-[14px] font-semibold leading-tight text-[#0e0a0b]">
            {cluster.address}
            {cluster.city ? `, ${cluster.city}` : ""}
            {cluster.state ? ` ${cluster.state}` : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close picker"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#6e0e1e] transition hover:bg-[#6e0e1e1a]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="max-h-[280px] overflow-y-auto px-2 py-2">
        <ul className="flex flex-col gap-1">
          {cluster.members.map((m, i) => {
            const desc =
              (m as LocationDoc | { description?: string }).description ?? "";
            const accent = (m as LocationDoc).accentColor || "#A47551";
            return (
              <li
                key={m.slug}
                className="rounded-xl border border-border/40 bg-background/30 px-2.5 py-2 transition hover:border-[#6e0e1e] hover:bg-[#6e0e1e0a]"
              >
                <button
                  type="button"
                  onClick={() => onPick(m.slug)}
                  className="flex w-full items-start gap-2.5 text-left"
                >
                  <span
                    className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[12px] font-semibold text-white"
                    style={{ background: accent }}
                  >
                    {m.name?.charAt(0) ?? "•"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold text-foreground">
                      {m.name}
                    </span>
                    <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground">
                      {CATEGORY_LABEL[m.category ?? ""] ?? m.category ?? "Asset"}
                      {desc ? " · " : ""}
                      {desc && desc.length > 80
                        ? `${desc.slice(0, 78).trimEnd()}…`
                        : desc}
                    </span>
                  </span>
                  <ArrowRight
                    className="mt-1 h-3.5 w-3.5 shrink-0 text-[#6e0e1e]"
                    aria-hidden
                  />
                  <span className="sr-only">. Asset {i + 1} of {cluster.count}.</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </motion.div>
  );
}

export function MapView(props: {
  clusters: Cluster[];
  selectedSlug: string | null;
  pickerClusterKey: string | null;
  onSelect: (slug: string | null) => void;
  onOpenPicker: (clusterKey: string) => void;
  onClosePicker: () => void;
}) {
  const {
    clusters,
    selectedSlug,
    pickerClusterKey,
    onSelect,
    onOpenPicker,
    onClosePicker,
  } = props;

  /**
   * Drop any cluster whose lat/lng is non-finite BEFORE we feed it to
   * Leaflet. SEED_LOCATIONS rows added without hand-coded coordinates
   * (e.g. the second wave of Atlanta Beltline programs) produce
   * `lat: NaN, lng: NaN` from translateSeed, and react-leaflet throws
   * `Invalid LatLng object: (NaN, NaN)` if a Marker receives them.
   * These rows remain in `merged.mappable` so they still appear in
   * the LocationGrid sheet and in chat search hits — they just don't
   * plot a pin until you give them real coordinates.
   */
  const safeClusters = useMemo(
    () =>
      clusters.filter(
        (c) => Number.isFinite(c.lat) && Number.isFinite(c.lng),
      ),
    [clusters],
  );
  const [anchor, setAnchor] = useState<AnchorPoint>({
    x: 0,
    y: 0,
    visible: false,
  });

  // Pick an "anchor point" — whichever entity should drive the floating
  // overlay's screen coords. Picker wins over selection when both are set;
  // Landing keeps them mutually exclusive, but be defensive.
  const activePoint = useMemo<{
    lat: number;
    lng: number;
  } | null>(() => {
    if (pickerClusterKey) {
      const c = safeClusters.find((cl) => cl.key === pickerClusterKey);
      if (c) return { lat: c.lat, lng: c.lng };
    }
    if (selectedSlug) {
      for (const c of safeClusters) {
        const m = c.members.find((mm) => mm.slug === selectedSlug);
        if (m) return { lat: m.lat, lng: m.lng };
      }
    }
    return null;
  }, [safeClusters, selectedSlug, pickerClusterKey]);

  // Resolve the active cluster for the picker.
  const pickerCluster = useMemo(
    () =>
      pickerClusterKey
        ? safeClusters.find((c) => c.key === pickerClusterKey) ?? null
        : null,
    [safeClusters, pickerClusterKey],
  );

  // Resolve the active member for the description card.
  const selectedLoc = useMemo<LocationDoc | null>(() => {
    if (!selectedSlug) return null;
    for (const c of safeClusters) {
      const m = c.members.find((mm) => mm.slug === selectedSlug);
      if (m) return m as LocationDoc;
    }
    return null;
  }, [safeClusters, selectedSlug]);

  // Where to fly to. Mutually exclusive — picker wins for flyTo target.
  const flyTarget = useMemo<[number, number]>(() => {
    if (pickerCluster) return [pickerCluster.lat, pickerCluster.lng];
    if (selectedLoc) return [selectedLoc.lat, selectedLoc.lng];
    return DEFAULT_CENTER;
  }, [pickerCluster, selectedLoc]);

  // ESC closes whichever overlay is active.
  useEffect(() => {
    if (!selectedSlug && !pickerClusterKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pickerClusterKey) onClosePicker();
        else onSelect(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedSlug, pickerClusterKey, onSelect, onClosePicker]);

  // Count assets spanned by all safeClusters for the corner badge.
  const totalAssetCount = useMemo(
    () => safeClusters.reduce((acc, c) => acc + c.count, 0),
    [safeClusters],
  );

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
        <ZoomControls />
        <FlyTo key={selectedSlug ?? pickerClusterKey ?? "default"} center={flyTarget} />
        <PinAnchorTracker
          point={activePoint}
          onPointChange={setAnchor}
          onBackgroundClick={() => {
            if (pickerClusterKey) onClosePicker();
            if (selectedSlug) onSelect(null);
          }}
        />
        {safeClusters.map((cluster) => {
          const memberSlugs = cluster.members.map((m) => m.slug);
          const isSelected = memberSlugs.includes(selectedSlug ?? "");
          const isPicker = cluster.key === pickerClusterKey;
          const highlight = isSelected || isPicker;
          const rep = cluster.members[0];
          const repName = rep?.name ?? "Asset";
          const accent =
            (rep as LocationDoc | undefined)?.accentColor || "";
          const icon = makePinIcon(highlight, accent, repName, cluster.count);
          // Determine which click branch to fire.
          return (
            <Marker
              key={cluster.key}
              position={[cluster.lat, cluster.lng]}
              icon={icon}
              eventHandlers={{
                click: () => {
                  if (cluster.count === 1) {
                    onSelect(cluster.members[0].slug);
                    return;
                  }
                  // Toggle: if picker for this cluster is open, close it.
                  if (pickerClusterKey === cluster.key) {
                    onClosePicker();
                    return;
                  }
                  onOpenPicker(cluster.key);
                  // If a member was selected, clear it (mutually exclusive).
                  if (selectedSlug && memberSlugs.includes(selectedSlug)) {
                    onSelect(null);
                  }
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
        {totalAssetCount} assets · {safeClusters.length} locations · Southwest
        Atlanta
      </motion.div>

      {/* Floating overlay — picker (multi-asset) OR description card (single).
          AnimatePresence with mode="wait" avoids a one-frame overlap during
          the swap. */}
      <AnimatePresence mode="wait">
        {pickerCluster && anchor.visible ? (
          <ClusterPickerCard
            key={`picker:${pickerCluster.key}`}
            cluster={pickerCluster}
            point={anchor}
            onPick={(slug) => {
              onClosePicker();
              onSelect(slug);
            }}
            onClose={onClosePicker}
          />
        ) : selectedLoc && anchor.visible ? (
          <DescriptionCard
            key={`desc:${selectedLoc.slug}`}
            loc={selectedLoc}
            point={anchor}
            onClose={() => onSelect(null)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
