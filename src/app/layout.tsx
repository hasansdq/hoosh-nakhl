import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { AppProviders } from "@/components/AppProviders";

const yekanBakh = localFont({
  src: "./fonts/YekanBakhFaNum-VF.woff",
  variable: "--font-yekan",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: true,
});

export const metadata: Metadata = {
  title: "رستوران نخل رفسنجان | سفارش آنلاین با هوش مصنوعی",
  description:
    "سامانه سفارش آنلاین رستوران نخل رفسنجان با هوش نخل، دستیار هوشمند سفارش غذا. سفارش‌دهی گفتگومحور، پرداخت امن زرین‌پال و ارسال سریع.",
  keywords: ["رستوران نخل", "رفسنجان", "سفارش آنلاین غذا", "هوش مصنوعی", "رستوران"],
  authors: [{ name: "رستوران نخل رفسنجان" }],
  manifest: "/manifest.json",
  // Favicon & apple-touch-icon come from the app-router file conventions:
  // src/app/favicon.ico (16/32/48), src/app/icon.svg (vector), src/app/apple-icon.png (180).
  // Next.js emits the <link> tags automatically — no manual `icons` config needed.
  openGraph: {
    title: "رستوران نخل رفسنجان | سفارش آنلاین با هوش مصنوعی",
    description: "با هوش نخل سفارش بده، مثل حضوری!",
    type: "website",
    locale: "fa_IR",
  },
};

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
