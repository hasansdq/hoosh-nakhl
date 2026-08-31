"use client";

import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { formatToman, toPersianDigits } from "@/lib/fa";
import { Flame, Clock, Star } from "lucide-react";

export interface MenuPayloadItem {
  id: string;
  name: string;
  price: number;
  description?: string | null;
  imageUrl?: string | null;
  isAvailable: boolean;
  isSpecial: boolean;
  calories?: number | null;
  prepTime?: number | null;
}

export interface MenuPayload {
  title: string;
  categories: {
    id: string;
    name: string;
    items: MenuPayloadItem[];
  }[];
}

export function MenuCards({ payload }: { payload: MenuPayload }) {
  return (
    <div className="w-full max-w-2xl">
      <div className="mb-3 flex items-center gap-2 rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 px-4 py-3">
        <span className="text-xl">🌴</span>
        <div>
          <div className="text-sm font-extrabold">{payload.title}</div>
          <div className="text-[11px] text-muted-foreground">
            برای سفارش، اسم غذا و تعداد رو در همین چت بنویسید (مثلاً: «۲ کباب کوبیده و ۱ دوغ»)
          </div>
        </div>
      </div>

      <div className="space-y-5">
        {payload.categories.map((cat) => (
          <div key={cat.id}>
            <div className="mb-2 flex items-center gap-2">
              <h4 className="text-sm font-extrabold text-primary">{cat.name}</h4>
              <span className="h-px flex-1 bg-gradient-to-l from-primary/30 to-transparent" />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {cat.items.map((item) => (
                <div
                  key={item.id}
                  className={`group relative overflow-hidden rounded-2xl border bg-card p-2.5 transition-all hover:border-primary/40 hover:shadow-md ${
                    !item.isAvailable ? "opacity-55 saturate-50" : ""
                  }`}
                >
                  <div className="flex gap-3">
                    {item.imageUrl ? (
                      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl">
                        <Image
                          src={item.imageUrl}
                          alt={item.name}
                          fill
                          sizes="64px"
                          className="object-cover transition duration-300 group-hover:scale-105"
                        />
                      </div>
                    ) : (
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-2xl" aria-hidden>
                        {item.isSpecial ? "⭐" : "🍽"}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-bold">{item.name}</span>
                        {item.isSpecial && (
                          <Badge variant="secondary" className="h-5 shrink-0 gap-0.5 bg-gold/15 px-1.5 text-[10px] text-gold-foreground">
                            <Star className="h-3 w-3 text-gold" />
                            ویژه
                          </Badge>
                        )}
                      </div>
                      {item.description && (
                        <p className="mt-0.5 line-clamp-1 text-[11px] leading-5 text-muted-foreground">
                          {item.description}
                        </p>
                      )}
                      <div className="mt-1 flex items-center justify-between gap-1">
                        <span className="text-xs font-extrabold text-primary">{formatToman(item.price)}</span>
                        <span className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          {item.prepTime != null && (
                            <span className="flex items-center gap-0.5">
                              <Clock className="h-3 w-3" />
                              {toPersianDigits(item.prepTime)}′
                            </span>
                          )}
                          {item.calories != null && (
                            <span className="flex items-center gap-0.5">
                              <Flame className="h-3 w-3" />
                              {toPersianDigits(item.calories)}
                            </span>
                          )}
                          {!item.isAvailable && <span className="font-bold text-destructive">ناموجود</span>}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
