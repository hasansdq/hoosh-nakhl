"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatJalali, toPersianDigits } from "@/lib/fa";
import { UploadCloud, Trash2, Loader2, FileImage, Clipboard, ScrollText, Download } from "lucide-react";
import { toast } from "sonner";

// ==================== Uploads ====================

interface UploadRow {
  id: string;
  filename: string;
  url: string;
  mimeType: string;
  size: number;
  uploadedBy: string | null;
  createdAt: string;
}

export function UploadsManager() {
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    const res = await api<{ uploads: UploadRow[]; pagination: { pages: number } }>(`/api/admin/uploads?page=${p}`);
    if (res.success) {
      setUploads(res.uploads ?? []);
      setPages(res.pagination?.pages ?? 1);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetching
    load(page);
  }, [page, load]);

  const remove = async (u: UploadRow) => {
    setDeleting(u.id);
    const res = await api("/api/admin/uploads", { method: "DELETE", body: { url: u.url } });
    setDeleting(null);
    if (!res.success) return toast.error(res.error ?? "خطا در حذف");
    toast.success("فایل حذف شد");
    load(page);
  };

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url).then(
      () => toast.success("آدرس فایل کپی شد 📋"),
      () => toast.error("کپی ناموفق")
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-black">
          <UploadCloud className="h-6 w-6 text-primary" />
          مدیریت فایل‌ها
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          فایل‌های آپلودشده (تصاویر غذاها و آواتارها) — بهینه‌سازی خودکار WebP با sharp
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[...Array(10)].map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-2xl" />
          ))}
        </div>
      ) : uploads.length === 0 ? (
        <Card className="border-dashed p-12 text-center text-muted-foreground">
          هنوز فایلی آپلود نشده است
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {uploads.map((u) => (
              <Card key={u.id} className="group gap-0 overflow-hidden rounded-2xl p-0">
                <div className="relative h-28 bg-muted">
                  {u.mimeType.startsWith("image/") ? (
                    <Image src={u.url} alt={u.filename} fill sizes="20vw" className="object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <FileImage className="h-10 w-10 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="p-2.5">
                  <div className="truncate text-[11px] font-bold" dir="ltr">{u.filename}</div>
                  <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{(u.size / 1024).toFixed(0)} KB</span>
                    <span>{formatJalali(u.createdAt)}</span>
                  </div>
                  <div className="mt-2 flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 flex-1 rounded-lg px-2 text-[10px]"
                      onClick={() => copyUrl(u.url)}
                    >
                      <Clipboard className="ml-1 h-3 w-3" />
                      کپی URL
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 rounded-lg p-0 text-destructive"
                      onClick={() => remove(u)}
                      disabled={deleting === u.id}
                    >
                      {deleting === u.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-xl">قبلی</Button>
              <span className="text-sm font-bold">صفحه {toPersianDigits(page)} از {toPersianDigits(pages)}</span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-xl">بعدی</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ==================== Audit Log ====================

interface AuditRow {
  id: string;
  actor: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  detail: unknown;
  ip: string | null;
  createdAt: string;
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  ADMIN_LOGIN_SUCCESS: { label: "ورود موفق مدیر", color: "bg-emerald-500/10 text-emerald-600" },
  ADMIN_LOGIN_FAILED: { label: "تلاش ورود ناموفق", color: "bg-red-500/10 text-red-600" },
  ADMIN_LOGOUT: { label: "خروج مدیر", color: "bg-muted text-muted-foreground" },
  MENU_ITEM_CREATED: { label: "ایجاد آیتم منو", color: "bg-primary/10 text-primary" },
  MENU_ITEM_UPDATED: { label: "ویرایش آیتم منو", color: "bg-primary/10 text-primary" },
  MENU_ITEM_DELETED: { label: "حذف آیتم منو", color: "bg-red-500/10 text-red-600" },
  CATEGORY_CREATED: { label: "ایجاد دسته", color: "bg-primary/10 text-primary" },
  CATEGORY_UPDATED: { label: "ویرایش دسته", color: "bg-primary/10 text-primary" },
  CATEGORY_DELETED: { label: "حذف دسته", color: "bg-red-500/10 text-red-600" },
  ORDER_STATUS_UPDATED: { label: "تغییر وضعیت سفارش", color: "bg-gold/15 text-gold-foreground" },
  USER_BLOCKED: { label: "مسدودسازی کاربر", color: "bg-red-500/10 text-red-600" },
  USER_UPDATED: { label: "به‌روزرسانی کاربر", color: "bg-primary/10 text-primary" },
  SETTINGS_UPDATED: { label: "تغییر تنظیمات", color: "bg-gold/15 text-gold-foreground" },
  USER_REGISTERED: { label: "ثبت‌نام کاربر", color: "bg-emerald-500/10 text-emerald-600" },
  OTP_SENT: { label: "ارسال کد تأیید", color: "bg-muted text-muted-foreground" },
  OTP_SEND_FAILED: { label: "خطای ارسال کد", color: "bg-red-500/10 text-red-600" },
  PAYMENT_REQUESTED: { label: "درخواست پرداخت", color: "bg-gold/15 text-gold-foreground" },
  PAYMENT_SIMULATED_SUCCESS: { label: "پرداخت آزمایشی موفق", color: "bg-emerald-500/10 text-emerald-600" },
  PAYMENT_SIMULATED_FAILED: { label: "پرداخت آزمایشی ناموفق", color: "bg-red-500/10 text-red-600" },
  PROFILE_UPDATED: { label: "ویرایش پروفایل", color: "bg-muted text-muted-foreground" },
  UPLOAD_DELETED: { label: "حذف فایل", color: "bg-red-500/10 text-red-600" },
};

/** CSV export — opens a download endpoint in a new tab */
function exportCsv(dataset: "orders" | "users" | "reviews") {
  window.open(`/api/admin/export?dataset=${dataset}`, "_blank");
}

export function AuditLogView() {
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await api<{ logs: AuditRow[]; pagination: { pages: number } }>(`/api/admin/audit?page=${page}`);
      if (res.success) {
        setLogs(res.logs ?? []);
        setPages(res.pagination?.pages ?? 1);
      }
      setLoading(false);
    })();
  }, [page]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-black">
          <ScrollText className="h-6 w-6 text-primary" />
          گزارش فعالیت‌ها
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">تمام اقدامات مهم سامانه به‌صورت امن ثبت می‌شود</p>
      </div>

      {/* CSV exports */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-3">
        <span className="text-xs font-bold text-muted-foreground">دریافت خروجی:</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportCsv("orders")}
          className="rounded-xl text-xs font-bold"
        >
          <Download className="ml-1.5 h-3.5 w-3.5" />
          خروجی سفارش‌ها (CSV)
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportCsv("users")}
          className="rounded-xl text-xs font-bold"
        >
          <Download className="ml-1.5 h-3.5 w-3.5" />
          خروجی کاربران (CSV)
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportCsv("reviews")}
          className="rounded-xl text-xs font-bold"
        >
          <Download className="ml-1.5 h-3.5 w-3.5" />
          خروجی نظرات (CSV)
        </Button>
      </div>

      <Card className="overflow-hidden rounded-2xl p-0">
        {loading ? (
          <div className="space-y-2 p-4">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="divide-y">
            {logs.map((log) => {
              const meta = ACTION_LABELS[log.action] ?? { label: log.action, color: "bg-muted text-muted-foreground" };
              return (
                <div key={log.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <Badge className={`${meta.color} text-[11px]`}>{meta.label}</Badge>
                    <span className="text-xs text-muted-foreground">{log.actor}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    {!!log.detail && (
                      <span className="hidden max-w-64 truncate sm:block" dir="auto">
                        {typeof log.detail === "object" ? JSON.stringify(log.detail) : String(log.detail)}
                      </span>
                    )}
                    <span>{formatJalali(log.createdAt, true)}</span>
                  </div>
                </div>
              );
            })}
            {logs.length === 0 && <div className="p-10 text-center text-muted-foreground">گزارشی موجود نیست</div>}
          </div>
        )}
      </Card>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-xl">قبلی</Button>
          <span className="text-sm font-bold">صفحه {toPersianDigits(page)} از {toPersianDigits(pages)}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-xl">بعدی</Button>
        </div>
      )}
    </div>
  );
}
