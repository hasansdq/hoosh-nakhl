import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * Nakhl Restaurant — Cloudflare bindings access
 * ---------------------------------------------
 * Single source of truth for reaching Workers bindings (D1 / R2 / Durable
 * Objects) from Next.js server code.
 *
 * How it works in each environment:
 *  - Cloudflare Workers (production): the OpenNext worker entry stores the
 *    Cloudflare context on the global scope, `getCloudflareContext()` returns
 *    it synchronously.
 *  - Local `next dev`: `initOpenNextCloudflareForDev()` in next.config.ts
 *    spins up a real Miniflare instance (workerd) with the exact bindings
 *    from wrangler.jsonc — local D1/R2/DO with persistent state in
 *    `.wrangler/state` — so development and production share one code path.
 *
 * Type strategy:
 *  - `D1Database` is imported from @cloudflare/workers-types because it must
 *    structurally satisfy the `@prisma/adapter-d1` constructor (the one hard
 *    third-party boundary in the app).
 *  - R2 and Durable-Object types are self-contained DOM-flavored structural
 *    interfaces — they only describe what THIS app calls, so they stay
 *    compatible with standard Web APIs (Response bodies, AbortSignal, …).
 *
 * Every helper degrades to `null` (instead of throwing) so callers can return
 * clean API errors when a binding is missing.
 */

// ---------- structural types (what this app calls) ----------

export interface R2HttpMetadata {
  contentType?: string;
  contentLanguage?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  cacheControl?: string;
}

export interface R2Object {
  key: string;
  size: number;
  etag: string;
  httpEtag?: string;
  uploaded?: Date;
  httpMetadata?: R2HttpMetadata;
  customMetadata?: Record<string, string>;
}

export interface R2ObjectBody extends R2Object {
  body: ReadableStream;
}

export interface R2PutOptions {
  httpMetadata?: R2HttpMetadata;
  customMetadata?: Record<string, string>;
}

/** Cloudflare R2 bucket binding (`r2_buckets` in wrangler.jsonc). */
export interface R2Bucket {
  get(key: string, options?: Record<string, unknown>): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
    options?: R2PutOptions,
  ): Promise<R2Object | null>;
  head(key: string): Promise<R2Object | null>;
  delete(key: string | string[]): Promise<void>;
  list(options?: Record<string, unknown>): Promise<{
    objects: R2Object[];
    truncated: boolean;
    cursor?: string;
  }>;
}

/** Durable Object stub — service-binding style fetch (standard Web APIs). */
export interface DurableObjectStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

/** Durable Object namespace binding (`durable_objects` in wrangler.jsonc). */
export interface DurableObjectNamespace {
  idFromName(name: string): { toString(): string };
  get(id: unknown): DurableObjectStub;
}

// ---------- app bindings ----------

/** Bindings used by the application (subset of the worker env). */
export interface AppBindings {
  DB?: D1Database;
  R2?: R2Bucket;
  REALTIME?: DurableObjectNamespace;
  ADMIN_NOTIFY_KEY?: string;
  ZARINPAL_FORCE_REAL?: string;
  NAKHL_EXPOSE_DEV_CODE?: string;
}

/**
 * Returns the Cloudflare env (bindings + vars) or `null` when running
 * outside the Cloudflare context (e.g. a plain Node script).
 */
export async function getCloudflareEnv(): Promise<AppBindings | null> {
  try {
    const ctx = await getCloudflareContext({ async: true });
    return (ctx?.env as AppBindings | undefined) ?? null;
  } catch {
    // Not in a Cloudflare-enabled runtime — callers decide what to do.
    return null;
  }
}

/**
 * Synchronous variable lookup: Workers vars first (when the context is
 * already initialized — always the case inside request handling), then
 * process.env (local dev / Node scripts; on Workers, OpenNext also copies
 * vars into process.env on the first request). Never throws.
 */
export function cfVar(name: string): string | undefined {
  try {
    const ctx = getCloudflareContext();
    const value = (ctx?.env as AppBindings | undefined)?.[name as keyof AppBindings];
    if (typeof value === "string" && value !== "") return value;
  } catch {
    // context not initialized yet (e.g. top-level module evaluation) — fall through
  }
  const fromProcess = process.env[name];
  return typeof fromProcess === "string" && fromProcess !== "" ? fromProcess : undefined;
}

/** True when the app is executing inside the Cloudflare Workers runtime. */
export function isWorkersRuntime(): boolean {
  try {
    return getCloudflareContext() !== undefined;
  } catch {
    return false;
  }
}
