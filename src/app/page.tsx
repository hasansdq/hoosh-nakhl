"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";
import { SiteHeader } from "@/components/site/Header";
import { SiteFooter } from "@/components/site/Footer";
import { AuthPage } from "@/components/site/AuthPage";
import { HomeView } from "@/components/site/HomeView";
import { ChatView } from "@/components/chat/ChatView";
import { OrdersView } from "@/components/site/OrdersView";
import { ProfileView } from "@/components/site/ProfileView";
import { CartView } from "@/components/site/CartView";
import { TrackView } from "@/components/site/TrackView";
import { SimulatedGateway, PaymentResultBanner } from "@/components/site/SimulatedGateway";
import { BackToTop } from "@/components/site/BackToTop";
import { PwaManager } from "@/components/site/PwaManager";
import { MobileBottomNav } from "@/components/site/MobileBottomNav";
import { api } from "@/lib/client-api";
import { Loader2 } from "lucide-react";

export default function Page() {
  const {
    view,
    user,
    userLoading,
    refreshUser,
    menu,
    menuLoading,
    setMenu,
    setMenuLoading,
    setPaymentResult,
    paymentSimulation,
    authOpen,
    refreshSiteSettings,
  } = useAppStore();
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    const boot = async () => {
      await Promise.all([refreshUser(), refreshSiteSettings()]);
      const menuRes = await api<{ categories: typeof menu }>("/api/menu");
      if (menuRes.success) setMenu(menuRes.categories ?? []);
      setMenuLoading(false);
      setBooted(true);
    };
    boot();
  }, [refreshUser, refreshSiteSettings, setMenu, setMenuLoading]);

  // handle ZarinPal return query params: /?payment=success&order=NK-...&ref=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");
    if (payment === "success" || payment === "failed") {
      setPaymentResult({
        status: payment === "success" ? "success" : "failed",
        orderNumber: params.get("order") ?? undefined,
        ref: params.get("ref") ?? undefined,
        reason: params.get("reason") ?? undefined,
      });
      // clean the URL
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [setPaymentResult]);

  if (!booted || userLoading) {
    return (
      <div className="flex min-h-screen flex-col">
        <SiteHeader />
        <main className="flex flex-1 items-center justify-center px-4 py-12">
          <div className="mx-auto w-full max-w-6xl">
            {/* hero skeleton */}
            <div className="grid items-center gap-10 md:grid-cols-2">
              <div className="space-y-4">
                <div className="skeleton skeleton-text w-40" />
                <div className="skeleton h-10 w-full max-w-md" />
                <div className="skeleton skeleton-text w-3/4" />
                <div className="skeleton skeleton-text w-1/2" />
                <div className="flex gap-3">
                  <div className="skeleton h-14 w-44 rounded-2xl" />
                  <div className="skeleton h-14 w-32 rounded-2xl" />
                </div>
              </div>
              <div className="hidden md:block">
                <div className="skeleton h-64 w-full max-w-md rounded-[2rem]" />
              </div>
            </div>
            {/* menu skeleton grid */}
            <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton skeleton-block h-72 w-full rounded-2xl" />
              ))}
            </div>
            <div className="mt-6 flex items-center justify-center gap-2 text-sm font-bold text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              در حال آماده‌سازی رستوران نخل...
            </div>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main-content" className="skip-link">
        پرش به محتوای اصلی
      </a>
      <SiteHeader />
      <main id="main-content" className="flex-1 pb-16 sm:pb-0">
        <div key={view} className="animate-view-in">
          {view === "home" && <HomeView />}
          {view === "chat" && (
            <div className="-mb-16 pt-3 sm:mb-0 sm:pt-4">
              <ChatView />
            </div>
          )}
          {view === "orders" && <OrdersView />}
          {view === "profile" && <ProfileView />}
          {view === "cart" && <CartView />}
          {view === "track" && <TrackView />}
        </div>
      </main>
      <SiteFooter />

      {/* overlays — dedicated full-screen login page replaces the old floating modal */}
      {authOpen && <AuthPage />}
      {paymentSimulation && <SimulatedGateway />}
      <PaymentResultBanner />
      <BackToTop />
      <PwaManager />
      <MobileBottomNav />

      {/* hidden SEO-friendly content for menu */}
      {menuLoading === false && menu.length > 0 && view === "home" && (
        <div className="sr-only" aria-hidden>
          منوی رستوران نخل رفسنجان: {menu.map((c) => c.items.map((i) => i.name).join("، ")).join("، ")}
        </div>
      )}
    </div>
  );
}
