/**
 * Share helpers — build Persian order summaries and open WhatsApp / Web Share.
 * Client-side only.
 */

import { formatToman, formatJalali, toPersianDigits } from "@/lib/fa";

export interface ShareOrderData {
  orderNumber: string;
  statusLabel?: string;
  type: string;
  subtotal: number;
  discount?: number;
  couponCode?: string | null;
  deliveryFee?: number;
  taxAmount?: number;
  total: number;
  paymentRef?: string | null;
  createdAt?: string;
  scheduledFor?: string | null;
  items: { name: string; quantity: number }[];
}

/** Build a compact Persian order summary suitable for messaging apps */
export function buildOrderShareText(order: ShareOrderData): string {
  const lines: string[] = [];
  lines.push("🌴 رستوران نخل رفسنجان — رسید سفارش");
  lines.push("─".repeat(22));
  lines.push(`شماره سفارش: ${order.orderNumber}`);
  if (order.createdAt) lines.push(`تاریخ ثبت: ${formatJalali(order.createdAt, true)}`);
  if (order.statusLabel) lines.push(`وضعیت: ${order.statusLabel}`);
  lines.push(`نوع تحویل: ${order.type === "DELIVERY" ? "ارسال با پیک 🛵" : "بیرون‌بر 🥡"}`);
  lines.push("─".repeat(22));
  lines.push("اقلام سفارش:");
  for (const it of order.items) {
    lines.push(`• ${it.name} ×${toPersianDigits(it.quantity)}`);
  }
  lines.push("─".repeat(22));
  lines.push(`جمع اقلام: ${formatToman(order.subtotal)}`);
  if (order.discount && order.discount > 0) {
    lines.push(`تخفیف${order.couponCode ? ` (کد ${order.couponCode})` : ""}: −${formatToman(order.discount)}`);
  }
  if (order.type === "DELIVERY" && order.deliveryFee != null) {
    lines.push(`هزینه پیک: ${order.deliveryFee === 0 ? "رایگان" : formatToman(order.deliveryFee)}`);
  }
  if (order.taxAmount != null) lines.push(`مالیات ارزش افزوده: ${formatToman(order.taxAmount)}`);
  lines.push(`مبلغ کل: ${formatToman(order.total)}`);
  if (order.paymentRef) lines.push(`کد رهگیری پرداخت: ${toPersianDigits(order.paymentRef)}`);
  lines.push("─".repeat(22));
  lines.push("سفارش آنلاین: rafsanjan-nakhl.ir");
  return lines.join("\n");
}

/**
 * Share text — WhatsApp deep link in a new tab, with Web-Share fallback
 * (mobile native sheet) when the Web Share API is available.
 */
export function shareOrderText(text: string, title = "رسید سفارش رستوران نخل"): Promise<boolean> {
  const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
  // Prefer the native share sheet on mobile devices
  if (typeof nav.share === "function" && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
    return nav
      .share({ title, text })
      .then(() => true)
      .catch(() => false);
  }
  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank", "noopener,noreferrer");
  return Promise.resolve(true);
}
