"use client";

import type { ComponentType } from "react";
import {
  Utensils,
  UtensilsCrossed,
  ChefHat,
  Beef,
  Drumstick,
  Fish,
  Shrimp,
  Salad,
  Soup,
  CookingPot,
  Wheat,
  Croissant,
  Sandwich,
  Pizza,
  Cookie,
  CakeSlice,
  IceCreamCone,
  IceCreamBowl,
  CupSoda,
  GlassWater,
  Coffee,
  Martini,
  Wine,
  Milk,
  Candy,
  Dessert,
  Apple,
  Carrot,
  Egg,
  Citrus,
  Grape,
  Cherry,
  Banana,
  Ham,
  Flame,
  Leaf,
  MapPin,
  Sparkles,
  Star,
  Heart,
} from "lucide-react";

/**
 * رجیستری آیکون دسته‌بندی‌ها — کلیدها در Category.icon (دیتابیس) ذخیره می‌شوند.
 * هم در پنل مدیریت (انتخاب آیکون) و هم در سایت عمومی (تب دسته‌ها) استفاده می‌شود.
 */
export const CATEGORY_ICONS: Record<string, { label: string; Icon: ComponentType<{ className?: string }> }> = {
  utensils: { label: "قاشق و چنگال", Icon: Utensils },
  "utensils-crossed": { label: "سفارش غذا", Icon: UtensilsCrossed },
  "chef-hat": { label: "سرآشپز", Icon: ChefHat },
  beef: { label: "گوشت", Icon: Beef },
  drumstick: { label: "مرغ", Icon: Drumstick },
  fish: { label: "ماهی", Icon: Fish },
  shrimp: { label: "میگوی", Icon: Shrimp },
  salad: { label: "سالاد", Icon: Salad },
  soup: { label: "سوپ", Icon: Soup },
  "cooking-pot": { label: "خورشت", Icon: CookingPot },
  wheat: { label: "غلات", Icon: Wheat },
  croissant: { label: "شیرینی", Icon: Croissant },
  sandwich: { label: "ساندویچ", Icon: Sandwich },
  pizza: { label: "پیتزا", Icon: Pizza },
  cookie: { label: "کلوچه", Icon: Cookie },
  "cake-slice": { label: "کیک", Icon: CakeSlice },
  "ice-cream-cone": { label: "بستنی قیفی", Icon: IceCreamCone },
  "ice-cream": { label: "بستنی (قدیمی)", Icon: IceCreamCone }, // کلید seed — سازگاری با داده‌های موجود
  "ice-cream-bowl": { label: "بستنی", Icon: IceCreamBowl },
  "cup-soda": { label: "نوشابه", Icon: CupSoda },
  "glass-water": { label: "آب و نوشیدنی", Icon: GlassWater },
  coffee: { label: "قهوه", Icon: Coffee },
  martini: { label: "کوکتیل", Icon: Martini },
  wine: { label: "شراب", Icon: Wine },
  milk: { label: "لبنیات", Icon: Milk },
  candy: { label: "شیرینی و شکلات", Icon: Candy },
  dessert: { label: "دسر", Icon: Dessert },
  apple: { label: "سیب", Icon: Apple },
  carrot: { label: "سبزیجات", Icon: Carrot },
  egg: { label: "تخم‌مرغ", Icon: Egg },
  citrus: { label: "مرکبات", Icon: Citrus },
  grape: { label: "انگور", Icon: Grape },
  cherry: { label: "گیلاس", Icon: Cherry },
  banana: { label: "موز", Icon: Banana },
  ham: { label: "کالباس", Icon: Ham },
  "map-pin": { label: "محلی و منطقه‌ای", Icon: MapPin },
  flame: { label: "گریل و کباب", Icon: Flame },
  leaf: { label: "گیاهی", Icon: Leaf },
  sparkles: { label: "ویژه", Icon: Sparkles },
  star: { label: "ستاره", Icon: Star },
  heart: { label: "محبوب", Icon: Heart },
};

export function isCategoryIconKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(CATEGORY_ICONS, key);
}

/** رندر آیکون دسته — اگر کلید نامعتبر/خالی باشد null برمی‌گرداند (گرایسنت). */
export function CategoryIcon({ icon, className }: { icon?: string | null; className?: string }) {
  const entry = icon ? CATEGORY_ICONS[icon] : null;
  if (!entry) return null;
  return <entry.Icon className={className} aria-hidden />;
}
