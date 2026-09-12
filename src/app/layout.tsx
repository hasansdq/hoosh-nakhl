import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { AppProviders } from "@/components/AppProviders";
import { getSettings, type GeneralSettings } from "@/lib/settings";
import { getSiteContent } from "@/lib/site-content";
import { interpolateContent } from "@/lib/content-defs";

const yekanBakh = localFont({
  src: "./fonts/YekanBakhFaNum-VF.woff",
  variable: "--font-yekan",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: true,
});

/**
 * SEO metadata is admin-managed (CMS → سئو و اشتراک‌گذاری). Placeholders
 * like {restaurantName}/{city} are interpolated with the live «عمومی»
 * settings; every field falls back to its registry default on DB failure.
 */
export async function generateMetadata(): Promise<Metadata> {
  let title = "رستوران نخل رفسنجان | سفارش آنلاین با هوش مصنوعی";
  let description =
    "سامانه سفارش آنلاین رستوران نخل رفسنجان با هوش نخل، دستیار هوشمند سفارش غذا. سفارش‌دهی گفتگومحور، پرداخت امن زرین‌پال و ارسال سریع.";
  let ogTitle = "رستوران نخل رفسنجان | سفارش آنلاین با هوش مصنوعی";
  let ogDescription = "با هوش نخل سفارش بده، مثل حضوری!";
  let keywords: string[] = ["رستوران نخل", "رفسنجان", "سفارش آنلاین غذا", "هوش مصنوعی", "رستوران"];

  try {
    const [content, general] = await Promise.all([
      getSiteContent(),
      getSettings<GeneralSettings>("general"),
    ]);
    const vars: Record<string, string> = {
      restaurantName: general.restaurantName,
      restaurantTagline: general.restaurantTagline,
      city: general.city,
      address: general.address,
      phone: general.phone,
      workingHours: general.workingHours,
      email: general.email,
      instagram: general.instagram,
      telegram: general.telegram,
    };
    title = interpolateContent(content["seo.title"] ?? title, vars);
    description = interpolateContent(content["seo.description"] ?? description, vars);
    ogTitle = interpolateContent(content["seo.ogTitle"] ?? ogTitle, vars);
    ogDescription = interpolateContent(content["seo.ogDescription"] ?? ogDescription, vars);
    const rawKeywords = interpolateContent(content["seo.keywords"] ?? "", vars);
    if (rawKeywords.trim() !== "") {
      keywords = rawKeywords
        .split(/[,،]/)
        .map((k) => k.trim())
        .filter(Boolean)
        .slice(0, 20);
    }
  } catch {
    /* keep the defaults above — SEO must never break the layout */
  }

  return {
    title,
    description,
    keywords,
    authors: [{ name: "رستوران نخل رفسنجان" }],
    manifest: "/manifest.json",
    // Favicon & apple-touch-icon come from the app-router file conventions:
    // src/app/favicon.ico (16/32/48), src/app/icon.svg (vector), src/app/apple-icon.png (180).
    // Next.js emits the <link> tags automatically — no manual `icons` config needed.
    openGraph: {
      title: ogTitle,
      description: ogDescription,
      type: "website",
      locale: "fa_IR",
    },
  };
}

// SEO values come from the CMS — re-render the shell every 5 minutes so
// admin edits show up without a redeploy (ISR; ignored in dev).
export const revalidate = 300;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f4ec" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1512" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body className={`${yekanBakh.variable} font-sans antialiased bg-background text-foreground`}>
        <AppProviders>
          {children}
          <Toaster position="top-center" richColors dir="rtl" />
        </AppProviders>
      </body>
    </html>
  );
}
