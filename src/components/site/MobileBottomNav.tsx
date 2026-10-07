"use client";

import { useAppStore } from "@/lib/store";
import { useCartStore } from "@/lib/cart-store";
import { Home, Bot, ShoppingCart, Package, User } from "lucide-react";
import { toPersianDigits } from "@/lib/fa";

/**
 * Mobile sticky bottom navigation — visible only on small screens (≤ sm).
 * Five tabs: Home / Cart / Chat (FAB) / Orders / Profile.
 * Mirrors the desktop nav from Header.tsx but optimized for thumb reach.
 * Footer-safe-area aware (iOS notch). Hidden during print.
 */
export function MobileBottomNav() {
  const { view, user, setView, setAuthOpen } = useAppStore();
  const cartCount = useCartStore((s) =>
    s.items.reduce((sum, it) => sum + it.quantity, 0)
  );

  const go = (v: "home" | "chat" | "cart" | "track" | "orders" | "profile") => {
    if ((v === "chat" || v === "orders" || v === "profile") && !user) {
      setAuthOpen(true, v);
      return;
    }
    setView(v);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const isActive = (v: string) => view === v;

  return (
    <nav
      className="mobile-bottom-nav sm:hidden"
      aria-label="ناوبری موبایل"
      role="navigation"
    >
      <button
        type="button"
        onClick={() => go("home")}
        aria-current={isActive("home") ? "page" : undefined}
        aria-label="خانه"
      >
        <Home className="h-5 w-5" />
        <span>خانه</span>
      </button>

      <button
        type="button"
        onClick={() => go("cart")}
        aria-current={isActive("cart") ? "page" : undefined}
        aria-label={`سبد خرید${cartCount > 0 ? ` — ${toPersianDigits(cartCount)} قلم` : ""}`}
        className="relative"
      >
        <div className="relative">
          <ShoppingCart className="h-5 w-5" />
          {cartCount > 0 && (
            <span
              key={cartCount} // re-mount on count change to retrigger pop animation
              className="animate-badge-pop absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[9px] font-black text-white shadow"
            >
              {toPersianDigits(cartCount)}
            </span>
          )}
        </div>
        <span>سبد</span>
      </button>

      <button
        type="button"
        onClick={() => go("chat")}
        aria-current={isActive("chat") ? "page" : undefined}
        aria-label="گفتگو با هوش نخل"
        className="nav-fab"
      >
        <span className="nav-fab-inner" aria-hidden>
          <Bot className="h-6 w-6" />
        </span>
        <span className="nav-fab-label">هوش نخل</span>
      </button>

      <button
        type="button"
        onClick={() => go("orders")}
        aria-current={isActive("orders") ? "page" : undefined}
        aria-label="سفارش‌های من"
      >
        <Package className="h-5 w-5" />
        <span>سفارش‌ها</span>
      </button>

      <button
        type="button"
        onClick={() => go("profile")}
        aria-current={isActive("profile") ? "page" : undefined}
        aria-label="پروفایل من"
      >
        <User className="h-5 w-5" />
        <span>پروفایل</span>
      </button>
    </nav>
  );
}
