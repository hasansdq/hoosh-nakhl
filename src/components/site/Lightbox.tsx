"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { toPersianDigits } from "@/lib/fa";

/**
 * Lightbox — modal gallery viewer for menu items.
 * RTL-aware: next/prev buttons labeled «بعدی»/«قبلی» with ChevronRight/ChevronLeft
 * (since RTL flips the visual direction: «بعدی» = next index → ChevronRight icon,
 *  «قبلی» = previous index → ChevronLeft icon — natural for Persian readers).
 * Keyboard: ArrowRight = next, ArrowLeft = prev (RTL), Escape = close.
 * Focus trap inside the dialog. Click outside image closes.
 * All visual styles are inline via a <style> tag scoped to .nakhl-lightbox-*.
 */
export function Lightbox({
  images,
  initialIndex = 0,
  onClose,
}: {
  images: string[];
  initialIndex?: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const goNext = useCallback(() => {
    setIndex((i) => (i + 1) % images.length);
  }, [images.length]);

  const goPrev = useCallback(() => {
    setIndex((i) => (i - 1 + images.length) % images.length);
  }, [images.length]);

  // keyboard + focus trap
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowRight") {
        // RTL: right arrow = next
        e.preventDefault();
        goNext();
        return;
      }
      if (e.key === "ArrowLeft") {
        // RTL: left arrow = prev
        e.preventDefault();
        goPrev();
        return;
      }
      if (e.key === "Tab" && overlayRef.current) {
        // simple focus trap: cycle among interactive elements
        const focusables = overlayRef.current.querySelectorAll<HTMLElement>(
          'button, [href], [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handler);
    // lock scroll
    document.body.style.overflow = "hidden";
    // focus close button when opened
    const t = window.setTimeout(() => closeBtnRef.current?.focus(), 50);
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
      window.clearTimeout(t);
    };
  }, [goNext, goPrev, onClose]);

  // body when no images (defensive)
  if (!images || images.length === 0) return null;

  const current = images[index];
  const hasMultiple = images.length > 1;

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="گالری تصاویر غذا"
      dir="rtl"
      className="nakhl-lightbox-overlay"
      onClick={(e) => {
        // click on backdrop closes (not on image/buttons)
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <style>{`
        .nakhl-lightbox-overlay {
          position: fixed;
          inset: 0;
          z-index: 60;
          background: rgb(0 0 0 / 0.92);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 1rem;
          animation: nakhl-lightbox-fade 0.18s ease-out;
        }
        @keyframes nakhl-lightbox-fade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes nakhl-lightbox-img-in {
          from { opacity: 0; transform: scale(0.985); }
          to { opacity: 1; transform: scale(1); }
        }
        .nakhl-lightbox-img-wrap {
          position: relative;
          width: min(92vw, 56rem);
          height: min(60vh, 40rem);
          animation: nakhl-lightbox-img-in 0.25s ease-out;
        }
        .nakhl-lightbox-img-wrap > img {
          object-fit: contain;
          border-radius: 0.75rem;
          box-shadow: 0 20px 60px -10px rgb(0 0 0 / 0.6);
          background: rgb(255 255 255 / 0.04);
        }
        .nakhl-lightbox-close {
          position: absolute;
          top: 0.75rem;
          left: 0.75rem;
          z-index: 2;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 2.5rem;
          height: 2.5rem;
          border-radius: 9999px;
          background: rgb(0 0 0 / 0.55);
          color: white;
          border: 1px solid rgb(255 255 255 / 0.18);
          cursor: pointer;
          transition: background 0.15s ease;
        }
        .nakhl-lightbox-close:hover { background: rgb(0 0 0 / 0.8); }
        .nakhl-lightbox-nav {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          z-index: 2;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 2.75rem;
          height: 2.75rem;
          border-radius: 9999px;
          background: rgb(255 255 255 / 0.12);
          color: white;
          border: 1px solid rgb(255 255 255 / 0.18);
          cursor: pointer;
          transition: background 0.15s ease;
        }
        .nakhl-lightbox-nav:hover { background: rgb(255 255 255 / 0.22); }
        .nakhl-lightbox-nav-prev { right: 0.5rem; }
        .nakhl-lightbox-nav-next { left: 0.5rem; }
        .nakhl-lightbox-counter {
          position: absolute;
          bottom: 0.5rem;
          right: 50%;
          transform: translateX(50%);
          z-index: 2;
          background: rgb(0 0 0 / 0.6);
          color: white;
          padding: 0.25rem 0.85rem;
          border-radius: 9999px;
          font-size: 0.7rem;
          font-weight: 700;
        }
        .nakhl-lightbox-thumbs {
          display: flex;
          gap: 0.5rem;
          margin-top: 0.85rem;
          max-width: 92vw;
          overflow-x: auto;
          padding: 0.25rem 0.25rem 0.5rem;
          scrollbar-width: thin;
        }
        .nakhl-lightbox-thumb {
          position: relative;
          width: 3.5rem;
          height: 3.5rem;
          border-radius: 0.5rem;
          overflow: hidden;
          cursor: pointer;
          border: 2px solid transparent;
          flex-shrink: 0;
          opacity: 0.6;
          transition: opacity 0.15s ease, border-color 0.15s ease;
        }
        .nakhl-lightbox-thumb:hover { opacity: 0.85; }
        .nakhl-lightbox-thumb-active {
          opacity: 1;
          border-color: var(--gold, oklch(0.78 0.16 71));
        }
        @media (prefers-reduced-motion: reduce) {
          .nakhl-lightbox-overlay,
          .nakhl-lightbox-img-wrap {
            animation: none;
          }
        }
      `}</style>

      {/* close */}
      <button
        ref={closeBtnRef}
        type="button"
        onClick={onClose}
        className="nakhl-lightbox-close"
        aria-label="بستن گالری"
        title="بستن (Esc)"
      >
        <X className="h-5 w-5" />
      </button>

      {/* image */}
      <div className="nakhl-lightbox-img-wrap">
        <Image
          src={current}
          alt={`تصویر ${toPersianDigits(index + 1)}`}
          fill
          sizes="92vw"
          className="nakhl-lightbox-img !object-contain"
          priority
        />

        {hasMultiple && (
          <>
            <button
              type="button"
              onClick={goPrev}
              className="nakhl-lightbox-nav nakhl-lightbox-nav-prev"
              aria-label="قبلی"
              title="قبلی (→)"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={goNext}
              className="nakhl-lightbox-nav nakhl-lightbox-nav-next"
              aria-label="بعدی"
              title="بعدی (←)"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <div className="nakhl-lightbox-counter" dir="rtl">
              {toPersianDigits(index + 1)} از {toPersianDigits(images.length)}
            </div>
          </>
        )}
      </div>

      {/* thumbnails strip */}
      {hasMultiple && (
        <div className="nakhl-lightbox-thumbs" role="tablist" aria-label="تصاویر گالری">
          {images.map((src, i) => (
            <button
              key={src + i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`نمایش تصویر ${toPersianDigits(i + 1)}`}
              onClick={() => setIndex(i)}
              className={`nakhl-lightbox-thumb ${i === index ? "nakhl-lightbox-thumb-active" : ""}`}
            >
              <Image src={src} alt="" fill sizes="56px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
