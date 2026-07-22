import type { Doc } from "@/convex/_generated/dataModel";

export type LocationDoc = Doc<"locations">;

export const PRICE_SYMBOL: Record<number, string> = {
  1: "$",
  2: "$$",
  3: "$$$",
};

export const CATEGORY_LABEL: Record<string, string> = {
  "espresso-bar": "Espresso bar",
  "pour-over": "Pour-over",
  brunch: "Brunch",
  bakery: "Bakery",
  roastery: "Roastery",
  "tea-house": "Tea house",
  "quick-serve": "Quick-serve",
};

export const FEATURE_LABEL: Record<string, string> = {
  wifi: "Wi-Fi",
  outdoor: "Outdoor seating",
  "pet-friendly": "Pet friendly",
  "power-outlets": "Power outlets",
  quiet: "Quiet",
};

export const FEATURE_ICON: Record<string, "wifi" | "tree" | "paw" | "plug" | "volume"> = {
  wifi: "wifi",
  outdoor: "tree",
  "pet-friendly": "paw",
  "power-outlets": "plug",
  quiet: "volume",
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
  generalCoffee: boolean;
  matchedSignals: string[];
};

export type SearchResponse = {
  answer: string;
  intent: AtlasIntent;
  matched: LocationDoc[];
  total: number;
};
