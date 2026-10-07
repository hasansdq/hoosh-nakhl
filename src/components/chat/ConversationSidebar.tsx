"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  MessageSquareText,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Bot,
  Clock,
  History,
  Search,
  Loader2,
  SearchX,
} from "lucide-react";
import { toPersianDigits, formatJalali } from "@/lib/fa";
import { cn } from "@/lib/utils";

export interface ChatSessionSummary {
  id: string;
  title: string | null;
  stage: string;
  stageLabel: string;
  status: string;
  orderId: string | null;
  messageCount: number;
  updatedAt: string;
  createdAt: string;
  /** فقط در حالت جستجو: آیا خود عنوان منطبق بوده؟ */
  matchedInTitle?: boolean;
  /** فقط در حالت جستجو: قطعه‌ای از اولین پیام منطبق */
  snippet?: string | null;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "همین حالا";
  if (m < 60) return `${toPersianDigits(m)} دقیقه پیش`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${toPersianDigits(h)} ساعت پیش`;
  const d = Math.floor(h / 24);
  if (d === 1) return "دیروز";
  if (d < 7) return `${toPersianDigits(d)} روز پیش`;
  return formatJalali(new Date(iso));
}

function dayBucket(iso: string): "today" | "yesterday" | "older" {
  const now = new Date();
  const d = new Date(iso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= startOfToday) return "today";
  if (t >= startOfToday - 86_400_000) return "yesterday";
  return "older";
}

const BUCKET_LABELS: Record<string, string> = {
  today: "امروز",
  yesterday: "دیروز",
  older: "قدیمی‌تر",
};

/**
 * Recent-conversations rail for the Nakhl AI page.
 * Used twice: as the static desktop sidebar and inside the mobile sheet.
 */
export function ConversationSidebar({
  sessions,
  activeId,
  loading,
  onSelect,
  onNew,
  onDelete,
  onRename,
  /** عبارت جستجوی فعال — غیرخالی یعنی حالت جستجو (لیست مسطح + snippet) */
  searchQuery,
  onSearchQueryChange,
  searching,
  className,
}: {
  sessions: ChatSessionSummary[];
  activeId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  searching: boolean;
  className?: string;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId) inputRef.current?.focus();
  }, [renamingId]);

  const isSearching = searchQuery.trim().length >= 2;

  // باکت‌بندی باید در هر رندر از نو ساخته شود — push داخل آرایهٔ memo شده
  // باعث تکرار ردیف‌ها بین رندرها می‌شد
  const buckets: { key: string; items: ChatSessionSummary[] }[] = [
    { key: "today", items: [] },
    { key: "yesterday", items: [] },
    { key: "older", items: [] },
  ];
  if (!isSearching) {
    for (const s of sessions) {
      buckets.find((b) => b.key === dayBucket(s.updatedAt))?.items.push(s);
    }
  }

  const commitRename = () => {
    if (renamingId && renameValue.trim().length >= 2) {
      onRename(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  };

  /** یک ردیف گفتگو — هم در حالت عادی (باکت‌بندی روز) و هم در حالت جستجو (با snippet) */
  const renderRow = (s: ChatSessionSummary) => {
    const active = s.id === activeId;
    if (renamingId === s.id) {
      return (
        <div className="flex items-center gap-1 rounded-xl border border-primary/40 bg-background p-1.5">
          <Input
            ref={inputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenamingId(null);
            }}
            maxLength={60}
            className="h-8 rounded-lg border-0 text-xs font-semibold focus-visible:ring-1"
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 text-emerald-600"
            onClick={commitRename}
            aria-label="ذخیره عنوان"
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 text-muted-foreground"
            onClick={() => setRenamingId(null)}
            aria-label="انصراف"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      );
    }
    return (
      <div
        className={cn(
          "group relative flex cursor-pointer items-start gap-2.5 rounded-xl border border-transparent px-2.5 py-2.5 transition-all",
          active
            ? "border-primary/30 bg-primary/10 shadow-sm"
            : "hover:border-border hover:bg-muted/60"
        )}
        onClick={() => onSelect(s.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(s.id);
          }
        }}
      >
        <span
          className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
            active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          )}
        >
          <MessageSquareText className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-bold leading-5">
            {s.title?.trim() || `گفتگو ${formatJalali(new Date(s.createdAt))}`}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            {timeAgo(s.updatedAt)}
            <span className="opacity-40">•</span>
            <span className="truncate">{s.stageLabel}</span>
          </div>
          {/* حالت جستجو: قطعه‌ای از اولین پیام منطبق */}
          {isSearching && s.snippet && (
            <div className="mt-1 line-clamp-2 rounded-lg bg-muted/70 px-2 py-1 text-[10px] leading-4 text-muted-foreground" dir="auto">
              {s.snippet}
            </div>
          )}
        </div>
        {/* hover actions */}
        <div className="absolute left-1 top-1.5 flex flex-col gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            className="flex h-6 w-6 items-center justify-center rounded-md bg-background/90 text-muted-foreground shadow-sm transition-colors hover:text-primary"
            onClick={(e) => {
              e.stopPropagation();
              setRenamingId(s.id);
              setRenameValue(s.title ?? "");
            }}
            aria-label="تغییر عنوان گفتگو"
            title="تغییر عنوان"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            className="flex h-6 w-6 items-center justify-center rounded-md bg-background/90 text-muted-foreground shadow-sm transition-colors hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(s.id);
            }}
            aria-label="حذف گفتگو"
            title="حذف"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <aside
      className={cn(
        "flex min-h-0 w-full flex-col overflow-hidden rounded-3xl border bg-card/55 shadow-lg backdrop-blur",
        className
      )}
      aria-label="گفتگوهای اخیر"
    >
      {/* header */}
      <div className="border-b bg-gradient-to-l from-primary/10 to-transparent px-4 py-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-extrabold">
            <History className="h-4.5 w-4.5 text-primary" />
            گفتگوهای اخیر
            {sessions.length > 0 && (
              <Badge variant="secondary" className="rounded-full px-1.5 text-[10px]">
                {toPersianDigits(sessions.length)}
              </Badge>
            )}
          </div>
        </div>
        <Button
          onClick={onNew}
          className="mt-3 h-10 w-full rounded-xl font-bold shadow-md shadow-primary/20"
          size="sm"
        >
          <Plus className="ml-1 h-4 w-4" />
          گفتگوی جدید
        </Button>

        {/* search box — جستجو در عنوان و متن پیام‌های گفتگوها */}
        <div className="relative mt-2.5">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onSearchQueryChange("");
            }}
            placeholder="جستجو در گفتگوها…"
            className="h-9 rounded-xl bg-background/70 pr-9 pl-8 text-xs font-medium placeholder:text-muted-foreground/70 focus-visible:ring-1"
            maxLength={60}
            aria-label="جستجو در گفتگوها"
          />
          {searching ? (
            <Loader2 className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : searchQuery ? (
            <button
              className="absolute left-2.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => {
                onSearchQueryChange("");
                searchRef.current?.focus();
              }}
              aria-label="پاک‌کردن جستجو"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      </div>

      {/* list */}
      <div className="nice-scroll min-h-0 flex-1 overflow-y-auto p-2">
        {loading && sessions.length === 0 && !isSearching ? (
          <div className="space-y-2 p-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skeleton h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : isSearching && sessions.length === 0 ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 p-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
              <SearchX className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-xs font-semibold leading-5 text-muted-foreground">
              گفتگویی با «{searchQuery.trim()}» پیدا نشد
            </p>
            <p className="text-[10px] leading-4 text-muted-foreground/70">
              عبارت دیگری امتحان کنید — جستجو شامل عنوان و متن پیام‌هاست
            </p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 p-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
              <Bot className="h-6 w-6 text-primary" />
            </div>
            <p className="text-xs font-semibold leading-5 text-muted-foreground">
              هنوز گفتگویی ثبت نشده —
              <br />
              اولین سفارشتون رو با هوش نخل شروع کنید 🌴
            </p>
          </div>
        ) : isSearching ? (
          <div>
            <div className="sticky top-0 z-10 bg-card/80 px-2 py-1.5 text-[10px] font-bold text-muted-foreground backdrop-blur">
              {searching
                ? "در حال جستجو…"
                : `${toPersianDigits(sessions.length)} گفتگو پیدا شد`}
            </div>
            <ul className="space-y-1">
              {sessions.map((s) => (
                <li key={s.id}>{renderRow(s)}</li>
              ))}
            </ul>
          </div>
        ) : (
          buckets
            .filter((b) => b.items.length > 0)
            .map((bucket) => (
              <div key={bucket.key} className="mb-1">
                <div className="sticky top-0 z-10 bg-card/80 px-2 py-1.5 text-[10px] font-bold text-muted-foreground backdrop-blur">
                  {BUCKET_LABELS[bucket.key]}
                </div>
                <ul className="space-y-1">
                  {bucket.items.map((s) => (
                    <li key={s.id}>{renderRow(s)}</li>
                  ))}
                </ul>
              </div>
            ))
        )}
      </div>

      {/* footer note */}
      <div className="border-t bg-muted/30 px-3.5 py-2.5 text-center text-[10px] leading-4 text-muted-foreground">
        سوابق گفتگوها و سفارش‌های شما نزد هوش نخل می‌ماند 🌴
      </div>
    </aside>
  );
}
