import "server-only";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Nakhl Restaurant — Prisma client (Docker / VPS deployment)
 * ----------------------------------------------------------
 * The generated client (prisma schema `runtime = "workerd"`) is fully
 * engineless: queries are compiled by an inlined WebAssembly compiler and
 * executed through the `@prisma/adapter-libsql` driver adapter on a local
 * SQLite file. (Despite its name, Prisma's "workerd" runtime is simply the
 * engineless WASM build target — it runs on plain Node 22, which is exactly
 * what the Docker runtime image and local `next dev` use.)
 *
 * Database file location:
 *  • Docker / VPS (Node standalone): `NAKHL_SQLITE_PATH` is set by the
 *    Dockerfile/entrypoint — the file lives on the persistent `nakhl-data`
 *    volume (/app/data/nakhl.db) and survives redeploys.
 *  • Local `next dev`: falls back to `db/nakhl.db` in the repo (gitignored;
 *    create/migrate it once with `bun run db:setup`).
 *
 * Loading strategy for the adapter (matters for the bundlers):
 *  • Turbopack compiles non-literal `import(expr)` in server code into a
 *    throwing "Cannot find module as expression is too dynamic" stub, and
 *    it also tracks `createRequire` obtained through a destructured
 *    `await import("node:module")` — both approaches get stubbed.
 *  • `process.getBuiltinModule("module")` is a plain method call: Turbopack
 *    leaves the whole chain untouched, and Next's output-file tracing does
 *    not fall back to whole-repo globs. On Node (≥22.3, our node:22 image)
 *    it resolves the real module at runtime and the adapter — together with
 *    its native @libsql/client dependency — is loaded straight from
 *    node_modules, exactly what the Dockerfile's runtime-deps merge step
 *    installs into the standalone bundle.
 */

type AnyCallable = (...args: any[]) => any;
const globalForPrisma = globalThis as unknown as {
  __nakhlDbState?: { client: PrismaClient | null; init: Promise<PrismaClient> | null };
};
const state = (globalForPrisma.__nakhlDbState ??= { client: null, init: null });

async function createPrismaClient(): Promise<PrismaClient> {
  // Explicit path (Docker volume) → repo-relative dev default (db/nakhl.db).
  const sqlitePath = process.env.NAKHL_SQLITE_PATH || "db/nakhl.db";

  const nodeModule = process.getBuiltinModule?.("module") as
    | { createRequire?: (url: string) => NodeRequire }
    | undefined;
  const nodeRequire = nodeModule?.createRequire?.(import.meta.url);
  if (!nodeRequire) {
    throw new Error("Node runtime without process.getBuiltinModule — use the node:22 Docker image");
  }
  const adapterModuleId = ["@prisma/adapter-", "libsql"].join("");
  const { PrismaLibSQL } = nodeRequire(adapterModuleId) as typeof import("@prisma/adapter-libsql");
  const client = new PrismaClient({ adapter: new PrismaLibSQL({ url: `file:${sqlitePath}` }) });

  // Warm the connection (opens the SQLite file) with one retry. During
  // parallel first-compiles in `next dev`, several routes can race the very
  // first file open and one transiently fails — a single retry absorbs it.
  // Production (single process, migrations finish before the server starts)
  // never hits this; the warm-up costs one sub-millisecond local SELECT.
  try {
    await client.$queryRaw`SELECT 1`;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await client.$queryRaw`SELECT 1`;
  }
  return client;
}

function getClient(): Promise<PrismaClient> {
  if (state.client) return Promise.resolve(state.client);
  state.init ??= createPrismaClient().then(
    (client) => {
      state.client = client;
      return client;
    },
    (error) => {
      // a failed init must not be memoized — the next call retries
      state.init = null;
      throw error;
    },
  );
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
