import { NextResponse } from "next/server";
import { getSettings, DEFAULT_GENERAL_SETTINGS } from "@/lib/settings";

/**
 * Public site settings (CMS-managed) — the subset safe to expose to visitors.
 * Sourced from the "general" settings group editable at /nk-admin → تنظیمات → عمومی.
 * Falls back to defaults if the DB row is missing/corrupt so the site never breaks.
 */
export async function GET() {
  try {
    const s = await getSettings<{
      restaurantName: string;
      restaurantTagline: string;
      address: string;
      phone: string;
      email: string;
      workingHours: string;
      city: string;
      instagram: string;
      telegram: string;
      aboutText: string;
      taxPercent: number;
      deliveryFee: number;
      minOrderAmount: number;
      freeDeliveryOver: number;
    }>("general");

    return NextResponse.json({
      success: true,
      settings: {
        restaurantName: s.restaurantName || DEFAULT_GENERAL_SETTINGS.restaurantName,
        restaurantTagline: s.restaurantTagline || DEFAULT_GENERAL_SETTINGS.restaurantTagline,
        address: s.address || DEFAULT_GENERAL_SETTINGS.address,
        phone: s.phone || DEFAULT_GENERAL_SETTINGS.phone,
        workingHours: s.workingHours || DEFAULT_GENERAL_SETTINGS.workingHours,
        city: s.city || DEFAULT_GENERAL_SETTINGS.city,
        instagram: s.instagram || "",
        telegram: s.telegram || "",
        email: s.email || "",
        aboutText: s.aboutText || DEFAULT_GENERAL_SETTINGS.aboutText,
        // financial rules are shown transparently in cart/invoice UIs
        taxPercent: s.taxPercent,
        deliveryFee: s.deliveryFee,
        minOrderAmount: s.minOrderAmount,
        freeDeliveryOver: s.freeDeliveryOver,
      },
    });
  } catch {
    // never break the storefront — serve defaults
    return NextResponse.json({ success: true, settings: DEFAULT_GENERAL_SETTINGS });
  }
}
