"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useEffect, useState } from "react";

// ============ سبد خرید کلاسیک — Classic shopping cart (parallel to AI-chat ordering) ============

export interface CartItem {
  itemId: string;
  name: string;
  price: number;
  imageUrl: string | null;
  quantity: number;
}

export type CartDeliveryMethod = "DELIVERY" | "PICKUP";

/** قلم سبد که از «هوش نخل» آینه شده — itemId مرجع تطبیق است */
export interface ChatDraftItem {
  itemId: string;
  name: string;
  price: number;
  imageUrl?: string | null;
  quantity: number;
}

interface CartState {
  items: CartItem[];
  deliveryMethod: CartDeliveryMethod;
  address: string;
  couponCode: string;
  /** آیتم‌هایی که هم‌اکنون از درفت هوش نخل آینه شده‌اند (برای حذف/به‌روزرسانی دقیق) */
  chatItemIds: string[];
  addItem: (item: Omit<CartItem, "quantity">, quantity?: number) => void;
  incrementItem: (itemId: string) => void;
  decrementItem: (itemId: string) => void;
  removeItem: (itemId: string) => void;
  removeItems: (itemIds: string[]) => void;
  setDeliveryMethod: (method: CartDeliveryMethod) => void;
  setAddress: (address: string) => void;
  setCouponCode: (code: string) => void;
  clearCart: () => void;
  /** آینه‌سازی درفت هوش نخل در سبد اصلی سایت — اقلام قبلاً آینه‌شده که از درفت خارج شده‌اند حذف و اقلام تازه با تعداد authoritative سرور upsert می‌شوند */
  syncChatDraft: (
    items: ChatDraftItem[],
    opts?: { deliveryMethod?: CartDeliveryMethod; address?: string; couponCode?: string }
  ) => void;
  /** حذف همهٔ اقلام آینه‌شده از سبد (پس از پرداخت/رهاکردن درگاه) بدون دست‌زدن به اقلام دستی کاربر */
  clearChatItems: () => void;
}

const MAX_QTY_PER_ITEM = 30;
const MAX_TOTAL_ITEMS = 30; // mirrors engine maxItemsPerOrder default

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      deliveryMethod: "DELIVERY",
      address: "",
      couponCode: "",
      chatItemIds: [],

      addItem: (item, quantity = 1) =>
        set((state) => {
          const qty = Math.max(1, Math.min(MAX_QTY_PER_ITEM, quantity));
          const existing = state.items.find((i) => i.itemId === item.itemId);
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.itemId === item.itemId
                  ? { ...i, quantity: Math.min(MAX_QTY_PER_ITEM, i.quantity + qty), price: item.price, imageUrl: item.imageUrl }
                  : i
              ),
            };
          }
          const totalQty = state.items.reduce((s, i) => s + i.quantity, 0);
          if (totalQty >= MAX_TOTAL_ITEMS) return state;
          return { items: [...state.items, { ...item, quantity: qty }] };
        }),

      incrementItem: (itemId) =>
        set((state) => ({
          items: state.items.map((i) =>
            i.itemId === itemId ? { ...i, quantity: Math.min(MAX_QTY_PER_ITEM, i.quantity + 1) } : i
          ),
        })),

      decrementItem: (itemId) =>
        set((state) => ({
          items: state.items.map((i) =>
            i.itemId === itemId ? { ...i, quantity: Math.max(1, i.quantity - 1) } : i
          ),
        })),

      removeItem: (itemId) => set((state) => ({ items: state.items.filter((i) => i.itemId !== itemId) })),

      removeItems: (itemIds) =>
        set((state) => ({ items: state.items.filter((i) => !itemIds.includes(i.itemId)) })),

      setDeliveryMethod: (deliveryMethod) => set({ deliveryMethod }),

      setAddress: (address) => set({ address: address.slice(0, 500) }),

      setCouponCode: (couponCode) => set({ couponCode: couponCode.trim().slice(0, 24) }),

      // after a successful order: clear items + coupon; keep address/delivery as convenience
      clearCart: () => set({ items: [], couponCode: "", chatItemIds: [] }),

      // ---- AI-chat mirror: the classic cart always reflects the active chat draft ----
      // Quantities are authoritative from the server draft; rows the user added
      // manually are untouched (except same-item collisions, where the draft wins).
      syncChatDraft: (draftItems, opts) =>
        set((state) => {
          if (draftItems.length === 0) {
            // empty draft → drop everything that was mirrored, keep manual rows
            return {
              items: state.items.filter((i) => !state.chatItemIds.includes(i.itemId)),
              chatItemIds: [],
            };
          }
          const draftIds = new Set(draftItems.map((d) => d.itemId));
          // previously-mirrored rows that left the draft are removed
          const kept = state.items.filter(
            (i) => !state.chatItemIds.includes(i.itemId) || draftIds.has(i.itemId)
          );
          const byId = new Map(kept.map((i) => [i.itemId, { ...i }]));
          for (const d of draftItems) {
            const existing = byId.get(d.itemId);
            byId.set(d.itemId, {
              itemId: d.itemId,
              name: d.name,
              price: d.price,
              // preserve a real image when the row already exists (draft payload has none)
              imageUrl: d.imageUrl ?? existing?.imageUrl ?? null,
              quantity: Math.max(1, Math.min(MAX_QTY_PER_ITEM, d.quantity)),
            });
          }
          return {
            items: [...byId.values()],
            chatItemIds: [...draftIds],
            ...(opts?.deliveryMethod === "DELIVERY" || opts?.deliveryMethod === "PICKUP"
              ? { deliveryMethod: opts.deliveryMethod }
              : {}),
            ...(opts?.address && opts.address.trim().length >= 10 ? { address: opts.address.trim().slice(0, 500) } : {}),
            // only adopt a chat coupon — never wipe one the user typed in the cart
            ...(opts?.couponCode ? { couponCode: opts.couponCode.trim().slice(0, 24) } : {}),
          };
        }),

      clearChatItems: () =>
        set((state) => ({
          items: state.items.filter((i) => !state.chatItemIds.includes(i.itemId)),
          chatItemIds: [],
        })),
    }),
    {
      name: "nakhl-cart",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true, // SSR-safe: rehydrated on the client after mount (see useCartHydrated)
    }
  )
);

// ============ derived helpers (pure functions over items) ============

export function cartTotalCount(items: CartItem[]): number {
  return items.reduce((s, i) => s + i.quantity, 0);
}

export function cartSubtotal(items: CartItem[]): number {
  return items.reduce((s, i) => s + i.price * i.quantity, 0);
}

// ============ SSR-safe hydration hook ============
// Renders must match the server output (empty cart) on first client render,
// so we rehydrate from localStorage only after mount and flag readiness.

export function useCartHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const unsub = useCartStore.persist.onFinishHydration(() => setHydrated(true));
    void useCartStore.persist.rehydrate();
    return unsub;
  }, []);
  return hydrated;
}
