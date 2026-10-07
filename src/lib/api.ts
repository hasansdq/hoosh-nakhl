import "server-only";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUserSession, getAdminSession } from "@/lib/auth";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ success: true, ...(data as object) }, init);
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}

export async function requireUser() {
  const session = await getUserSession();
  if (!session) return null;
  return session.user;
}

export async function requireAdmin() {
  const session = await getAdminSession();
  if (!session) return null;
  return session;
}

export async function logAudit(
  actor: string,
  action: string,
  opts?: { entity?: string; entityId?: string; detail?: unknown; ip?: string }
) {
  try {
    await db.auditLog.create({
      data: {
        actor,
        action,
        entity: opts?.entity,
        entityId: opts?.entityId,
        detail: opts?.detail ? JSON.stringify(opts.detail) : null,
        ip: opts?.ip,
      },
    });
  } catch {
    // audit failures must never break the request
  }
}

/** Public user shape (no sensitive data) */
export function publicUser(user: {
  id: string; phone: string; firstName: string | null; lastName: string | null;
  nationalId: string | null; email: string | null; birthDate: Date | null;
  gender: string | null; avatarUrl: string | null; dietaryPrefs: string | null; createdAt: Date;
}) {
  return {
    id: user.id,
    phone: user.phone,
    firstName: user.firstName,
    lastName: user.lastName,
    nationalId: user.nationalId,
    email: user.email,
    birthDate: user.birthDate?.toISOString() ?? null,
    gender: user.gender,
    avatarUrl: user.avatarUrl,
    dietaryPrefs: safeParseDietaryPrefs(user.dietaryPrefs),
    createdAt: user.createdAt.toISOString(),
  };
}

export interface DietaryPrefs {
  vegetarian: boolean;
  avoidSpicy: boolean;
  allergies: string;
  dislikes: string;
}

/** Parse the dietaryPrefs JSON column safely; returns canonical defaults when invalid */
export function safeParseDietaryPrefs(raw: string | null | undefined): DietaryPrefs | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return {
      vegetarian: parsed.vegetarian === true,
      avoidSpicy: parsed.avoidSpicy === true,
      allergies: typeof parsed.allergies === "string" ? parsed.allergies.slice(0, 200) : "",
      dislikes: typeof parsed.dislikes === "string" ? parsed.dislikes.slice(0, 200) : "",
    };
  } catch {
    return null;
  }
}
