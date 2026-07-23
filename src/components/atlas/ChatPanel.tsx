import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUp,
  Bot,
  Database,
  FileSpreadsheet,
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

const SUGGESTIONS = [
  "Which asset has the highest community score?",
  "Where can I find a free library open today?",
  "Show me transit-accessible clinics",
  "Tell me about Wren's Nest",
  "What about recreation centers?",
  "Wheelchair-accessible park with restrooms",
];

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

/** Build the Markdown context block fed to the LLM. Top-8 evidence only —
 *  larger payloads will hit model context limits. */
function buildLlmContext(evidence: AssetEvidence[]): string {
  if (!evidence.length) {
    return "(empty — no assets matched the deterministic search yet)";
  }
  return evidence
    .slice(0, 8)
    .map((ev, i) => {
      const parts: string[] = [`${i + 1}. ${ev.name}`];
      if (ev.tagline) parts.push(`- Type: ${ev.tagline}`);
      if (ev.addressLine) parts.push(`- Address: ${ev.addressLine}`);
      if (ev.hoursToday) parts.push(`- Hours: ${ev.hoursToday}`);
      if (ev.contactLine) parts.push(`- Contact: ${ev.contactLine}`);
      if (ev.websiteLine) parts.push(`- Web: ${ev.websiteLine}`);
      if (ev.servicesLine) parts.push(`- Services: ${ev.servicesLine}`);
      if (ev.priceLine) parts.push(`- Price: ${ev.priceLine}`);
      if (ev.ratingLine) parts.push(`- Rating: ${ev.ratingLine}`);
      return parts.join("\n");
    })
    .join("\n\n");
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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const triggerLlm = useAction(api.chatComplete.chatComplete);

  const { state: importedState, importFromFile, importing, retry, clear } =
    useImportedData();

  const seeded = (useQuery(api.locations.list) as LocationDoc[] | undefined) ?? [];
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

  // During the pre-validation gate, the only reference data the chat
  // can lean on is the curated Convex seeds. Once the gate opens, both
  // the seeds (if hasImports=false) AND the validated imported rows
  // become referenceable for Gemini narration.
  const referenceCount =
    preValidating && nativeCsvActive
      ? seeded.length
      : merged.mappable.length + merged.chatOnly.length;
  const referenceLabel = preValidating
    ? nativeCsvActive
      ? `Pre-validating ${importedState.pending.length} address${importedState.pending.length === 1 ? "" : "es"} via Cerebras\u2026`
      : `Geocoding ${importedState.pending.length} address${importedState.pending.length === 1 ? "" : "es"}\u2026`
    : hasImports
      ? importedState.source === "native"
        ? `${referenceCount} from public/data/${importedState.filename ?? "atlas.csv"}`
        : `${referenceCount} ${merged.chatOnly.length ? "(some ungeocodable) " : ""}from your uploaded file`
      : "12 curated Southwest Atlanta assets";

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

    const ctx = buildLlmContext(lastEvidence);
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
            Reading {referenceLabel}
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

      {/* imported-file chip + geocode progress */}
      <AnimatePresence>
        {importedState.filename && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="mx-3 mt-3 flex flex-col gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-2 text-[11px]"
          >
            <div className="flex items-center gap-2 text-accent-foreground">
              {importedState.source === "native" ? (
                <Database className="h-3.5 w-3.5 text-accent" />
              ) : (
                <FileSpreadsheet className="h-3.5 w-3.5 text-accent" />
              )}
              <span className="truncate font-medium text-foreground">
                {importedState.source === "native" ? "public/data/" : ""}
                {importedState.filename}
              </span>
              <span className="text-muted-foreground">
                · {importedState.rows.length} mapped
              </span>
              {importedState.pending.length > 0 && (
                <span className="text-muted-foreground">
                  · {importedState.pending.length} geocoding
                </span>
              )}
              {importedState.failed.length > 0 && (
                <span className="text-muted-foreground">
                  · {importedState.failed.length} ungeocodable
                </span>
              )}
              {importedState.rejected > 0 && (
                <span className="text-muted-foreground">
                  · {importedState.rejected} skipped
                </span>
              )}
              <button
                onClick={clear}
                className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition hover:bg-background/60 hover:text-foreground"
                aria-label="Clear import"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            {importedState.progress.total > 0 && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <span
                  className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent"
                  aria-hidden
                />
                <span className="tabular-nums">
                  Geocoding {importedState.progress.done}/
                  {importedState.progress.total}
                </span>
                {importedState.progress.cached > 0 && (
                  <span className="text-foreground/70">
                    · {importedState.progress.cached} cached
                  </span>
                )}
                {importedState.progress.exact > 0 && (
                  <span className="text-foreground/70">
                    · {importedState.progress.exact} exact
                  </span>
                )}
                {importedState.progress.relaxed > 0 && (
                  <span className="text-foreground/70">
                    · {importedState.progress.relaxed} relaxed
                  </span>
                )}
                {importedState.progress.zipCentroid > 0 && (
                  <span className="text-foreground/70">
                    · {importedState.progress.zipCentroid} zip-centroid
                  </span>
                )}
                {importedState.progress.cerebrasCleaned > 0 && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-[#6e0e1e33] bg-[#6e0e1e0d] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6e0e1e]"
                    title="Rows that Cerebras cleanly re-formatted and the geocoder then accepted."
                  >
                    <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-[#6e0e1e]" />
                    {importedState.progress.cerebrasCleaned} cerebras-cleaned
                  </span>
                )}
                {/* Live Cerebras call counter. Visible from the first row the
                    map normalizer touches so the user can verify the action
                    is firing without waiting for the loop to finish. Tied to
                    `console.info("[atlas/llm-normalize] calling Cerebras
                    …")` in imported-data.tsx so the same info shows up in
                    DevTools. Gemini is not used on the map side. */}
                {importedState.progress.cerebrasCallsMade > 0 && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-[#6e0e1e33] bg-[#6e0e1e0d] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6e0e1e]"
                    title={
                      importedState.progress.cerebrasModelLabel
                        ? `Actual outbound calls to ${importedState.progress.cerebrasModelLabel}. Detailed log in DevTools (filter: [atlas/llm-normalize]).`
                        : `Detailed log in DevTools (filter: [atlas/llm-normalize]).`
                    }
                  >
                    <span aria-hidden className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#6e0e1e]" />
                    {importedState.progress.cerebrasCallsMade} Cerebras call{importedState.progress.cerebrasCallsMade === 1 ? "" : "s"}
                    {importedState.progress.cerebrasModelLabel ? (
                      <span className="ml-0.5 font-normal normal-case tracking-normal text-[#6e0e1e]/80">
                        · {importedState.progress.cerebrasModelLabel}
                      </span>
                    ) : null}
                  </span>
                )}
                {importedState.progress.cerebrasError > 0 && (
                  <span className="text-foreground/70">
                    · {importedState.progress.cerebrasError} cerebras errors
                  </span>
                )}
                {importedState.progress.failed > 0 && (
                  <>
                    <span className="text-foreground/70">
                      · {importedState.progress.failed} couldn't be located
                    </span>
                    <button
                      type="button"
                      onClick={retry}
                      disabled={importing}
                      className="ml-0.5 inline-flex items-center gap-1 rounded-full border border-[#6e0e1e33] bg-[#6e0e1e0d] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6e0e1e] transition hover:border-[#6e0e1e] hover:bg-[#6e0e1e1f] disabled:opacity-50"
                      title="Re-run the address cascade on every previously failed row (cache stays intact for already-located rows)"
                    >
                      ↻ Retry
                    </button>
                  </>
                )}
                <span
                  className="ml-auto h-1 grow-0 rounded-full bg-border"
                  style={{ flexBasis: 80 }}
                >
                  <span
                    className="block h-1 rounded-full bg-accent transition-all"
                    style={{
                      width: `${
                        importedState.progress.total
                          ? (importedState.progress.done /
                              importedState.progress.total) *
                            100
                          : 0
                      }%`,
                    }}
                  />
                </span>
              </div>
            )}
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

      {/* suggestions */}
      <div className="px-4 pb-2">
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
                {activeProvider ?? "GitHub Models · gpt-4o-mini"}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
