import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUp, Coffee, Sparkles } from "lucide-react";
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

const SUGGESTIONS = [
  "Which is the highest-rated café?",
  "Where can I get wifi and sit outside?",
  "Show me cheap spots open right now",
  "Tell me about Sterling Coffee",
  "What about roasteries?",
  "Quiet place to work with outlets",
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
        "I can answer questions about the cafés in the atlas — try asking about ratings, hours, features, or pricing.",
      matched: [],
    },
  ]);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const result = useQuery(
    api.locations.search,
    pendingQuestion ? { question: pendingQuestion } : ("skip" as any),
  ) as SearchResponse | undefined;

  const isLoading = pendingQuestion !== null && result === undefined;

  function submit(text: string) {
    const q = text.trim();
    if (!q) return;
    setMessages((prev) => [
      ...prev,
      { id: newId(), role: "user", content: q },
      {
        id: newId(),
        role: "atlas",
        content: "",
        pending: true,
        matched: [],
      },
    ]);
    setPendingQuestion(q);
    setInput("");
  }

  // When search returns, update the last pending bot message.
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

  // Auto-scroll on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, isLoading]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(input);
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col rounded-2xl border border-border/70 bg-card shadow-card">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Coffee className="h-3.5 w-3.5" />
        </span>
        <div className="leading-tight">
          <div className="text-[12.5px] font-semibold tracking-[-0.005em]">
            Atlas Assistant
          </div>
          <div className="text-[10.5px] text-muted-foreground">
            Reading the spreadsheet of curated cafés
          </div>
        </div>
        <div className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-secondary/60 px-2 py-0.5 text-[10px] text-muted-foreground">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          live
        </div>
      </div>

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
            <span className="ml-1">searching the atlas…</span>
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

      {/* input */}
      <div className="border-t border-border/60 p-3">
        <div className="relative flex items-end gap-2 rounded-xl border border-border/70 bg-background/60 p-1.5 shadow-card focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-ring/30">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about ratings, hours, features, pricing…"
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
        <div className="mt-1.5 px-1.5 text-[10.5px] text-muted-foreground">
          Press <kbd className="rounded border border-border/60 px-1.5 py-px">Enter</kbd> to send · <kbd className="rounded border border-border/60 px-1.5 py-px">Shift</kbd>+<kbd className="rounded border border-border/60 px-1.5 py-px">Enter</kbd> for newline
        </div>
      </div>
    </div>
  );
}
