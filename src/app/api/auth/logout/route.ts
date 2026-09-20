import { ok } from "@/lib/api";
import { destroyUserSession } from "@/lib/auth";

export async function POST() {
  await destroyUserSession();
  return ok({ message: "با موفقیت خارج شدید" });
}
