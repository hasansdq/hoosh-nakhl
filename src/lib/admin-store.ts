"use client";

import { create } from "zustand";
import { api } from "@/lib/client-api";

export interface AdminInfo {
  username: string;
  displayName: string;
  lastLoginAt: string | null;
}

export type AdminTab =
  | "dashboard"
  | "analytics"
  | "menu"
  | "content"
  | "orders"
  | "users"
  | "coupons"
  | "reviews"
  | "settings"
  | "uploads"
  | "audit";

interface AdminState {
  admin: AdminInfo | null;
  checked: boolean;
  tab: AdminTab;
  setTab: (tab: AdminTab) => void;
  setAdmin: (admin: AdminInfo | null) => void;
  checkAuth: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAdminStore = create<AdminState>((set) => ({
  admin: null,
  checked: false,
  tab: "dashboard",
  setTab: (tab) => set({ tab }),
  setAdmin: (admin) => set({ admin }),
  checkAuth: async () => {
    const res = await api<{ admin: AdminInfo }>("/api/admin/me");
    set({ admin: res.success ? res.admin : null, checked: true });
  },
  logout: async () => {
    await api("/api/admin/logout", { method: "POST" });
    set({ admin: null });
  },
}));
