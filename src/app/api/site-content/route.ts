import { NextResponse } from "next/server";
import { getSiteContent } from "@/lib/site-content";

/**
 * Public site-content endpoint (CMS).
 * Returns the effective map (defaults + admin overrides) for every
 * storefront text/image key. Placeholder interpolation ({city}, …) is done
 * client-side so the values stay in sync with the live «عمومی» settings.
 * Never breaks on DB errors — the registry defaults are always served.
 */
export async function GET() {
  try {
    const content = await getSiteContent();
    return NextResponse.json(
      { success: true, content },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ success: true, content: {} });
  }
}
