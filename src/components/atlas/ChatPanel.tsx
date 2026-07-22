import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUp, FileSpreadsheet, Loader2, MapPin, Sparkles, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Textarea } from "@/components/ui/textarea";
import {
  CATEGORY_LABEL,
  FEATURE_LABEL,
  PRICE_SYMBOL,
  type ChatMessage,
  type LocationDoc,
  type SearchResponse,
} from "./types";
import { searchRows } from "@/lib/atlas-search";
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

function MessageBubble(props: {
  msg: ChatMessage;
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
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-2"
    >
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        <Sparkles className="h-3 w-3 text-accent" />
        Atlas
      </div>
      <div className="max-w-[88%] rounded-2xl rounded-bl-md bg-card px-4 py-3 text-[13.5px] leading-relaxed text-card-foreground shadow-card ring-soft">
        {msg.content}
      </div>
      {msg.matched && msg.matched.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5 pl-1">
          {msg.matched.slice(0, 5).map((m) => (
            <button
              key={m.slug}
              onClick={() => onCitation(m.slug)}
              className="group inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card px-2.5 py-1 text-[11.5px] font-medium shadow-card transition hover:border-accent/60 hover:bg-accent/10"
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
              {m.name}
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">
                {m.rating.toFixed(1)}★
              </span>
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}

export function ChatPanel(props: {
  onCitation: (slug: string) => void;
}) {
  const { onCitation } = props;
  const [input, setInput] = useState("");
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

  const { state: importedState, importFromFile, importing, clear } =
    useImportedData();

  const seeded = (useQuery(api.locations.list) as LocationDoc[] | undefined) ?? [];
  const hasImports =
    importedState.rows.length > 0 ||
    importedState.pending.length > 0 ||
    importedState.failed.length > 0;
  const merged = useMemo<{
    mappable: (LocationDoc | AtlasAsset)[];
    chatOnly: (LocationDoc | AtlasAsset)[];
  }>(
    () =>
      mergeAssets(
        seeded,
        importedState.rows,
        [...importedState.pending.map((p) => p.doc), ...importedState.failed.map((f) => f.doc)],
      ),
    [seeded, importedState.rows, importedState.pending, importedState.failed],
  );

  // Server-side query – only when no upload is loaded.
  const resultServer = useQuery(
    api.locations.search,
    !hasImports && pendingQuestion
      ? { question: pendingQuestion }
      : ("skip" as any),
  ) as SearchResponse | undefined;

  // Client-side local search – only when an upload is loaded.
  const resultLocal = useMemo<SearchResponse | undefined>(() => {
    if (!hasImports || !pendingQuestion) return undefined;
    return searchRows(
      [...merged.mappable, ...merged.chatOnly] as any,
      pendingQuestion,
    );
  }, [hasImports, pendingQuestion, merged]);

  const result = (resultLocal ?? resultServer) as SearchResponse | undefined;
  const isLoading = pendingQuestion !== null && result === undefined;

  // Reset the welcome message if the user imports data so the next "thanks"
  // hint reflects what the chat is reading over.
  const lastImportSig = importedState.importedAt;
  useEffect(() => {
    if (!lastImportSig) return;
    setMessages((prev) => {
      const i = prev.findIndex(
        (m) => m.role === "user" && prev[prev.length - 1]?.id !== m.id,
      );
      // Append a system note for clarity; idempotent on signature.
      const stamp = `import:${lastImportSig}`;
      if (prev.some((m) => (m as any)._stamp === stamp)) return prev;
      const filename = importedState.filename ?? "your spreadsheet";
      return [
        ...prev,
        {
          id: stamp,
          role: "atlas",
          content: `Now reading ${importedState.rows.length} ${importedState.rows.length === 1 ? "row" : "rows"} from ${filename} — ask me anything about those assets.`,
          matched: [],
        } as any,
      ];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastImportSig, importedState.filename, importedState.rows.length]);

  useEffect(() => {
    if (!pendingQuestion || !result) return;
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.pending);
      if (idx === -1) return prev;
      const next = prev.slice();
      next[idx] = {
        ...next[idx],
        pending: false,
        content: result.answer,
        matched: result.matched,
        intent: result.intent,
      };
      return next;
    });
    setPendingQuestion(null);
  }, [pendingQuestion, result]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, isLoading]);

  function submit(text: string) {
    const q = text.trim();
    if (!q) return;
    setMessages((prev) => [
      ...prev,
      { id: newId(), role: "user", content: q },
      { id: newId(), role: "atlas", content: "", pending: true, matched: [] },
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
            Reading {hasImports ? `${merged.mappable.length + merged.chatOnly.length} merged assets (upload + curated)` : "12 curated Southwest Atlanta assets"}
          </div>
        </div>
        <div className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-secondary/60 px-2 py-0.5 text-[10px] text-muted-foreground">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          live
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
              <FileSpreadsheet className="h-3.5 w-3.5 text-accent" />
              <span className="truncate font-medium text-foreground">
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
                  Geocoding {importedState.progress.done}/{importedState.progress.total}
                </span>
                {importedState.progress.cached > 0 && (
                  <span className="text-foreground/70">
                    · {importedState.progress.cached} cached
                  </span>
                )}
                {importedState.progress.fetched > 0 && (
                  <span className="text-foreground/70">
                    · {importedState.progress.fetched} fetched
                  </span>
                )}
                {importedState.progress.failed > 0 && (
                  <span className="text-foreground/70">
                    · {importedState.progress.failed} couldn't be located
                  </span>
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

      {/* input + import */}
      <div className="border-t border-border/60 p-3">
        <div className="flex items-center gap-2">
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
          <div className="relative flex flex-1 items-end gap-2 rounded-xl border border-border/70 bg-background/60 p-1.5 shadow-card focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-ring/30">
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
              className="min-h-0 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-[13.5px] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <button
              onClick={() => submit(input)}
              disabled={!input.trim()}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40"
              aria-label="Send message"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="mt-1.5 px-1.5 text-[10.5px] text-muted-foreground">
          Press <kbd className="rounded border border-border/60 px-1.5 py-px">Enter</kbd> to send · <kbd className="rounded border border-border/60 px-1.5 py-px">Shift</kbd>+<kbd className="rounded border border-border/60 px-1.5 py-px">Enter</kbd> for newline · CSV upload reads columns{" "}
          <span className="text-foreground/80">Name, Address, Lat, Lng, Category, Features…</span>
        </div>
      </div>
    </div>
  );
}
