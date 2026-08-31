import "server-only";
import { PrismaClient } from "@/generated/prisma/client";
import { getCloudflareEnv } from "@/lib/cf";

/**
 * Nakhl Restaurant — Prisma client for Cloudflare D1
 * ---------------------------------------------------
 * The generated client (prisma schema `runtime = "workerd"`) is fully
 * engineless: queries are compiled by an inlined WebAssembly compiler and
 * executed through a driver adapter. On Cloudflare (and in local `next dev`
 * via Miniflare) the adapter is `@prisma/adapter-d1`, wired to the `DB`
 * binding declared in wrangler.jsonc.
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

  if (!d1) {
    throw new Error(
      "D1 binding «DB» is not available. In production it is declared in wrangler.jsonc " +
        "(d1_databases); in local `next dev` it is provided by initOpenNextCloudflareForDev() (Miniflare).",
    );
  }

  const { PrismaD1 } = await import("@prisma/adapter-d1");
  return new PrismaClient({ adapter: new PrismaD1(d1) });
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
