import { NextRequest, NextResponse } from "next/server";
import {
  baranGuard,
  handleProductSend,
  handleSendPics,
  handleGetOrders,
  handleClearOrders,
} from "@/lib/baran";

/**
 * Nakhl × Baran — public API surface (called BY the accounting software)
 * ------------------------------------------------------------------------
 *   DomainName/api/ApiServiceBaran/<Method>
 *
 * Method names are matched case-insensitively (ProductSEND / productsend /
 * ProductSend …) so casing differences in the software never break the
 * integration. Only the methods the restaurant needs are live:
 *
 *   POST ProductSEND   products  Baran → site
 *   POST SENDPics      pictures  Baran → site
 *   GET  Orders        orders    site → Baran
 *   POST ClearOrders   ack       Baran → site (no-resend)
 *   GET  Ping          health    non-mutating round-trip (used by the admin
 *                                connection test; harmless if Baran calls it)
 *
 * CustomersSEND / SendCoupons / GetChargeWallet are intentionally not
 * implemented (out of the agreed scope) — they answer a descriptive 404.
 *
 * Every response is JSON with explicit UTF-8; outputs never contain null
 * (a hard requirement of the Baran client).
 */

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ method: string[] }> };

async function resolveMethod(ctx: Ctx): Promise<string | null> {
  const { method } = await ctx.params;
  const last = method?.[method.length - 1];
  return last ? decodeURIComponent(last).toLowerCase() : null;
}

const UNKNOWN_METHOD = () =>
  NextResponse.json(
    { error: "متد ناشناخته — متدهای فعال: Orders و Ping (GET)، ProductSEND، SENDPics، ClearOrders (POST)" },
    { status: 404 },
  );

export async function GET(req: NextRequest, ctx: Ctx) {
  const name = await resolveMethod(ctx);
  if (name === "ping") {
    // health round-trip — همان نگهبان متدهای واقعی (503 غیرفعال / 401 کلید)
    const guard = await baranGuard(req);
    if (guard) return guard;
    return NextResponse.json(
      { ok: true, service: "ApiServiceBaran", method: "Ping", serverTime: new Date().toISOString() },
      { headers: { "cache-control": "no-store" } },
    );
  }
  if (name !== "orders") {
    if (name && ["productsend", "sendpics", "clearorders"].includes(name)) {
      return NextResponse.json({ error: "این متد با درخواست POST فراخوانی می‌شود" }, { status: 405 });
    }
    return UNKNOWN_METHOD();
  }

  const guard = await baranGuard(req);
  if (guard) return guard;

  return handleGetOrders(req);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const name = await resolveMethod(ctx);
  if (!name || !["productsend", "sendpics", "clearorders", "orders"].includes(name)) {
    return UNKNOWN_METHOD();
  }
  if (name === "orders") {
    return NextResponse.json({ error: "متد Orders با درخواست GET فراخوانی می‌شود" }, { status: 405 });
  }

  let body: unknown = null;
  const text = await req.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    return NextResponse.json({ error: "بدنهٔ درخواست JSON معتبر نیست" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "بدنهٔ درخواست باید آرایه/آبجکت JSON باشد" },
      { status: 400 },
    );
  }

  const guard = await baranGuard(req);
  if (guard) return guard;

  switch (name) {
    case "productsend":
      return handleProductSend(req, body);
    case "sendpics":
      return handleSendPics(req, body);
    default:
      return handleClearOrders(req, body);
  }
}
