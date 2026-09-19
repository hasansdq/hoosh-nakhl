import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, requireAdmin, logAudit } from "@/lib/api";
import { getClientIp } from "@/lib/auth";
import { toJalali } from "@/lib/fa";

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function toCsv(rows: (string | number | null)[][]): string {
  return rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
}

/**
 * Admin CSV export: /api/admin/export?dataset=orders|users|reviews
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const url = new URL(req.url);
    const dataset = url.searchParams.get("dataset") ?? "orders";
    let csv = "";
    let filename = "report.csv";

    if (dataset === "orders") {
      const orders = await db.order.findMany({
        orderBy: { createdAt: "desc" },
        include: { user: { select: { firstName: true, lastName: true, phone: true } }, items: true },
        take: 5000,
      });
      const rows: (string | number | null)[][] = [
        ["شماره سفارش", "تاریخ", "مشتری", "موبایل", "نوع", "وضعیت", "پرداخت", "جمع", "تخفیف", "کد تخفیف", "پیک", "مالیات", "مبلغ نهایی", "آیتم‌ها"],
        ...orders.map((o) => {
          const j = toJalali(o.createdAt);
          return [
            o.orderNumber,
            `${j.jy}/${String(j.jm).padStart(2, "0")}/${String(j.jd).padStart(2, "0")}`,
            `${o.user?.firstName ?? ""} ${o.user?.lastName ?? ""}`.trim() || "-",
            o.user?.phone ?? "-",
            o.type === "DELIVERY" ? "پیک" : "بیرونبر",
            o.status,
            o.paymentStatus,
            o.subtotal,
            o.discount,
            o.couponCode ?? "",
            o.deliveryFee,
            o.taxAmount,
            o.total,
            o.items.map((i) => `${i.name}×${i.quantity}`).join(" | "),
          ];
        }),
      ];
      csv = "\uFEFF" + toCsv(rows); // BOM for Excel Persian support
      filename = `nakhl-orders-${Date.now()}.csv`;
    } else if (dataset === "users") {
      const users = await db.user.findMany({
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { orders: true } } },
        take: 5000,
      });
      const rows: (string | number | null)[][] = [
        ["نام", "نام خانوادگی", "موبایل", "ایمیل", "کد ملی", "تعداد سفارش", "وضعیت", "تاریخ عضویت"],
        ...users.map((u) => {
          const j = toJalali(u.createdAt);
          return [
            u.firstName ?? "",
            u.lastName ?? "",
            u.phone,
            u.email ?? "",
            u.nationalId ?? "",
            u._count.orders,
            u.status,
            `${j.jy}/${String(j.jm).padStart(2, "0")}/${String(j.jd).padStart(2, "0")}`,
          ];
        }),
      ];
      csv = "\uFEFF" + toCsv(rows);
      filename = `nakhl-users-${Date.now()}.csv`;
    } else if (dataset === "reviews") {
      const reviews = await db.review.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { firstName: true, lastName: true, phone: true } },
          menuItem: { select: { name: true } },
        },
        take: 5000,
      });
      const rows: (string | number | null)[][] = [
        ["غذا", "نویسنده", "موبایل", "امتیاز", "نظر", "وضعیت", "تاریخ"],
        ...reviews.map((r) => {
          const j = toJalali(r.createdAt);
          return [
            r.menuItem.name,
            `${r.user.firstName ?? ""} ${r.user.lastName ?? ""}`.trim() || "-",
            r.user.phone,
            r.rating,
            r.comment ?? "",
            r.status,
            `${j.jy}/${String(j.jm).padStart(2, "0")}/${String(j.jd).padStart(2, "0")}`,
          ];
        }),
      ];
      csv = "\uFEFF" + toCsv(rows);
      filename = `nakhl-reviews-${Date.now()}.csv`;
    } else {
      return fail("مجموعه داده نامعتبر است", 400);
    }

    await logAudit(session.admin.username, "DATA_EXPORTED", {
      entity: "export",
      detail: { dataset },
      ip: getClientIp(req),
    });

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    console.error("export error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}
