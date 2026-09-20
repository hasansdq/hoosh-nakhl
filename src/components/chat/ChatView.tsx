"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAppStore } from "@/lib/store";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { MenuCards, type MenuPayload } from "./MenuCards";
import { OrderSummaryBox, type OrderSummaryPayload } from "./OrderSummaryBox";
import { TrackingCard, type TrackingPayload } from "./TrackingCard";
import { NakhlLogo } from "@/components/site/Header";
import { Send, RotateCcw, Bot, Sparkles, Loader2, Phone } from "lucide-react";
import { toast } from "sonner";
import { toPersianDigits } from "@/lib/fa";

export interface ChatMessage {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  type: string;
  metadata: {
    menu?: MenuPayload;
    orderSummary?: OrderSummaryPayload;
    tracking?: TrackingPayload;
    stage?: string;
    actionsApplied?: string[];
    fallback?: boolean;
  } | null;
  createdAt: string;
}

const STARTERS = [
  "سلام! گرسنه‌ام 🍽",
  "منو رو نشونم بده",
  "چی پیشنهاد می‌دی؟",
  "۲ کباب کوبیده و ۱ دوغ لطفاً",
  "وضعیت سفارشم رو بگو",
];

export function ChatView() {
  const { user, setAuthOpen, chatRefreshKey } = useAppStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingSession, setLoadingSession] = useState(true);
  const [stage, setStage] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadSession = useCallback(async () => {
    setLoadingSession(true);
    const res = await api<{ messages: ChatMessage[]; stage: string }>("/api/chat/session");
    setLoadingSession(false);
    if (res.success) {
      setMessages(res.messages ?? []);
      setStage(res.stage ?? null);
    } else if (res.error) {
      toast.error(res.error);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetching
    if (user) loadSession();
  }, [user, loadSession, chatRefreshKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  const send = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || sending) return;

    if (!user) {
      setAuthOpen(true);
      toast.info("برای گفتگو با هوش نخل، ابتدا وارد شوید");
      return;
    }

    setInput("");
    setSending(true);
    setMessages((prev) => [
      ...prev,
      { id: `tmp-${Date.now()}`, role: "USER", content: message, type: "TEXT", metadata: null, createdAt: new Date().toISOString() },
    ]);

    const res = await api<{ message: ChatMessage; stage: string }>("/api/chat/message", {
      body: { message },
    });
    setSending(false);

    if (!res.success) {
      toast.error(res.error ?? "خطا در ارسال پیام");
      setMessages((prev) => prev.filter((m) => !m.id.startsWith("tmp-")));
      setInput(message);
      return;
    }

    setMessages((prev) => [...prev, res.message]);
    setStage(res.stage ?? null);
    if (res.message.metadata?.fallback) {
      // engine used deterministic fallback — gently inform
    }
  };

  const resetChat = async () => {
    const res = await api("/api/chat/session", { method: "POST" });
    if (res.success) {
      setMessages([]);
      setStage("GREETING");
      toast.success("گفتگوی جدید شروع شد 🌴");
    }
  };

  if (!user) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10">
          <Bot className="h-10 w-10 text-primary" />
        </div>
        <h2 className="text-2xl font-extrabold">هوش نخل در انتظار شماست 🌴</h2>
        <p className="max-w-md text-muted-foreground leading-7">
          برای سفارش‌گرفتن با دستیار هوشمند رستوران نخل، ابتدا با شماره موبایل خود وارد شوید.
          بدون رمز عبور — فقط کد یکبارمصرف پیامکی!
        </p>
        <Button onClick={() => setAuthOpen(true)} size="lg" className="rounded-xl font-extrabold">
          <Phone className="ml-2 h-5 w-5" />
          ورود با شماره موبایل
        </Button>
      </div>
    );
  }

  return (
    <div className="chat-shell mx-auto flex max-w-3xl flex-col px-3 sm:px-4">
      {/* chat header */}
      <div className="flex items-center justify-between gap-3 rounded-2xl border bg-card/70 px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="relative">
            <NakhlLogo size={40} />
            <span className="absolute -bottom-0.5 -left-0.5 h-3 w-3 rounded-full border-2 border-card bg-emerald-500" aria-label="آنلاین" />
          </div>
          <div className="leading-tight">
            <div className="flex items-center gap-1.5 text-sm font-extrabold">
              هوش نخل
              <Badge className="bg-gradient-to-l from-primary to-gold text-white">AI</Badge>
            </div>
            <div className="text-[11px] text-muted-foreground">
              {sending ? "در حال نوشتن..." : stage ? `مرحله: ${stageLabel(stage)}` : "گارسون هوشمند شما"}
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={resetChat}
          className="rounded-xl gap-1.5 text-xs"
          title="شروع سفارش جدید"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          سفارش جدید
        </Button>
      </div>

      {/* messages */}
      <div className="nice-scroll mt-3 flex-1 space-y-4 overflow-y-auto rounded-2xl border bg-background/60 p-3 sm:p-4">
        {loadingSession ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-5 p-4 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-primary shadow-lg shadow-primary/25">
                  <Bot className="h-8 w-8 text-primary-foreground" />
                </div>
                <div>
                  <h3 className="text-lg font-extrabold">سلام {user.firstName || "دوست من"}! من هوش نخلم 🌴</h3>
                  <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
                    مثل یک گارسون واقعی سفارشتون رو می‌گیرم؛ منو رو نشون می‌دم، پیشنهاد می‌دم و تا پرداخت همراهتونم.
                  </p>
                </div>
                <div className="flex max-w-md flex-wrap justify-center gap-2.5 px-1 py-2">
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="min-h-11 rounded-full border bg-card px-4 py-2.5 text-sm font-semibold shadow-sm transition hover:border-primary/50 hover:text-primary hover:shadow-md active:scale-95"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex animate-fade-up gap-2.5 ${msg.role === "USER" ? "flex-row-reverse" : ""}`}
              >
                {msg.role === "ASSISTANT" ? (
                  <div className="mt-1 shrink-0">
                    <NakhlLogo size={32} />
                  </div>
                ) : (
                  <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-secondary text-sm font-black text-secondary-foreground">
                    {(user.firstName ?? "ش").slice(0, 1)}
                  </div>
                )}
                <div className={`flex min-w-0 flex-col gap-2 ${msg.role === "USER" ? "items-end" : "items-start"}`}>
                  {msg.content && (
                    <div
                      className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-7 shadow-sm ${
                        msg.role === "USER"
                          ? "rounded-tr-md bg-primary text-primary-foreground"
                          : "rounded-tl-md border bg-card"
                      }`}
                    >
                      {msg.content}
                    </div>
                  )}
                  {/* rich components */}
                  {msg.metadata?.menu && <MenuCards payload={msg.metadata.menu} />}
                  {msg.metadata?.orderSummary && (
                    <OrderSummaryBox payload={msg.metadata.orderSummary} onPaid={loadSession} />
                  )}
                  {msg.metadata?.tracking && <TrackingCard payload={msg.metadata.tracking} onPaid={loadSession} />}
                  {msg.metadata?.actionsApplied && msg.metadata.actionsApplied.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {msg.metadata.actionsApplied.map((a, i) => (
                        <span
                          key={i}
                          className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400"
                        >
                          ✓ {a}
                        </span>
                      ))}
                    </div>
                  )}
                  <span className="px-1 text-[10px] text-muted-foreground">
                    {formatTime(msg.createdAt)}
                  </span>
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex items-center gap-2.5">
                <NakhlLogo size={32} />
                <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md border bg-card px-4 py-3 shadow-sm">
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* input */}
      <div className="mt-3 rounded-2xl border bg-card/70 p-2 shadow-sm">
        <div className="flex items-end gap-2">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="مثلاً: ۲ کباب کوبیده و ۱ دوغ لطفاً..."
            className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border-0 bg-transparent px-3 py-2.5 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
            rows={1}
            disabled={sending}
          />
          <Button
            onClick={() => send()}
            disabled={sending || !input.trim()}
            className="h-11 w-11 shrink-0 rounded-xl p-0 shadow-lg shadow-primary/25"
            aria-label="ارسال پیام"
          >
            {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 -scale-x-100" />}
          </Button>
        </div>
        <div className="mt-1.5 flex items-center justify-between px-2 pb-1 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-gold" />
            هوش نخل ممکن است اشتباه کند؛ قیمت نهایی همیشه در فاکتور سیستمی است.
          </span>
          <span className="hidden sm:block">Shift + Enter = خط جدید</span>
        </div>
      </div>
    </div>
  );
}

function stageLabel(stage: string): string {
  const map: Record<string, string> = {
    GREETING: "شروع گفتگو",
    ORDERING: "انتخاب غذا",
    DRINKS: "پیشنهاد نوشیدنی",
    DELIVERY_METHOD: "روش تحویل",
    ADDRESS: "دریافت آدرس",
    CONFIRMATION: "تأیید و پرداخت",
    TRACKING: "پیگیری سفارش",
  };
  return map[stage] ?? stage;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return toPersianDigits(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
}
