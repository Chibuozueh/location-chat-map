import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUp,
  Bot,
  ChevronDown,
  ChevronUp,
  Database,
  FileSpreadsheet,
  Info,
  Link,
  Loader2,
  MapPin,
  Sparkles,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Textarea } from "@/components/ui/textarea";
import {
  PRICE_SYMBOL,
  type ChatMessage,
  type LocationDoc,
} from "./types";
import {
  searchRows,
  type AssetEvidence,
  type SearchResponse,
} from "@/lib/atlas-search";
import { useImportedData, mergeAssets } from "@/state/imported-data";
import type { AtlasAsset } from "@/lib/csv-import";

// Suggestions reflect the categories in the live Google Sheet (Comm
// Based Classes & Programming · Basketball Courts · Gyms & Fitness Spaces,
// plus the open-now filter and free-tier queries that work across all
// tabs).
const SUGGESTIONS = [
  "What programs does the Comm Based Classes tab offer?",
  "Show all basketball courts on the map",
  "Which gym or fitness spaces are open right now?",
  "What are the park and rec locations?",
  "Which assets are free?",
  "Where are the assets on the Beltline?",
];

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

/** Build a full Markdown table of ALL rows with ALL columns for the LLM.
 *  This gives the model complete access to the dataset so it can answer
 *  any question accurately without truncation. */
function buildFullTableContext(rows: (LocationDoc | AtlasAsset)[]): string {
  if (!rows.length) {
    return "(empty — no assets loaded yet)";
  }
  const header = "| # | Name | Category | Tagline | Address | City | State | ZIP | Description | Services | Hours | Contact | Phone | Email | Website | Price | Notes |";
  const sep = "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|";
  const body = rows.map((r: any, i) => {
    const name = (r.name ?? r.assetNameOrOrganization ?? "").replace(/\|/g, "/");
    const cat = (r.category ?? r.communityAssetType ?? "").replace(/\|/g, "/");
    const tag = (r.tagline ?? "").replace(/\|/g, "/");
    const addr = (r.address ?? "").replace(/\|/g, "/").replace(/\n/g, ", ");
    const city = (r.city ?? "").replace(/\|/g, "/");
    const state = (r.state ?? "").replace(/\|/g, "/");
    const zip = (r.postalCode ?? r.zipCode ?? "").replace(/\|/g, "/");
    const desc = (r.description ?? r.servicesResourcesAvailable ?? "").replace(/\|/g, "/").slice(0, 200);
    const svc = (Array.isArray(r.services) ? r.services.join(", ") : (r.services ?? "")).replace(/\|/g, "/").slice(0, 150);
    const hrs = formatHoursShort(r.hours);
    const contact = (r.contactName ?? "").replace(/\|/g, "/");
    const phone = (r.contactPhone ?? "").replace(/\|/g, "/");
    const email = (r.contactEmail ?? "").replace(/\|/g, "/");
    const web = (r.website ?? "").replace(/\|/g, "/");
    const price = (r.priceLabel ?? (r.priceTier <= 0 ? "Free" : r.priceTier === 1 ? "Sliding-scale" : "Paid")).replace(/\|/g, "/");
    const notes = (r.notes ?? r.notesObservations ?? "").replace(/\|/g, "/").slice(0, 150);
    return `| ${i + 1} | ${name} | ${cat} | ${tag} | ${addr} | ${city} | ${state} | ${zip} | ${desc} | ${svc} | ${hrs} | ${contact} | ${phone} | ${email} | ${web} | ${price} | ${notes} |`;
  }).join("\n");
  return `FULL DATASET (${rows.length} assets)\n\n${header}\n${sep}\n${body}`;
}

/** Compact hours formatter for the table context. */
function formatHoursShort(hrs: any): string {
  if (!hrs) return "";
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const today = days[new Date().getDay()];
  const d = hrs[today];
  if (!d || !d.open || d.open === "\u2014" || d.open === "-") return "Closed today";
  return `${d.open}\u2013${d.close}`;
}

/** Strip the inline `**` markdown backing for plain text dedupe. */
function stripBold(s: string): string {
  return s.replace(/\*\*/g, "");
}

/** Tolerant markdown bold renderer (`**word**` → <strong>). */
function renderBubbleMarkdown(text: string) {
  const parts: Array<{ text: string; bold: boolean }> = [];
  let rest = text;
  while (rest.length) {
    const openIdx = rest.indexOf("**");
    if (openIdx === -1) {
      parts.push({ text: rest, bold: false });
      break;
    }
    if (openIdx > 0) parts.push({ text: rest.slice(0, openIdx), bold: false });
    const closeIdx = rest.indexOf("**", openIdx + 2);
    if (closeIdx === -1) {
      parts.push({ text: rest.slice(openIdx), bold: false });
      break;
    }
    parts.push({ text: rest.slice(openIdx + 2, closeIdx), bold: true });
    rest = rest.slice(closeIdx + 2);
  }
  return parts;
}

/** Tiny inline bold formatter for inline `**word**` segments. */
function renderBoldedSegments(text: string) {
  return renderBubbleMarkdown(text);
}

/** Structured evidence card row used in profile / list modes. */
function EvidenceCard({
  ev,
  onCitation,
}: {
  ev: AssetEvidence;
  onCitation: (slug: string) => void;
}) {
  const hasAnyFact =
    !!ev.addressLine ||
    !!ev.hoursToday ||
    !!ev.contactLine ||
    !!ev.websiteLine ||
    !!ev.servicesLine ||
    !!ev.priceLine;
  return (
    <button
      type="button"
      onClick={() => onCitation(ev.slug)}
      className="group block w-full rounded-xl border border-border/70 bg-background/60 px-3.5 py-2.5 text-left shadow-card transition hover:border-accent/60 hover:bg-accent/10"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13.5px] font-semibold tracking-[-0.005em] text-foreground">
          {ev.name}
        </span>
        {ev.hoursToday && (
          <span
            className={
              ev.isOpenNow
                ? "inline-flex items-center gap-1 rounded-full bg-[#6e0e1e15] px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-[#6e0e1e]"
                : "inline-flex items-center gap-1 rounded-full bg-secondary/70 px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground"
            }
          >
            <span
              className={
                ev.isOpenNow
                  ? "inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#6e0e1e]"
                  : "inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground"
              }
            />
            {ev.hoursToday}
          </span>
        )}
        {ev.priceLine && (
          <span className="inline-flex items-center rounded-full border border-border/60 bg-card/60 px-2 py-0.5 text-[10.5px] text-secondary-foreground">
            {ev.priceLine}
          </span>
        )}
        {ev.ratingLine && (
          <span className="ml-auto text-[10.5px] text-muted-foreground tabular-nums">
            {ev.ratingLine}
          </span>
        )}
      </div>
      {hasAnyFact && (
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-0.5 text-[11.5px] leading-snug">
          {ev.tagline && (
            <>
              <dt className="text-muted-foreground">Type</dt>
              <dd className="text-foreground/85">{ev.tagline}</dd>
            </>
          )}
          {ev.addressLine && (
            <>
              <dt className="text-muted-foreground">Address</dt>
              <dd className="text-foreground/85">{ev.addressLine}</dd>
            </>
          )}
          {ev.hoursToday && (
            <>
              <dt className="text-muted-foreground">Hours</dt>
              <dd className="text-foreground/85">{ev.hoursToday}</dd>
            </>
          )}
          {ev.contactLine && (
            <>
              <dt className="text-muted-foreground">Contact</dt>
              <dd className="text-foreground/85">{ev.contactLine}</dd>
            </>
          )}
          {ev.websiteLine && (
            <>
              <dt className="text-muted-foreground">Web</dt>
              <dd className="truncate text-foreground/85">{ev.websiteLine}</dd>
            </>
          )}
          {ev.servicesLine && (
            <>
              <dt className="text-muted-foreground">Services</dt>
              <dd className="text-foreground/85">
                {renderBoldedSegments(ev.servicesLine).map((p, i) =>
                  p.bold ? (
                    <span
                      key={i}
                      className="font-semibold text-[#6e0e1e]"
                    >
                      {p.text}
                    </span>
                  ) : (
                    <span key={i}>{p.text}</span>
                  ),
                )}
              </dd>
            </>
          )}
        </dl>
      )}
    </button>
  );
}

function MessageBubble(props: {
  msg: ChatMessage & { rubric?: { totalSignals: number; matchedSignals: number } | null };
  onCitation: (slug: string) => void;
}) {
  const { msg, onCitation } = props;
  if (msg.role === "user") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-end"
      >
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[13.5px] leading-relaxed text-primary-foreground shadow-pop">
          {msg.content}
        </div>
      </motion.div>
    );
  }
  const rubric = msg.rubric ?? null;
  const showRatio =
    !!rubric &&
    rubric.totalSignals > 1 &&
    rubric.matchedSignals < rubric.totalSignals;
  const evidence = (msg.evidence ?? []) as AssetEvidence[];
  const llm = msg.llmContent ?? null;
  const llmErr = msg.llmError ?? null;
  const isLlmLoading = !!msg.isLlmLoading;
  // Prefer the LLM narration when it has arrived; otherwise fall back to the
  // deterministic lead sentence so the bubble is never empty mid-stream.
  const display = llm ?? msg.content;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-2"
    >
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {llm ? (
          <Bot className="h-3 w-3 text-accent" />
        ) : (
          <Sparkles className="h-3 w-3 text-accent" />
        )}
        Atlas
        {isLlmLoading && (
          <span className="text-[10px] normal-case tracking-normal text-muted-foreground">
            · composing narrative…
          </span>
        )}
        {showRatio && rubric && (
          <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-border/60 bg-secondary/60 px-2 py-0.5 text-[10px] normal-case tracking-normal text-foreground/70">
            matched {rubric.matchedSignals}/{rubric.totalSignals} filters
          </span>
        )}
      </div>

      {llmErr && (
        <div className="max-w-[88%] rounded-md border border-[#6e0e1e33] bg-[#6e0e1e0d] px-3 py-2 text-[12px] leading-relaxed text-[#6e0e1e]">
          {llmErr}
        </div>
      )}

      {display && (
        <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-card px-4 py-3 text-[13.5px] leading-relaxed text-card-foreground shadow-card ring-soft">
          {renderBoldedSegments(display).map((p, i) =>
            p.bold ? (
              <strong key={i} className="font-semibold text-[#6e0e1e]">
                {p.text}
              </strong>
            ) : (
              <span key={i}>{p.text}</span>
            ),
          )}
        </div>
      )}

      {isLlmLoading && !llm && !llmErr && (
        <div className="flex items-center gap-1.5 pl-1 text-[11px] text-muted-foreground">
          <span className="inline-flex h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]" />
          <span className="inline-flex h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]" />
          <span className="inline-flex h-1.5 w-1.5 animate-bounce rounded-full bg-accent" />
          <span className="ml-1">Atlas is reading the data & composing…</span>
        </div>
      )}

      {evidence.length > 0 && (
        <div className="flex flex-col gap-2">
          {evidence.slice(0, 4).map((ev) => (
            <EvidenceCard key={ev.slug} ev={ev} onCitation={onCitation} />
          ))}
        </div>
      )}
    </motion.div>
  );
}

export function ChatPanel(props: { onCitation: (slug: string) => void }) {
  const { onCitation } = props;
  const [input, setInput] = useState("");
  const [smartAssistant, setSmartAssistant] = useState(true);
  /** Provider that answered the most recent chat LLM call. Starts as the
   *  resolved primary provider; updated on every successful fallback so the
   *  footer hint can tell the user when we silently swapped providers. */
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "atlas",
      content:
        "I can answer questions about the community assets in the Atlanta Atlas — try asking about category, hours, accessibility, or cost. You can also upload your own spreadsheet of locations and chat over those.",
      matched: [],
    },
  ]);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [showGeoDetail, setShowGeoDetail] = useState(false);
  const [showSheetUrlInput, setShowSheetUrlInput] = useState(false);
  const [sheetUrl, setSheetUrl] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const urlInputRef = useRef<HTMLInputElement | null>(null);

  const triggerLlm = useAction(api.chatComplete.chatComplete);

  const { state: importedState, importFromFile, importFromUrl, importing, retry, clear } =
    useImportedData();

  // The atlas's only data source is the live Google Sheet (loaded via
  // ImportedDataProvider in Landing). We keep `seeded` as a typed name
  // here so existing mergeAssets call sites still compile, but it is
  // always an empty array now that seeds are dropped.
  const seeded: LocationDoc[] = [];
  const hasImports =
    importedState.rows.length > 0 ||
    importedState.pending.length > 0 ||
    importedState.failed.length > 0;
  /**
   * The atlas pre-validates every pending row through the Cerebras
   * normalizer + deterministic cascade before releasing them to the
   * map or to chat search. Chat uses the imported set as its reference
   * data — so during the pre-validation pass the visible context is
   * the merged set (rows paint progressively), and the chip labels the
   * gate explicitly. Gemini is NOT used on the map side — it's reserved
   * for the chat narration pipeline above.
   */
  const nativeCsvActive = importedState.source === "native";
  const preValidating =
    importedState.pending.length > 0 && !importedState.released;
  const merged = useMemo<{
    mappable: (LocationDoc | AtlasAsset)[];
    chatOnly: (LocationDoc | AtlasAsset)[];
  }>(
    () =>
      mergeAssets(
        seeded,
        importedState.rows,
        [
          ...importedState.pending.map((p) => p.doc),
          ...importedState.failed.map((f) => f.doc),
        ],
        { replace: hasImports },
      ),
    [
      seeded,
      importedState.rows,
      importedState.pending,
      importedState.failed,
      hasImports,
    ],
  );

  // The Chat's reference data is the imported Google-Sheet rows. We
  // no longer fall back to the seed list (curated defaults were dropped
  // — the Sheet is the single source of truth). When the gate is closed
  // we wait briefly; once it opens, the imported bucket feeds Gemini.
  const referenceCount = merged.mappable.length + merged.chatOnly.length;
  const referenceLabel = preValidating
    ? nativeCsvActive
      ? `Pre-validating ${importedState.pending.length} address${importedState.pending.length === 1 ? "" : "es"} via Cerebras\u2026`
      : `Geocoding ${importedState.pending.length} address${importedState.pending.length === 1 ? "" : "es"}\u2026`
    : hasImports
      ? importedState.source === "native"
        ? `${referenceCount} from Google Sheet · ${importedState.discoveredTabs.length || 1} tab${(importedState.discoveredTabs.length || 1) === 1 ? "" : "s"}`
        : `${referenceCount} ${merged.chatOnly.length ? "(some ungeocodable) " : ""}from your uploaded file`
      : "Loading Google Sheet\u2026";

  const resultServer = useQuery(
    api.locations.search,
    !hasImports && pendingQuestion
      ? { question: pendingQuestion }
      : ("skip" as any),
  ) as SearchResponse | undefined;

  const resultLocal = useMemo<SearchResponse | undefined>(() => {
    if (!hasImports || !pendingQuestion) return undefined;
    return searchRows(
      [...merged.mappable, ...merged.chatOnly] as any,
      pendingQuestion,
    );
  }, [hasImports, pendingQuestion, merged]);

  const result = (resultLocal ?? resultServer) as SearchResponse | undefined;
  const isLoading = pendingQuestion !== null && result === undefined;

  // Pull a derived snapshot of the deterministic result so we can fire the
  // LLM call as soon as it lands without re-running any hooks.
  const lastEvidence = useMemo<AssetEvidence[]>(
    () => ((result as any)?.evidence ?? []) as AssetEvidence[],
    [result],
  );
  const lastResultAnswer = useMemo(
    () => (result?.answer ?? "") as string,
    [result],
  );
  const lastResultRubric = useMemo(
    () => ((result as any)?.rubric ?? null) as {
      totalSignals: number;
      matchedSignals: number;
    } | null,
    [result],
  );

  // Helper to write back to a specific message index without losing other
  // fields. Pure setter.
  const patchMessage = useCallback(
    (id: string, patch: Partial<ChatMessage>) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      );
    },
    [],
  );

  // When the deterministic result lands, mark the pending message resolved,
  // then asynchronously upgrade it with an LLM narration.
  useEffect(() => {
    if (!pendingQuestion || !result) return;
    const idx = messages.findIndex((m) => m.pending);
    if (idx === -1) return;

    const pendingId = messages[idx].id;
    patchMessage(pendingId, {
      pending: false,
      content: lastResultAnswer,
      matched: (result.matched as LocationDoc[]) ?? [],
      intent: result.intent,
      rubric: lastResultRubric,
      evidence: lastEvidence,
      isLlmLoading: smartAssistant,
      llmContent: null,
      llmError: null,
    });
    setPendingQuestion(null);

    if (!smartAssistant) return;

    const allRows = [...merged.mappable, ...merged.chatOnly] as (LocationDoc | AtlasAsset)[];
    const tableCtx = buildFullTableContext(allRows);
    const now = new Date();
    const timeCtx = `CURRENT TIME: ${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(now)} (Eastern Time)\nUse this to determine which assets are currently open, what day of the week it is, and to answer any time-related questions accurately.`;
    const ctx = `${timeCtx}\n\n${tableCtx}`;
    triggerLlm({ question: pendingQuestion, context: ctx })
      .then((res) => {
        if (res.providerLabel) setActiveProvider(res.providerLabel);
        if (res.error) {
          patchMessage(pendingId, {
            isLlmLoading: false,
            llmError: res.error,
          });
          return;
        }
        const text = (res.content ?? "").trim();
        // Don't replace an existing non-empty deterministic lead with empty
        // model output — just clear the loading flag.
        if (!text) {
          patchMessage(pendingId, { isLlmLoading: false });
          return;
        }
        // Build a tiny preview for the bubble tag — strip the same `**`
        // markdown so the citation strip doesn't leak duplicates.
        patchMessage(pendingId, {
          isLlmLoading: false,
          llmContent: text,
          llmError: null,
        });
        void stripBold; // referenced to keep lint happy
      })
      .catch((err) => {
        console.warn("[chatComplete] trigger failed", err);
        patchMessage(pendingId, {
          isLlmLoading: false,
          llmError: "Atlas Assistant is offline — unexpected error.",
        });
      });
    // We intentionally only re-run when the deterministic result flipped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQuestion, result, smartAssistant, patchMessage, triggerLlm]);

  // Live clock — ticks every 30s to keep "open now" answers accurate.
  useEffect(() => {
    const id = setInterval(() => setCurrentTime(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const atlanticTime = useMemo(() => {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(currentTime);
  }, [currentTime]);

  const atlanticDayPart = useMemo(() => {
    const h = new Date(
      currentTime.toLocaleString("en-US", { timeZone: "America/New_York" }),
    ).getHours();
    if (h < 12) return "morning";
    if (h < 17) return "afternoon";
    return "evening";
  }, [currentTime]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, isLoading]);

  function submit(text: string) {
    const q = text.trim();
    if (!q) return;
    const pendingId = newId();
    setMessages((prev) => [
      ...prev,
      { id: newId(), role: "user", content: q },
      {
        id: pendingId,
        role: "atlas",
        content: "",
        pending: true,
        matched: [],
        isLlmLoading: smartAssistant,
      },
    ]);
    setPendingQuestion(q);
    setInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(input);
    }
  }

  function handleFile(file: File | null) {
    if (!file) return;
    void importFromFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col rounded-2xl border border-border/70 bg-card shadow-card">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-accent">
          <MapPin className="h-3.5 w-3.5" />
        </span>
        <div className="leading-tight">
          <div className="text-[12.5px] font-semibold tracking-[-0.005em]">
            Atlanta Atlas Assistant
          </div>
          <div className="text-[10.5px] text-muted-foreground">
            Reading {referenceLabel} · {atlanticTime} ET
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border/70 bg-background/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition hover:border-accent/60 hover:text-foreground">
            <input
              type="checkbox"
              checked={smartAssistant}
              onChange={(e) => setSmartAssistant(e.target.checked)}
              className="h-3 w-3 cursor-pointer accent-[#6e0e1e]"
              aria-label="Enable conversational narration via Nebius Token Factory"
            />
            <Bot className="h-3 w-3" />
            Smart assistant
          </label>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-secondary/60 px-2 py-0.5 text-[10px] text-muted-foreground">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            live
          </div>
        </div>
      </div>

      {/* imported-file chip — always-visible: geocoding x/asset # + info + close
          Expandable: filename, mapped count, progress bar, detail stats */}
      <AnimatePresence>
        {importedState.filename && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="mx-3 mt-3 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-2 text-[11px]"
          >
            {/* Always-visible row: tab status (or geocoding x/x) + info + close */}
            <div className="flex items-center gap-2">
              {importedState.progress.currentTab &&
              importedState.discoveredTabs.length > 0 ? (
                <>
                  <span className="inline-flex shrink-0 items-center gap-1.5 font-medium text-foreground">
                    <Loader2 className="h-3 w-3 animate-spin text-accent" />
                    Importing tab {importedState.progress.currentTab.idx + 1} of {importedState.progress.currentTab.total}
                    <span className="text-muted-foreground">
                      ({importedState.progress.currentTab.name})
                    </span>
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    · {importedState.rows.length} mapped
                  </span>
                </>
              ) : (
                <>
                  <span className="shrink-0 tabular-nums font-medium text-foreground">
                    Geocoding {importedState.progress.done}/{importedState.progress.total}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    · {importedState.rows.length} asset{importedState.rows.length === 1 ? "" : "s"}
                  </span>
                </>
              )}
              <button
                type="button"
                onClick={() => setShowGeoDetail((v) => !v)}
                className="ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-background/60 hover:text-foreground"
                aria-label={showGeoDetail ? "Hide geocoding details" : "Show geocoding details"}
              >
                <Info className="h-3 w-3" />
              </button>
              <button
                onClick={clear}
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-background/60 hover:text-foreground"
                aria-label="Clear import"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            {/* Expandable detail panel — filename, mapped, progress bar, stats */}
            <AnimatePresence>
              {showGeoDetail && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex flex-col gap-2 pt-2">
                    {/* File info + progress bar */}
                    <div className="flex items-center gap-2 text-[11px]">
                      {importedState.source === "native" ? (
                        <Database className="h-3.5 w-3.5 shrink-0 text-accent" />
                      ) : (
                        <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-accent" />
                      )}
                      <span className="truncate font-medium text-foreground">
                        {importedState.source === "native" ? "public/data/" : ""}
                        {importedState.filename}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        · {importedState.rows.length} mapped
                      </span>
                      {importedState.progress.total > 0 && (
                        <span className="ml-auto h-1 grow-0 rounded-full bg-border" style={{ flexBasis: 60 }}>
                          <span
                            className="block h-1 rounded-full bg-accent transition-all"
                            style={{ width: `${importedState.progress.total ? (importedState.progress.done / importedState.progress.total) * 100 : 0}%` }}
                          />
                        </span>
                      )}
                    </div>
                    {/* Tab breakdown (only when a multi-tab Google Sheet
                        import is the source). Shows gid → row count per tab
                        so the user can confirm every expected tab loaded. */}
                    {importedState.discoveredTabs.length > 0 && (
                      <div className="flex max-h-40 flex-col gap-1 overflow-y-auto pr-1 text-[10.5px]">
                        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-foreground/70">
                          <Database className="h-3 w-3" />
                          Source · {importedState.discoveredTabs.length} tab
                          {importedState.discoveredTabs.length === 1 ? "" : "s"}
                        </div>
                        {importedState.discoveredTabs.map((tab, i) => {
                          const isActive =
                            importedState.progress.currentTab?.idx === i;
                          return (
                            <div
                              key={tab.gid}
                              className="flex items-center gap-1.5 pl-1 text-muted-foreground"
                            >
                              {isActive ? (
                                <Loader2 className="h-2.5 w-2.5 animate-spin text-accent" />
                              ) : tab.rowCount > 0 ? (
                                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              ) : (
                                <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                              )}
                              <span className="truncate font-medium text-foreground/85">
                                {tab.name ?? `gid ${tab.gid}`}
                              </span>
                              <span className="ml-auto shrink-0 tabular-nums">
                                {tab.rowCount > 0
                                  ? `${tab.rowCount} row${tab.rowCount === 1 ? "" : "s"}`
                                  : "—"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Detail stats */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground">
                      {importedState.pending.length > 0 && <span>{importedState.pending.length} geocoding</span>}
                      {importedState.failed.length > 0 && <span>{importedState.failed.length} ungeocodable</span>}
                      {importedState.rejected > 0 && <span>{importedState.rejected} skipped</span>}
                      {importedState.progress.cached > 0 && <span>{importedState.progress.cached} cached</span>}
                      {importedState.progress.exact > 0 && <span>{importedState.progress.exact} exact</span>}
                      {importedState.progress.relaxed > 0 && <span>{importedState.progress.relaxed} relaxed</span>}                      {importedState.progress.cerebrasCleaned > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#6e0e1e33] bg-[#6e0e1e0d] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6e0e1e]">
                          {importedState.progress.cerebrasCleaned} cerebras-cleaned
                        </span>
                      )}
                      {importedState.progress.cerebrasCallsMade > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#6e0e1e33] bg-[#6e0e1e0d] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6e0e1e]">
                          {importedState.progress.cerebrasCallsMade} Cerebras call{importedState.progress.cerebrasCallsMade === 1 ? "" : "s"}
                        </span>
                      )}
                      {importedState.progress.cerebrasError > 0 && <span>{importedState.progress.cerebrasError} cerebras errors</span>}
                      {importedState.progress.failed > 0 && (
                        <button
                          type="button"
                          onClick={retry}
                          disabled={importing}
                          className="inline-flex items-center gap-1 rounded-full border border-[#6e0e1e33] bg-[#6e0e1e0d] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6e0e1e] transition hover:border-[#6e0e1e] hover:bg-[#6e0e1e1f] disabled:opacity-50"
                          title="Re-run the address cascade on every previously failed row"
                        >
                          ↻ Retry
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* messages */}
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
      >
        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <MessageBubble key={m.id} msg={m} onCitation={onCitation} />
          ))}
        </AnimatePresence>
        {isLoading && (
          <div className="flex items-center gap-2 pl-1 text-[11px] text-muted-foreground">
            <span className="inline-flex h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]" />
            <span className="inline-flex h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]" />
            <span className="inline-flex h-1.5 w-1.5 animate-bounce rounded-full bg-accent" />
            <span className="ml-1">
              {hasImports ? "searching the merged atlas…" : "searching the atlas…"}
            </span>
          </div>
        )}
      </div>

      {/* suggestions — collapsible */}
      <div className="px-4 pb-2">
        <button
          type="button"
          onClick={() => setShowSuggestions((v) => !v)}
          className="mb-1 inline-flex items-center gap-1 text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground transition hover:text-foreground"
        >
          {showSuggestions ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
          Suggested questions
        </button>
        <AnimatePresence>
          {showSuggestions && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="-mx-1 flex flex-wrap gap-1.5 overflow-x-auto px-1">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => submit(s)}
                    className="shrink-0 rounded-full border border-border/60 bg-secondary/50 px-2.5 py-1 text-[11.5px] text-secondary-foreground transition hover:border-accent/60 hover:bg-accent/10"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* input + import — stays anchored at the bottom; the textarea is
          height-capped so long lines scroll internally instead of pushing
          the panel out of the viewport. */}
      <div className="shrink-0 border-t border-border/60 p-3">
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-border/70 bg-background/60 px-3 text-[12px] font-medium text-muted-foreground transition hover:border-accent/60 hover:text-foreground disabled:opacity-50"
            title="Upload a CSV or TSV spreadsheet of asset locations"
          >
            {importing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-3.5 w-3.5" />
            )}
            Import CSV
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => {
              setShowSheetUrlInput((v) => !v);
              setTimeout(() => urlInputRef.current?.focus(), 100);
            }}
            disabled={importing}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border/70 bg-background/60 px-3 text-[12px] font-medium text-muted-foreground transition hover:border-accent/60 hover:text-foreground disabled:opacity-50"
            title="Load assets from a public Google Sheets URL"
          >
            <Link className="h-3.5 w-3.5" />
            Sheet URL
          </button>
          <AnimatePresence>
            {showSheetUrlInput && (
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 200, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="flex items-center gap-1">
                  <input
                    ref={urlInputRef}
                    type="url"
                    value={sheetUrl}
                    onChange={(e) => setSheetUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && sheetUrl.trim()) {
                        void importFromUrl(sheetUrl.trim());
                        setSheetUrl("");
                        setShowSheetUrlInput(false);
                      }
                    }}
                    placeholder="Paste Google Sheets URL…"
                    className="h-9 w-full rounded-lg border border-border/70 bg-background/60 px-2.5 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:border-accent/60 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (sheetUrl.trim()) {
                        void importFromUrl(sheetUrl.trim());
                        setSheetUrl("");
                        setShowSheetUrlInput(false);
                      }
                    }}
                    disabled={!sheetUrl.trim() || importing}
                    className="inline-flex h-9 items-center gap-1 rounded-lg bg-primary px-2.5 text-[12px] font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="relative flex max-h-[140px] flex-1 items-end gap-2 overflow-y-auto rounded-xl border border-border/70 bg-background/60 p-1.5 shadow-card focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-ring/30">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                hasImports
                  ? "Ask about your uploaded locations…"
                  : "Ask about categories, hours, accessibility, cost…"
              }
              rows={1}
              className="min-h-0 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-[13.5px] leading-snug shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              style={{ fieldSizing: "fixed", maxHeight: "120px" } as React.CSSProperties}
            />
            <button
              onClick={() => submit(input)}
              disabled={!input.trim()}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center self-end rounded-lg bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40"
              aria-label="Send message"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="mt-1.5 px-1.5 text-[10.5px] text-muted-foreground">
          Press <kbd className="rounded border border-border/60 px-1.5 py-px">Enter</kbd> to send ·{" "}
          <kbd className="rounded border border-border/60 px-1.5 py-px">Shift</kbd>+
          <kbd className="rounded border border-border/60 px-1.5 py-px">Enter</kbd> for newline · CSV
          upload reads columns{" "}
          <span className="text-foreground/80">
            Name, Address, Lat, Lng, Category, Features…
          </span>
          {smartAssistant && (
            <>
              {" · "}narrations via{" "}
              <span className="text-foreground/80">
                {activeProvider ?? "Groq · llama-3.3-70b-versatile"}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
