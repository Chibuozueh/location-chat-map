import type { Doc } from "@/convex/_generated/dataModel";

export type LocationDoc = Doc<"locations">;

export const PRICE_SYMBOL: Record<number, string> = {
  0: "Free",
  1: "Sliding",
  2: "Paid",
};

export const PRICE_TONE: Record<number, string> = {
  0: "Free — open to all",
  1: "Sliding-scale",
  2: "Paid service",
};

export const CATEGORY_LABEL: Record<string, string> = {
  park: "Park / green space",
  "recreation-center": "Recreation center",
  school: "School",
  clinic: "Clinic",
  library: "Library",
  "community-center": "Community center",
  museum: "Museum / heritage site",
  transit: "Transit station",
};

export const FEATURE_LABEL: Record<string, string> = {
  "public-wifi": "Public Wi-Fi",
  "transit-accessible": "Transit accessible",
  "wheelchair-accessible": "Wheelchair accessible",
  "youth-programs": "Youth programs",
  "senior-programs": "Senior programs",
  restrooms: "Restrooms on-site",
  "open-weekends": "Open weekends",
  free: "Free to use",
};

export type ChatMessage = {
  id: string;
  role: "user" | "atlas";
  content: string;
  matched?: LocationDoc[];
  intent?: any;
  pending?: boolean;
};

export type AtlasIntent = {
  category: string | null;
  features: string[];
  priceMax: number | null;
  priceMin: number | null;
  wantTopRated: boolean;
  wantCheapest: boolean;
  wantOpenNow: boolean;
  nameMention: string | null;
  generalAsset: boolean;
  matchedSignals: string[];
};

export type SearchResponse = {
  answer: string;
  intent: AtlasIntent;
  matched: LocationDoc[];
  total: number;
};
