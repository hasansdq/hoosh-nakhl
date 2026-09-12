"use client";

import { create } from "zustand";
import { toast } from "sonner";
import { api } from "@/lib/client-api";

export type ViewName = "home" | "chat" | "cart" | "orders" | "track" | "profile";

export interface AppUser {
  id: string;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  nationalId: string | null;
  email: string | null;
  birthDate: string | null;
  gender: string | null;
  avatarUrl: string | null;
  dietaryPrefs: DietaryPrefs | null;
  createdAt: string;
}

export interface DietaryPrefs {
  vegetarian: boolean;
  avoidSpicy: boolean;
  allergies: string;
  dislikes: string;
}

export const EMPTY_DIETARY_PREFS: DietaryPrefs = {
  vegetarian: false,
  avoidSpicy: false,
  allergies: "",
  dislikes: "",
};

export interface MenuItemPublic {
  id: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  gallery?: string[];
  isAvailable: boolean;
  isSpecial: boolean;
  isDrink: boolean;
  isVegetarian?: boolean;
  isSpicy?: boolean;
  ingredients?: string | null;
  orderCount?: number;
  calories: number | null;
  prepTime: number | null;
  rating?: number | null;
  ratingCount?: number;
}

export interface MenuCategoryPublic {
  id: string;
  name: string;
  slug: string;
  items: MenuItemPublic[];
}

/** CMS-managed site info (editable at /nk-admin → تنظیمات → عمومی) */
export interface SiteSettings {
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
}

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  restaurantName: "رستوران نخل",
  restaurantTagline: "طعم اصیل رفسنجان، با نوآوری هوش مصنوعی",
  address: "رفسنجان، بلوار شهید مطهری، نبش کوچه نخل، پلاک ۱۲",
  phone: "03434300000",
  email: "",
  workingHours: "همه روزه از ساعت ۱۲ ظهر تا ۱۲ شب",
  city: "رفسنجان",
  instagram: "nakhl.rafsanjan",
  telegram: "nakhl_restaurant",
  aboutText:
    "رستوران نخل رفسنجان با بیش از یک دهه تجربه در ارائه غذاهای اصیل ایرانی، اکنون با هوش مصنوعی «هوش نخل» تجربه سفارش‌دهی جدیدی را به شما هدیه می‌دهد. مثل حضوری سفارش بدهید، اما از هر جای شهر!",
  taxPercent: 10,
  deliveryFee: 35000,
  minOrderAmount: 100000,
  freeDeliveryOver: 500000,
};

interface PaymentSimulation {
  authority: string;
  orderNumber: string;
  total: number;
}

/** A favorite record as returned by /api/favorites (menuItem already flattened) */
export interface FavoriteItem {
  id: string;
  menuItemId: string;
  menuItem: MenuItemPublic;
}

interface PaymentResult {
  status: "success" | "failed";
  orderNumber?: string;
  ref?: string;
  reason?: string;
}

interface AppState {
  user: AppUser | null;
  userLoading: boolean;
  view: ViewName;
  authOpen: boolean;
  /** view to land on after a successful login (defaults to "chat") */
  authIntent: ViewName;
  menu: MenuCategoryPublic[];
  menuLoading: boolean;
  siteSettings: SiteSettings;
  /** CMS content map (defaults + admin overrides) from /api/site-content */
  siteContent: Record<string, string>;
  paymentSimulation: PaymentSimulation | null;
  paymentResult: PaymentResult | null;
  chatRefreshKey: number;

  // favorites (server-synced; only meaningful when logged in)
  favorites: FavoriteItem[];
  favoriteIds: string[];
  favoritesLoading: boolean;

  // recently viewed (localStorage-only; always available)
  recentlyViewed: string[];
  recentlyViewedHydrated: boolean;

  setUser: (user: AppUser | null) => void;
  setUserLoading: (v: boolean) => void;
  setView: (view: ViewName) => void;
  setAuthOpen: (open: boolean, intent?: ViewName) => void;
  setMenu: (menu: MenuCategoryPublic[]) => void;
  setMenuLoading: (v: boolean) => void;
  setSiteSettings: (s: SiteSettings) => void;
  refreshSiteSettings: () => Promise<void>;
  refreshSiteContent: () => Promise<void>;
  setSiteContent: (c: Record<string, string>) => void;
  setPaymentSimulation: (p: PaymentSimulation | null) => void;
  setPaymentResult: (r: PaymentResult | null) => void;
  bumpChat: () => void;
  refreshUser: () => Promise<void>;

  // favorites API
  refreshFavorites: () => Promise<void>;
  isFavorite: (menuItemId: string) => boolean;
  toggleFavorite: (menuItemId: string) => Promise<boolean>;

  // recently viewed API
  hydrateRecentlyViewed: () => void;
  recordRecentlyViewed: (menuItemId: string) => void;
}

const RECENTLY_VIEWED_KEY = "nakhl-recently-viewed";
const RECENTLY_VIEWED_MAX = 12;

function readRecentlyViewed(): string[] {
  try {
    const raw = localStorage.getItem(RECENTLY_VIEWED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string").slice(0, RECENTLY_VIEWED_MAX);
  } catch {
    return [];
  }
}

function writeRecentlyViewed(items: string[]) {
  try {
    localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(items.slice(0, RECENTLY_VIEWED_MAX)));
  } catch {
    /* localStorage may be unavailable (private mode) — silently ignore */
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  userLoading: true,
  view: "home",
  authOpen: false,
  authIntent: "chat",
  menu: [],
  menuLoading: true,
  siteSettings: DEFAULT_SITE_SETTINGS,
  siteContent: {},
  paymentSimulation: null,
  paymentResult: null,
  chatRefreshKey: 0,

  favorites: [],
  favoriteIds: [],
  favoritesLoading: false,

  recentlyViewed: [],
  recentlyViewedHydrated: false,

  setUser: (user) => set({ user }),
  setUserLoading: (userLoading) => set({ userLoading }),
  setView: (view) => set({ view }),
  setAuthOpen: (authOpen, intent) =>
    set(authOpen ? { authOpen, authIntent: intent ?? "chat" } : { authOpen, authIntent: "chat" }),
  setMenu: (menu) => set({ menu }),
  setMenuLoading: (menuLoading) => set({ menuLoading }),
  setSiteSettings: (siteSettings) => set({ siteSettings }),
  setSiteContent: (siteContent) => set({ siteContent }),
  refreshSiteContent: async () => {
    try {
      const res = await api<{ content: Record<string, string> }>("/api/site-content");
      if (res.success && res.content && typeof res.content === "object") {
        set({ siteContent: res.content });
      }
    } catch {
      /* registry defaults apply on failure (useContent falls back per-key) */
    }
  },
  refreshSiteSettings: async () => {
    try {
      const res = await api<{ settings: SiteSettings }>("/api/settings");
      if (res.success && res.settings) set({ siteSettings: { ...DEFAULT_SITE_SETTINGS, ...res.settings } });
    } catch {
      /* keep defaults on failure */
    }
  },
  setPaymentSimulation: (paymentSimulation) => set({ paymentSimulation }),
  setPaymentResult: (paymentResult) => set({ paymentResult }),
  bumpChat: () => set({ chatRefreshKey: get().chatRefreshKey + 1 }),

  refreshUser: async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = await res.json();
      if (data.success) {
        set({ user: data.user, userLoading: false });
        // pull favorites on successful auth (fire-and-forget)
        void get().refreshFavorites();
      } else {
        set({ user: null, userLoading: false, favorites: [], favoriteIds: [] });
      }
    } catch {
      set({ userLoading: false });
    }
  },

  refreshFavorites: async () => {
    const { user } = get();
    if (!user) {
      set({ favorites: [], favoriteIds: [] });
      return;
    }
    set({ favoritesLoading: true });
    try {
      const res = await api<{ favorites: FavoriteItem[] }>("/api/favorites");
      if (res.success && Array.isArray(res.favorites)) {
        set({
          favorites: res.favorites,
          favoriteIds: res.favorites.map((f) => f.menuItemId),
          favoritesLoading: false,
        });
      } else {
        set({ favoritesLoading: false });
      }
    } catch {
      set({ favoritesLoading: false });
    }
  },

  isFavorite: (menuItemId) => get().favoriteIds.includes(menuItemId),

  toggleFavorite: async (menuItemId) => {
    const { user, setAuthOpen, favorites, favoriteIds } = get();
    if (!user) {
      setAuthOpen(true, "home");
      toast.info("برای ذخیره علاقه‌مندی‌ها وارد شوید");
      return false;
    }

    const existing = favorites.find((f) => f.menuItemId === menuItemId);
    const isCurrentlyFav = favoriteIds.includes(menuItemId);

    // optimistic update
    if (isCurrentlyFav && existing) {
      set({
        favorites: favorites.filter((f) => f.menuItemId !== menuItemId),
        favoriteIds: favoriteIds.filter((id) => id !== menuItemId),
      });
    } else {
      // optimistic add: we don't have full menuItem here, so push a placeholder; refreshFavorites will reconcile
      set({
        favoriteIds: [...favoriteIds, menuItemId],
      });
    }

    try {
      if (existing) {
        const res = await api(`/api/favorites/${existing.id}`, { method: "DELETE" });
        if (!res.success) {
          set({ favorites, favoriteIds });
          toast.error("خطا در حذف علاقه‌مندی");
          return false;
        }
        toast.success("از علاقه‌مندی‌ها حذف شد");
        return true;
      } else {
        const res = await api<{ favorite: FavoriteItem }>("/api/favorites", {
          body: { menuItemId },
        });
        if (res.success && res.favorite) {
          // reconcile with the canonical record returned by the server
          set((s) => ({
            favorites: [res.favorite, ...s.favorites.filter((f) => f.menuItemId !== menuItemId)],
            favoriteIds: s.favoriteIds.includes(menuItemId)
              ? s.favoriteIds
              : [...s.favoriteIds, menuItemId],
          }));
          toast.success("به علاقه‌مندی‌ها اضافه شد ❤️");
          return true;
        }
        set({ favorites, favoriteIds });
        toast.error("خطا در افزودن علاقه‌مندی");
        return false;
      }
    } catch {
      set({ favorites, favoriteIds });
      toast.error("خطا در به‌روزرسانی علاقه‌مندی‌ها");
      return false;
    }
  },

  hydrateRecentlyViewed: () => {
    if (get().recentlyViewedHydrated) return;
    const items = readRecentlyViewed();
    set({ recentlyViewed: items, recentlyViewedHydrated: true });
  },

  recordRecentlyViewed: (menuItemId) => {
    if (!menuItemId) return;
    const current = get().recentlyViewed;
    const next = [menuItemId, ...current.filter((id) => id !== menuItemId)].slice(
      0,
      RECENTLY_VIEWED_MAX
    );
    set({ recentlyViewed: next, recentlyViewedHydrated: true });
    writeRecentlyViewed(next);
  },
}));
