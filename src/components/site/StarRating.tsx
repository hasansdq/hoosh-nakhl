"use client";

import { Star } from "lucide-react";
import { toPersianDigits } from "@/lib/fa";

/**
 * Star rating display (نمایش امتیاز با ستاره)
 * — filled stars in date-gold, empty in muted, Persian digits for value/count.
 */
export function StarRating({
  rating,
  count,
  size = 14,
  showCount = true,
}: {
  rating: number | null;
  count?: number;
  size?: number;
  showCount?: boolean;
}) {
  if (rating == null) return null;

  const clamped = Math.min(5, Math.max(0, rating));
  const rounded = Math.round(clamped);
  const valueText = toPersianDigits(clamped.toFixed(1)).replace(".", "٫");

  return (
    <div className="flex items-center gap-1.5" title={`امتیاز ${valueText} از ۵`}>
      <div className="flex items-center gap-0.5" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            style={{ width: size, height: size }}
            className={i <= rounded ? "fill-gold text-gold" : "text-muted-foreground/30"}
          />
        ))}
      </div>
      <span className="text-[11px] font-black text-gold-foreground">{valueText}</span>
      {showCount && count != null && count > 0 && (
        <span className="text-[10px] text-muted-foreground">({toPersianDigits(count)})</span>
      )}
      <span className="sr-only">امتیاز {valueText} از ۵{count ? ` بر اساس ${toPersianDigits(count)} نظر` : ""}</span>
    </div>
  );
}
