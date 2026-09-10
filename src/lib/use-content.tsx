"use client";

/**
 * Nakhl Restaurant — CMS consumption helpers (client).
 *
 * `useContent()` returns:
 *   • t(key)          — the effective (override ?? default) text, with
 *                       {placeholder} tokens interpolated from live
 *                       «عمومی» settings (city, restaurantName, …).
 *   • raw(key)        — same as t() but without interpolation.
 *   • img(key)        — effective image URL for image-type keys.
 *
 * Rendering utilities:
 *   • <RichText text highlightClassName/> — renders `[[هایلایت]]` spans and
 *     `\n` line breaks (markup the admin can type in every text field).
 *   • <ContentImage src alt …/> — next/image for site-relative paths, a
 *     plain <img> for absolute external URLs (avoids optimizer domain
 *     restrictions on admin-entered external images).
 */

import { useCallback, useMemo, type ReactNode, Fragment } from "react";
import Image, { type ImageProps } from "next/image";
import { useAppStore } from "@/lib/store";
import {
  getContentDef,
  interpolateContent,
} from "@/lib/content-defs";

export type ContentVars = Record<string, string>;

export function useContent() {
  const siteContent = useAppStore((s) => s.siteContent);
  const siteSettings = useAppStore((s) => s.siteSettings);

  const vars: ContentVars = useMemo(
    () => ({
      restaurantName: siteSettings.restaurantName,
      restaurantTagline: siteSettings.restaurantTagline,
      city: siteSettings.city,
      address: siteSettings.address,
      phone: siteSettings.phone,
      workingHours: siteSettings.workingHours,
      email: siteSettings.email,
      instagram: siteSettings.instagram,
      telegram: siteSettings.telegram,
    }),
    [siteSettings],
  );

  /** Raw value (override ?? registry default) — no placeholder interpolation. */
  const raw = useCallback(
    (key: string): string => {
      const stored = siteContent[key];
      if (typeof stored === "string" && stored !== "") return stored;
      return getContentDef(key)?.default ?? key;
    },
    [siteContent],
  );

  /** Interpolated text — the standard way to read CMS texts. */
  const t = useCallback(
    (key: string): string => interpolateContent(raw(key), vars),
    [raw, vars],
  );

  /** Effective image URL for image-type keys ("" when unknown). */
  const img = useCallback(
    (key: string): string => {
      const value = raw(key);
      return value.startsWith("/") || /^https?:\/\//.test(value) ? value : "";
    },
    [raw],
  );

  return { t, raw, img, vars };
}

/* ------------------------------------------------------------------ */
/*  Rich text renderer — [[highlight]] + \n                            */
/* ------------------------------------------------------------------ */

const HIGHLIGHT_RE = /\[\[([^\[\]]+?)\]\]/g;

function renderSegments(
  text: string,
  highlightClassName: string,
  extraHighlightClass?: string,
): ReactNode[] {
  const parts = text.split(HIGHLIGHT_RE);
  // even indices = plain text; odd indices = captured highlight content
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={`hl-${i}-${part}`} className={`${highlightClassName} ${extraHighlightClass ?? ""}`.trim()}>
        {part}
      </span>
    ) : (
      <Fragment key={`tx-${i}-${part.slice(0, 24)}`}>{part}</Fragment>
    ),
  );
}

export function RichText({
  text,
  highlightClassName = "gold-gradient-text",
  extraHighlightClass,
  as: Tag = "span",
  className,
}: {
  text: string;
  /** class applied to `[[...]]` spans — defaults to the gold gradient */
  highlightClassName?: string;
  /** additional classes appended to highlight spans */
  extraHighlightClass?: string;
  as?: keyof React.JSX.IntrinsicElements;
  className?: string;
}) {
  const lines = text.split("\n");
  return (
    <Tag className={className}>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {renderSegments(line, highlightClassName, extraHighlightClass)}
        </Fragment>
      ))}
    </Tag>
  );
}

/* ------------------------------------------------------------------ */
/*  Content image — next/image for local paths, <img> for external     */
/* ------------------------------------------------------------------ */

export type ContentImageProps = Omit<ImageProps, "src"> & {
  src: string;
};

export function ContentImage({ src, alt, ...rest }: ContentImageProps) {
  if (!src) return null;
  const isExternal = /^https?:\/\//.test(src);
  if (isExternal) {
    // Admin-entered external URLs bypass the Next optimizer (the dev server
    // only optimizes configured local domains). next/image-only props are
    // translated so `fill` keeps its absolute-fill semantics on a plain <img>.
    const {
      fill,
      priority: _priority,
      placeholder: _placeholder,
      loader: _loader,
      unoptimized: _unoptimized,
      ...imgProps
    } = rest as ImageProps & Record<string, unknown>;
    if (fill) {
      return (
         
        <img
          src={src}
          alt={alt}
          {...(imgProps as object)}
          style={{ position: "absolute", inset: 0, height: "100%", width: "100%", ...((imgProps as { style?: React.CSSProperties }).style ?? {}) }}
        />
      );
    }
     
    return <img src={src} alt={alt} {...(imgProps as object)} />;
  }
  return <Image src={src} alt={alt} {...rest} />;
}
