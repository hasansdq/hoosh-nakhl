"use client";

import { useEffect, useState } from "react";
import { WifiOff, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Registers the service worker for offline menu browsing,
 * shows an offline banner when the network drops, and surfaces
 * a PWA install prompt when the browser fires beforeinstallprompt.
 */
/** Browser beforeinstallprompt event (not part of the DOM lib types). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export function PwaManager() {
  const [offline, setOffline] = useState(false);
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installDismissed, setInstallDismissed] = useState(false);

  // register the service worker
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* silent — dev quirks shouldn't break UX */
      });
    }
  }, []);

  // online/offline state
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // PWA install prompt
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const doInstall = async () => {
    if (!installEvt) return;
    installEvt.prompt();
    const { outcome } = await installEvt.userChoice;
    if (outcome === "accepted") {
      // browser will close the prompt; we hide our banner too
    }
    setInstallEvt(null);
  };

  return (
    <>
      {offline && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 bottom-0 z-[60] mx-auto flex max-w-md items-center gap-2.5 rounded-t-2xl border-t border-amber-500/30 bg-amber-500/95 px-4 py-3 text-amber-950 shadow-2xl"
        >
          <WifiOff className="h-5 w-5 shrink-0" />
          <div className="flex-1 text-xs font-bold leading-5">
            اتصال اینترنت قطع است — همچنان می‌توانید منو را ببینید، اما ثبت سفارش نیاز به اتصال دارد.
          </div>
        </div>
      )}
      {installEvt && !installDismissed && (
        <div
          className="fixed bottom-4 right-4 z-[55] flex max-w-xs items-center gap-2 rounded-2xl border bg-card/95 p-3 shadow-2xl backdrop-blur"
          style={{ animation: "nakhl-install-slide 0.4s ease-out" }}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Download className="h-4.5 w-4.5" />
          </span>
          <div className="flex-1 leading-tight">
            <div className="text-xs font-extrabold">نصب اپلیکیشن نخل 🌴</div>
            <div className="text-[10px] text-muted-foreground">دسترسی سریع از صفحه اصلی</div>
          </div>
          <Button size="sm" onClick={doInstall} className="h-8 rounded-lg px-3 text-xs font-bold">
            نصب
          </Button>
          <button
            onClick={() => setInstallDismissed(true)}
            className="rounded-lg p-1 text-muted-foreground hover:bg-accent"
            aria-label="بستن"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <style>{`@keyframes nakhl-install-slide { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
        </div>
      )}
    </>
  );
}
