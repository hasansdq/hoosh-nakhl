import "server-only";
import { PrismaClient } from "@/generated/prisma/client";
import { getCloudflareEnv, isWorkersRuntime } from "@/lib/cf";

/**
 * Nakhl Restaurant — Prisma client (dual deployment runtime)
 * ----------------------------------------------------------
 * The generated client (prisma schema `runtime = "workerd"`) is fully
 * engineless: queries are compiled by an inlined WebAssembly compiler and
 * executed through a driver adapter. The backend is selected per runtime:
 *
 *  • Cloudflare Workers (and local `next dev` via Miniflare): the adapter is
 *    `@prisma/adapter-d1`, wired to the `DB` binding declared in wrangler.jsonc.
 *
 *  • Docker / VPS (Node standalone): when `NAKHL_SQLITE_PATH` is set (set by
 *    docker/entrypoint.sh — the file lives on the persistent `nakhl-data`
 *    volume), the adapter is `@prisma/adapter-libsql` over a local SQLite
 *    file. Both adapter modules are loaded through non-literal, bundler-
 *    excluded dynamic imports so the Cloudflare worker bundle never includes
 *    them (same proven pattern as src/lib/ai/index.ts).
 *
 * Because module top-level code cannot `await` the async Cloudflare context,
 * `db` is a lazily-initialized proxy: any method call resolves the real
 * PrismaClient first (memoized), then forwards the call. All Prisma
 * operations return Promises, so this is fully transparent to callers —
 * `await db.user.findMany()` and `await db.$queryRaw\`...\`` behave exactly
 * like a direct client.
 */

type AnyCallable = (...args: any[]) => any;
const globalForPrisma = globalThis as unknown as {
  __nakhlDbState?: { client: PrismaClient | null; init: Promise<PrismaClient> | null };
};
const state = (globalForPrisma.__nakhlDbState ??= { client: null, init: null });

async function createPrismaClient(): Promise<PrismaClient> {
  const env = await getCloudflareEnv();
  const d1 = env?.DB;

  if (d1) {
    const { PrismaD1 } = await import("@prisma/adapter-d1");
    return new PrismaClient({ adapter: new PrismaD1(d1) });
  }

  // ---- Docker / VPS (Node standalone) — local SQLite via libsql ----------
  // The adapter creates the underlying @libsql/client connection itself
  // from this config; the SQLite file lives on the persistent data volume.
  //
  // Loading strategy (matters for BOTH deployment targets):
  //  • Turbopack compiles non-literal `import(expr)` in server code into a
  //    throwing "Cannot find module as expression is too dynamic" stub, and
  //    it also tracks `createRequire` obtained through a destructured
  //    `await import("node:module")` — both approaches get stubbed.
  //  • `process.getBuiltinModule("module")` is a plain method call: Turbopack
  //    leaves the whole chain untouched (verified with a live build probe),
  //    OpenNext's esbuild sees nothing resolvable, and the file tracer does
  //    not fall back to whole-repo globs. On Node (≥22.3, our node:22 image)
  //    it resolves the real module at runtime; on workerd the branch is
  //    unreachable (guards above) so it is never evaluated.
  const sqlitePath = process.env.NAKHL_SQLITE_PATH;
  if (sqlitePath && !isWorkersRuntime()) {
    const nodeModule = process.getBuiltinModule?.("module") as
      | { createRequire?: (url: string) => NodeRequire }
      | undefined;
    const nodeRequire = nodeModule?.createRequire?.(import.meta.url);
    if (!nodeRequire) {
      throw new Error("Node runtime without process.getBuiltinModule — use the node:22 Docker image");
    }
    const adapterModuleId = ["@prisma/adapter-", "libsql"].join("");
    const { PrismaLibSQL } = nodeRequire(adapterModuleId) as typeof import("@prisma/adapter-libsql");
    return new PrismaClient({ adapter: new PrismaLibSQL({ url: `file:${sqlitePath}` }) });
  }

  throw new Error(
    "No database backend available. Cloudflare deploys need the D1 binding «DB» " +
      "(wrangler.jsonc d1_databases); Docker/VPS deploys need NAKHL_SQLITE_PATH " +
      "(set automatically by docker/entrypoint.sh).",
  );
}

function getClient(): Promise<PrismaClient> {
  if (state.client) return Promise.resolve(state.client);
  state.init ??= createPrismaClient().then((client) => {
    state.client = client;
    return client;
  });
  return state.init;
}

/** Resolve a dot-path on the live client; throws descriptively on unknown paths. */
function resolvePath(client: PrismaClient, path: string[]): unknown {
  let current: unknown = client;
  for (const segment of path) {
    if (current === null || current === undefined) {
      throw new Error(`db.${path.join(".")}: cannot read "${segment}" of undefined`);
    }
    const next = (current as Record<string, unknown>)[segment];
    if (next === undefined) {
      throw new Error(`db.${path.join(".")}: unknown Prisma API "${segment}"`);
    }
    current = next;
  }
  return current;
}

/**
 * Callable proxy node for one segment of the Prisma API path:
 *  - calling it forwards a method call (db.$queryRaw…`, db.user.count())
 *  - accessing properties on it creates a deeper node (db.user.findMany)
 */
function createNode(ready: Promise<PrismaClient>, path: string[]): any {
  return new Proxy(function () {} as AnyCallable, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop === "then") {
        // Awaiting a namespace (e.g. `await db.user` misuse) must not hang.
        return undefined;
      }
      return createNode(ready, [...path, prop]);
    },
    apply(_target, _thisArg, args: any[]) {
      return ready.then((client) => {
        const target = resolvePath(client, path);
        if (typeof target !== "function") {
          throw new Error(
            `db.${path.join(".")} is not callable — Prisma namespaces must end in a method call.`,
          );
        }
        return (target as AnyCallable).apply(client, args);
      });
    },
  });
}

/**
 * The application-wide Prisma client. Import contract unchanged:
 * `import { db } from "@/lib/db"` → `await db.model.operation(...)`.
 */
export const db: PrismaClient = createNode(getClient(), []) as unknown as PrismaClient;
