"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useAppStore } from "@/lib/store";
import { api } from "@/lib/client-api";
import { useCartStore, useCartHydrated } from "@/lib/cart-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MenuCards, type MenuPayload } from "./MenuCards";
import { OrderSummaryBox, type OrderSummaryPayload } from "./OrderSummaryBox";
import { TrackingCard, type TrackingPayload } from "./TrackingCard";
import { ConversationSidebar, type ChatSessionSummary } from "./ConversationSidebar";
import { NakhlLogo } from "@/components/site/Header";
import {
  Send,
  RotateCcw,
  Bot,
  Sparkles,
  Loader2,
  Phone,
  PanelRight,
  UtensilsCrossed,
  CupSoda,
  Truck,
  MapPin,
  ReceiptText,
  Package,
  ChevronLeft,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { toPersianDigits } from "@/lib/fa";
import { cn } from "@/lib/utils";

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
    paymentSuccess?: boolean;
    paymentFailed?: boolean;
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

/** Canned messages used by the step chips — the engine understands them even offline */
const STEP_CHIPS = [
  { stage: "ORDERING", label: "انتخاب غذا", icon: UtensilsCrossed, message: "می‌خوام غذاهای سفارشم رو تغییر بدم" },
  { stage: "DRINKS", label: "نوشیدنی", icon: CupSoda, message: "نوشیدنی هم می‌خوام" },
  { stage: "DELIVERY_METHOD", label: "روش تحویل", icon: Truck, message: "روش ارسال رو می‌خوام عوض کنم" },
  { stage: "ADDRESS", label: "آدرس", icon: MapPin, message: "آدرس رو می‌خوام عوض کنم" },
  { stage: "CONFIRMATION", label: "فاکتور و پرداخت", icon: ReceiptText, message: "فاکتور نهایی رو نشونم بده" },
] as const;

const STAGE_LABELS: Record<string, string> = {
  GREETING: "شروع گفتگو",
  ORDERING: "انتخاب غذا",
  DRINKS: "پیشنهاد نوشیدنی",
  DELIVERY_METHOD: "روش تحویل",
  ADDRESS: "دریافت آدرس",
  CONFIRMATION: "تأیید و پرداخت",
  TRACKING: "پیگیری سفارش",
};

/** snapshot of the server-side chat draft — mirrored into the classic cart */
interface MirrorDraft {
  items: { itemId: string; name: string; price: number; quantity: number }[];
  deliveryMethod?: "DELIVERY" | "PICKUP" | null;
  address?: string | null;
  couponCode?: string | null;
}

const EMPTY_MIRROR: MirrorDraft = { items: [] };

function formatTime(iso: string): string {
  const d = new Date(iso);
  return toPersianDigits(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
}

export function ChatView() {
  const { user, setAuthOpen, setView, chatRefreshKey } = useAppStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingSession, setLoadingSession] = useState(true);
  const [stage, setStage] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ChatSessionSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mirrorDraft, setMirrorDraft] = useState<MirrorDraft>(EMPTY_MIRROR);
  const cartHydrated = useCartHydrated();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    const res = await api<{ sessions: ChatSessionSummary[] }>("/api/chat/sessions");
    setSessionsLoading(false);
    if (res.success && Array.isArray(res.sessions)) {
      setSessions(res.sessions);
    }
  }, []);

  // ---------- history search (debounced) ----------
  // عبارت ≥۲ نویسه → نتایج جستجو جای لیست عادی سایدبار را می‌گیرد؛
  // پاک‌شدن عبارت → بازگشت به لیست باکت‌بندی‌شده بدون fetch جدید.
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await api<{ sessions: ChatSessionSummary[] }>(
          `/api/chat/sessions?q=${encodeURIComponent(q)}`
        );
        if (!cancelled) {
          setSearchResults(res.success && Array.isArray(res.sessions) ? res.sessions : []);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  const loadSession = useCallback(async (targetId?: string) => {
    setLoadingSession(true);
    const res = await api<{
      messages: ChatMessage[];
      stage: string;
      sessionId: string;
      draft?: MirrorDraft;
    }>(targetId ? `/api/chat/session?sessionId=${encodeURIComponent(targetId)}` : "/api/chat/session");
    setLoadingSession(false);
    if (res.success) {
      setMessages(res.messages ?? []);
      setStage(res.stage ?? null);
      setSessionId(res.sessionId ?? null);
      const d = res.draft;
      setMirrorDraft(
        d && Array.isArray(d.items)
          ? {
              items: d.items.filter((i) => i && typeof i.itemId === "string"),
              deliveryMethod: d.deliveryMethod ?? null,
              address: d.address ?? null,
              couponCode: d.couponCode ?? null,
            }
          : EMPTY_MIRROR
      );
      void loadSessions();
    } else if (res.error) {
      toast.error(res.error);
    }
  }, [loadSessions]);

  useEffect(() => {
    if (user) {
      void loadSession();
    } else {
      setLoadingSession(false);
    }
  }, [user, chatRefreshKey, loadSession]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  // ---------- classic-cart mirror ----------
  // «فلان غذا رو هم می‌خوام» در چت → همان لحظه در سبد خرید اصلی سایت هم اعمال می‌شود.
  // مقدارها authoritative از درفت سرور هستند؛ اقلام دستی کاربر دست‌نخورده می‌مانند.
  // با خالی‌شدن درفت (پرداخت/شروع دوباره) فقط اقلام آینه‌شده از سبد برداشته می‌شوند.
  useEffect(() => {
    if (!user || !cartHydrated || loadingSession) return;
    const cart = useCartStore.getState();
    if (!stage || stage === "TRACKING" || mirrorDraft.items.length === 0) {
      if (cart.chatItemIds.length > 0) cart.clearChatItems();
      return;
    }
    const known = new Set(cart.chatItemIds);
    const fresh = mirrorDraft.items.filter((i) => !known.has(i.itemId));
    cart.syncChatDraft(mirrorDraft.items, {
      deliveryMethod: mirrorDraft.deliveryMethod ?? undefined,
      address: mirrorDraft.address ?? undefined,
      couponCode: mirrorDraft.couponCode ?? undefined,
    });
    if (fresh.length > 0) {
      toast.success(`🛒 ${fresh.map((i) => i.name).join("، ")} به سبد خرید سایت هم اضافه شد`);
    }
  }, [user, cartHydrated, loadingSession, stage, mirrorDraft]);

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

    const res = await api<{
      message: ChatMessage;
      stage: string;
      draft?: MirrorDraft;
    }>("/api/chat/message", {
      body: { message, sessionId: sessionId ?? undefined },
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
    const d = res.draft;
    setMirrorDraft(
      d && Array.isArray(d.items)
        ? {
            items: d.items.filter((i) => i && typeof i.itemId === "string"),
            deliveryMethod: d.deliveryMethod ?? null,
            address: d.address ?? null,
            couponCode: d.couponCode ?? null,
          }
        : EMPTY_MIRROR
    );
    void loadSessions();
  };

  const newChat = async () => {
    const res = await api("/api/chat/session", { method: "POST" });
    if (res.success) {
      setMessages([]);
      setStage("GREETING");
      setSidebarOpen(false);
      toast.success("گفتگوی جدید شروع شد 🌴");
      void loadSession();
    }
  };

  const switchSession = async (id: string) => {
    if (id === sessionId) {
      setSidebarOpen(false);
      return;
    }
    setSidebarOpen(false);
    await loadSession(id);
  };

  const deleteSession = async (id: string) => {
    const res = await api(`/api/chat/session?sessionId=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.success) {
      toast.error(res.error ?? "خطا در حذف گفتگو");
      return;
    }
    toast.success("گفتگو حذف شد");
    if (id === sessionId) {
      await loadSession(); // falls back to / creates the active one
    } else {
      void loadSessions();
    }
  };

  const renameSession = async (id: string, title: string) => {
    const res = await api("/api/chat/session", { method: "PATCH", body: { sessionId: id, title } });
    if (res.success) {
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
      toast.success("عنوان گفتگو تغییر کرد");
    } else {
      toast.error(res.error ?? "خطا در تغییر عنوان");
    }
  };

  /** patch the newest invoice after a direct (server-validated) edit */
  const handleInvoiceUpdate = useCallback(
    (messageId: string, payload: OrderSummaryPayload | undefined, nextStage?: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, metadata: payload ? { ...m.metadata, orderSummary: payload } : { ...m.metadata, orderSummary: undefined } }
            : m
        )
      );
      if (nextStage) setStage(nextStage);
      // keep the classic-cart mirror in sync with direct invoice edits (steppers…)
      setMirrorDraft(
        payload
          ? {
              items: payload.items
                .filter((i) => !!i.itemId)
                .map((i) => ({ itemId: i.itemId!, name: i.name, price: i.unitPrice, quantity: i.quantity })),
              deliveryMethod: payload.deliveryMethod ?? null,
              address: payload.address ?? null,
              couponCode: payload.couponCode ?? null,
            }
          : EMPTY_MIRROR
      );
      void loadSessions();
    },
    [loadSessions]
  );

  /** «تکرار همین سفارش» از کارت رهگیری — آیتم‌ها با قیمت امروز دوباره به
   *  درفت چت ریخته می‌شوند، فاکتور جدید در گفتگو ظاهر می‌شود و همان
   *  مکانیزم میرور، سبد اصلی سایت را هم همگام نگه می‌دارد. */
  const handleTrackingReorder = useCallback(
    async (orderNumber: string): Promise<boolean> => {
      const res = await api<{
        stage: string;
        orderSummary?: OrderSummaryPayload;
        message?: ChatMessage;
        warnings?: string[];
      }>("/api/chat/draft", { body: { op: "REORDER", orderNumber } });

      if (!res.success || !res.orderSummary) {
        toast.error(res.error ?? "تکرار سفارش ممکن نشد");
        return false;
      }

      // فاکتور جدید به انتهای گفتگو اضافه می‌شود (از سرور باقی می‌ماند)
      if (res.message) {
        const msg = res.message;
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      }
      setStage(res.stage ?? "CONFIRMATION");

      const s = res.orderSummary;
      setMirrorDraft({
        items: s.items
          .filter((i) => !!i.itemId)
          .map((i) => ({ itemId: i.itemId!, name: i.name, price: i.unitPrice, quantity: i.quantity })),
        deliveryMethod: s.deliveryMethod ?? null,
        address: s.address ?? null,
        couponCode: s.couponCode ?? null,
      });

      if (res.warnings && res.warnings.length > 0) {
        toast.warning(res.warnings[0]);
      } else {
        toast.success("سفارش قبلی دوباره به سبد اضافه شد 🛒");
      }
      void loadSessions();
      return true;
    },
    [loadSessions]
  );

  // the newest invoice is the live one while the flow sits on the confirmation
  // step with a non-empty draft; older copies (and any invoice after the draft
  // was externally emptied) render as read-only archives
  const lastInvoiceId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].metadata?.orderSummary) return messages[i].id;
    }
    return null;
  }, [messages]);
  const invoiceLive = stage === "CONFIRMATION" && mirrorDraft.items.length > 0;

  const orderFlowActive = stage && stage !== "GREETING" && stage !== "TRACKING";

  // ---------- logged-out state ----------
  if (!user) {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8 pb-[calc(env(safe-area-inset-bottom,0px)+2rem)] pt-[calc(env(safe-area-inset-top,0px)+2rem)] text-center">
        {/* بازگشت به خانه — فقط گوشهٔ بالا در موبایل (صفحهٔ چت تمام‌صفحه است) */}
        <Button
          variant="outline"
          size="icon"
          className="absolute right-[calc(env(safe-area-inset-right,0px)+0.75rem)] top-[calc(env(safe-area-inset-top,0px)+0.75rem)] h-9 w-9 rounded-xl text-primary hover:bg-primary/10 hover:text-primary sm:hidden"
          onClick={() => setView("home")}
          aria-label="بازگشت به صفحه اصلی"
        >
          <ArrowRight className="h-4.5 w-4.5" />
        </Button>
        <div className="relative">
          <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-primary to-primary/80 shadow-2xl shadow-primary/30">
            <Bot className="h-12 w-12 text-primary-foreground" />
          </div>
          <span className="absolute -bottom-1 -left-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-background bg-gold text-primary-foreground shadow" aria-hidden>
            <Sparkles className="h-3.5 w-3.5" />
          </span>
        </div>
        <h2 className="text-2xl font-black sm:text-3xl">هوش نخل در انتظار شماست 🌴</h2>
        <p className="max-w-md leading-7 text-muted-foreground">
          برای سفارش‌گرفتن با دستیار هوشمند رستوران نخل، ابتدا با شماره موبایل خود وارد شوید.
          بدون رمز عبور — فقط کد یکبارمصرف پیامکی!
        </p>
        <Button onClick={() => setAuthOpen(true)} size="lg" className="rounded-2xl px-8 text-base font-extrabold shadow-lg shadow-primary/25">
          <Phone className="ml-2 h-5 w-5" />
          ورود با شماره موبایل
        </Button>
      </div>
    );
  }

  const sidebar = (
    <ConversationSidebar
      sessions={searchResults ?? sessions}
      activeId={sessionId}
      loading={sessionsLoading}
      onSelect={switchSession}
      onNew={newChat}
      onDelete={deleteSession}
      onRename={renameSession}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      searching={searching}
    />
  );

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[95rem] flex-1 flex-col">
      <div className="flex min-h-0 flex-1 gap-3 p-0 sm:gap-3 sm:p-4">
        {/* ── conversations rail (desktop) ── */}
        <div className="hidden w-72 shrink-0 lg:block">{sidebar}</div>

        {/* ── main chat column — موبایل: تمام‌صفحه و بدون حاشیه؛ دسکتاپ: کارت گرد با سایه ── */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-none border-0 bg-gradient-to-b from-card/70 to-background shadow-none sm:rounded-3xl sm:border sm:shadow-xl">
          {/* header — در موبایل دکمهٔ بازگشت به خانه فقط گوشهٔ بالا (RTL: راست) */}
          <div className="flex items-center justify-between gap-2 border-b bg-card/80 px-3 pb-2.5 pt-[calc(env(safe-area-inset-top,0px)+0.625rem)] backdrop-blur sm:px-4 sm:pb-2.5 sm:pt-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0 rounded-xl text-primary hover:bg-primary/10 hover:text-primary sm:hidden"
                onClick={() => setView("home")}
                aria-label="بازگشت به صفحه اصلی"
                title="بازگشت به صفحه اصلی"
              >
                <ArrowRight className="h-4.5 w-4.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0 rounded-xl lg:hidden"
                onClick={() => setSidebarOpen(true)}
                aria-label="گفتگوهای اخیر"
              >
                <PanelRight className="h-4.5 w-4.5" />
              </Button>
              <div className="relative shrink-0">
                <NakhlLogo size={40} />
                <span className="absolute -bottom-0.5 -left-0.5 h-3 w-3 rounded-full border-2 border-card bg-emerald-500" aria-label="آنلاین" />
              </div>
              <div className="min-w-0 leading-tight">
                <div className="flex items-center gap-1.5 text-sm font-extrabold">
                  هوش نخل
                  <Badge className="bg-gradient-to-l from-primary to-gold text-white">AI</Badge>
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {sending ? "در حال نوشتن..." : stage ? `مرحله: ${STAGE_LABELS[stage] ?? stage}` : "گارسون هوشمند شما"}
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={newChat}
              className="shrink-0 rounded-xl gap-1.5 text-xs"
              title="شروع گفتگوی جدید"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">گفتگوی جدید</span>
            </Button>
          </div>

          {/* stage step chips — visible during the order flow; the user can jump back to any step */}
          {orderFlowActive && (
            <div className="border-b bg-muted/30 px-3 py-2 sm:px-4" aria-label="مراحل سفارش">
              <div className="nice-scroll flex items-center gap-1 overflow-x-auto pb-0.5">
                {STEP_CHIPS.map((chip, i) => {
                  const Icon = chip.icon;
                  const current = stage === chip.stage;
                  return (
                    <div key={chip.stage} className="flex shrink-0 items-center gap-1">
                      {i > 0 && <ChevronLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" aria-hidden />}
                      <button
                        onClick={() => send(chip.message)}
                        disabled={sending}
                        className={cn(
                          "flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] font-bold transition-all active:scale-95",
                          current
                            ? "border-primary bg-primary text-primary-foreground shadow-md shadow-primary/25"
                            : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-primary"
                        )}
                        aria-current={current ? "step" : undefined}
                        title={`برگشت به ${chip.label}`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {chip.label}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {stage === "TRACKING" && (
            <div className="flex items-center gap-2 border-b bg-primary/5 px-3 py-2 text-[11px] font-bold text-primary sm:px-4">
              <Package className="h-4 w-4" />
              سفارشتان در جریان است — برای تغییر یا سفارش جدید، همین‌جا پیام بدهید
            </div>
          )}

          {/* messages */}
          <div className="nice-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4 sm:px-5">
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
                      <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                        مثل یک گارسون واقعی سفارشتون رو می‌گیرم؛ منو رو نشون می‌دم، بر اساس سلیقه‌تون پیشنهاد می‌دم و تا پرداخت همراهتونم —
                        هر وقت هم بخواید می‌تونید به مراحل قبلی برگردید و سفارش رو اصلاح کنید.
                      </p>
                    </div>
                    <div className="flex max-w-lg flex-wrap justify-center gap-2.5 px-1 py-2">
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
                  <div key={msg.id} className={`flex animate-fade-up gap-2.5 ${msg.role === "USER" ? "flex-row-reverse" : ""}`}>
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
                          className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-7 shadow-sm sm:max-w-[75%] ${
                            msg.role === "USER"
                              ? "rounded-tr-md bg-primary text-primary-foreground"
                              : msg.metadata?.paymentSuccess
                                ? "rounded-tl-md border border-emerald-500/30 bg-emerald-500/10"
                                : msg.metadata?.paymentFailed
                                  ? "rounded-tl-md border border-amber-500/40 bg-amber-500/10"
                                  : "rounded-tl-md border bg-card"
                          }`}
                        >
                          {msg.content}
                        </div>
                      )}
                      {/* rich components */}
                      {msg.metadata?.menu && <MenuCards payload={msg.metadata.menu} />}
                      {msg.metadata?.orderSummary && (
                        <OrderSummaryBox
                          payload={msg.metadata.orderSummary}
                          live={invoiceLive && msg.id === lastInvoiceId}
                          onUpdate={(payload, nextStage) => handleInvoiceUpdate(msg.id, payload, nextStage)}
                        />
                      )}
                      {msg.metadata?.tracking && (
                        <TrackingCard payload={msg.metadata.tracking} onReorder={handleTrackingReorder} />
                      )}
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
                      <span className="px-1 text-[10px] text-muted-foreground">{formatTime(msg.createdAt)}</span>
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

          {/* input — نوار پایین با احترام به ناحیهٔ امن موبایل (نوچ پایین) */}
          <div className="border-t bg-card/80 p-2.5 pb-[calc(env(safe-area-inset-bottom,0px)+0.625rem)] backdrop-blur sm:p-3 sm:pb-3">
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
                placeholder="پیام خود را بنویسید…"
                className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border-0 bg-background/60 px-4 py-2.5 text-sm focus-visible:ring-1 focus-visible:ring-primary/40"
                rows={1}
                disabled={sending}
              />
              <Button
                onClick={() => send()}
                disabled={sending || !input.trim()}
                className="h-11 w-11 shrink-0 rounded-2xl p-0 shadow-lg shadow-primary/25"
                aria-label="ارسال پیام"
              >
                {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 -scale-x-100" />}
              </Button>
            </div>
            <div className="mt-1.5 flex items-center justify-between px-2 pb-0.5 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-gold" />
                هوش نخل سابقهٔ سفارش‌های شما را به خاطر دارد؛ قیمت نهایی همیشه در فاکتور سیستمی است.
              </span>
              <span className="hidden sm:block">Shift + Enter = خط جدید</span>
            </div>
          </div>
        </div>
      </div>

      {/* conversations — mobile sheet */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="right" className="w-[85vw] max-w-80 border-l bg-background p-0 sm:max-w-80">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-right text-sm font-extrabold">گفتگوهای هوش نخل</SheetTitle>
          </SheetHeader>
          <div className="h-[calc(100%-3.5rem)] p-3">{sidebar}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
