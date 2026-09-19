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

/** ارسال همین حالا یا زمان‌بندی برای بعد (پیش‌سفارش) */
export type CartScheduleMode = "ASAP" | "SCHEDULED";

interface CartState {
  items: CartItem[];
  deliveryMethod: CartDeliveryMethod;
  address: string;
  couponCode: string;
  scheduleMode: CartScheduleMode;
  /** ISO زمان تحویل پیش‌سفارش — فقط وقتی scheduleMode === "SCHEDULED" معتبر است */
  scheduledFor: string | null;
  addItem: (item: Omit<CartItem, "quantity">, quantity?: number) => void;
  incrementItem: (itemId: string) => void;
  decrementItem: (itemId: string) => void;
  removeItem: (itemId: string) => void;
  removeItems: (itemIds: string[]) => void;
  setDeliveryMethod: (method: CartDeliveryMethod) => void;
  setAddress: (address: string) => void;
  setCouponCode: (code: string) => void;
  setScheduleMode: (mode: CartScheduleMode) => void;
  setScheduledFor: (iso: string | null) => void;
  clearCart: () => void;
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
      scheduleMode: "ASAP",
      scheduledFor: null,

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

      // حالت ارسال: همین حالا / زمان‌بندی — در حالت ASAP زمان قبلی بی‌اعتبار می‌شود
      setScheduleMode: (scheduleMode) =>
        set(scheduleMode === "SCHEDULED" ? { scheduleMode } : { scheduleMode, scheduledFor: null }),

      setScheduledFor: (scheduledFor) =>
        set(scheduledFor ? { scheduledFor, scheduleMode: "SCHEDULED" } : { scheduledFor: null }),

      // after a successful order: clear items + coupon + schedule; keep address/delivery as convenience
      clearCart: () => set({ items: [], couponCode: "", scheduleMode: "ASAP", scheduledFor: null }),
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
