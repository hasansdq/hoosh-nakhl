import type { Metadata } from "next";
import { AdminPanel } from "@/components/admin/AdminPanel";

export const metadata: Metadata = {
  title: "پنل مدیریت | رستوران نخل رفسنجان",
  description: "پنل مدیریت حرفه‌ای سامانه رستوران نخل",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminPanel />;
}
