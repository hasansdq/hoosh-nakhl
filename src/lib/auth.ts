import "server-only";
import crypto from "crypto";
import { db } from "@/lib/db";
import { cookies } from "next/headers";

// ============ Crypto helpers ============

const SECRET = process.env.AUTH_SECRET || "nakhl-rafsanjan-secret-key-2024-please-change";

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export function generateOtpCode(length: number): string {
  const digits = "0123456789";
  let code = "";
  for (let i = 0; i < length; i++) code += digits[crypto.randomInt(0, 10)];
  return code;
}

/** Compare a plain value against its stored SHA-256 hex hash (timing-safe) */
export function verifyHash(value: string, storedHash: string): boolean {
  const a = Buffer.from(sha256(value), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(candidate);
  const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ============ User sessions ============

const USER_SESSION_COOKIE = "nakhl_session";
const ADMIN_SESSION_COOKIE = "nakhl_admin";
const USER_SESSION_DAYS = 14;
const ADMIN_SESSION_HOURS = 8;

export async function createUserSession(userId: string, ip?: string, userAgent?: string): Promise<string> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + USER_SESSION_DAYS * 24 * 3600 * 1000);
  await db.session.create({ data: { userId, token, expiresAt, ip, userAgent } });
  const cookieStore = await cookies();
  cookieStore.set(USER_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
  return token;
}

export async function getUserSession() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(USER_SESSION_COOKIE)?.value;
    if (!token) return null;
    const session = await db.session.findUnique({
      where: { token },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date() || session.user.status === "BLOCKED") {
      return null;
    }
    return { session, user: session.user };
  } catch {
    return null;
  }
}

export async function destroyUserSession(): Promise<void> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(USER_SESSION_COOKIE)?.value;
    if (token) {
      await db.session.deleteMany({ where: { token } });
    }
    cookieStore.delete(USER_SESSION_COOKIE);
  } catch {
    // ignore
  }
}

// ============ Admin sessions ============

export async function createAdminSession(adminId: string, ip?: string, userAgent?: string): Promise<string> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_HOURS * 3600 * 1000);
  await db.adminSession.create({ data: { adminId, token, expiresAt, ip, userAgent } });
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    expires: expiresAt,
    path: "/",
  });
  return token;
}

export async function getAdminSession() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
    if (!token) return null;
    const session = await db.adminSession.findUnique({
      where: { token },
      include: { admin: true },
    });
    if (!session || session.expiresAt < new Date()) return null;
    return session;
  } catch {
    return null;
  }
}

export async function destroyAdminSession(): Promise<void> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
    if (token) await db.adminSession.deleteMany({ where: { token } });
    cookieStore.delete(ADMIN_SESSION_COOKIE);
  } catch {
    // ignore
  }
}

// ============ Rate limiting (in-memory sliding window) ============

interface RateBucket {
  hits: number[];
}
const globalRate = globalThis as unknown as {
  __nakhlRate?: Map<string, RateBucket>;
};
const rateMap: Map<string, RateBucket> = (globalRate.__nakhlRate ??= new Map());

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const bucket = rateMap.get(key) ?? { hits: [] };
  const now = Date.now();
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
  if (bucket.hits.length >= limit) {
    const retryAfter = Math.ceil((windowMs - (now - bucket.hits[0])) / 1000);
    rateMap.set(key, bucket);
    return { ok: false, retryAfter };
  }
  bucket.hits.push(now);
  rateMap.set(key, bucket);
  return { ok: true, retryAfter: 0 };
}

// ============ Client IP ============

export function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}
