"use client";

import { useState, useEffect } from "react";
import { useAdminStore } from "@/lib/admin-store";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ShieldCheck, Lock, User, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export function AdminLogin() {
  const { setAdmin } = useAdminStore();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!username.trim() || !password) {
      toast.error("نام کاربری و رمز عبور را وارد کنید");
      return;
    }
    setLoading(true);
    const res = await api<{ admin: { username: string; displayName: string } }>("/api/admin/login", {
      body: { username: username.trim(), password },
    });
    setLoading(false);
    if (!res.success) {
      setAttempts((a) => a + 1);
      toast.error(res.error ?? "ورود ناموفق");
      setPassword("");
      return;
    }
    toast.success(`خوش آمدید، ${res.admin?.displayName ?? "مدیر"} 🌴`);
    setAdmin(res.admin ?? null);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[oklch(0.14_0.02_160)] p-4">
      {/* decorative bg */}
      <div className="palm-pattern absolute inset-0 opacity-[0.07]" aria-hidden />
      <div className="absolute -top-40 left-1/2 h-96 w-[50rem] -translate-x-1/2 rounded-full bg-primary/20 blur-3xl" aria-hidden />
      <div className="absolute -bottom-40 left-1/4 h-80 w-96 rounded-full bg-gold/10 blur-3xl" aria-hidden />

      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-primary shadow-2xl shadow-primary/40">
            <ShieldCheck className="h-10 w-10 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-black text-white">پنل مدیریت رستوران نخل</h1>
          <p className="mt-2 text-sm text-white/60">ورود امن — مخصوص مدیریت سامانه (nk-admin)</p>
        </div>

        <form
          onSubmit={submit}
          className="space-y-5 rounded-3xl border border-white/10 bg-white/5 p-7 shadow-2xl backdrop-blur-xl"
        >
          <div className="space-y-2">
            <Label className="text-white/80">نام کاربری</Label>
            <div className="relative">
              <User className="absolute right-3 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-white/40" />
              <Input
                dir="ltr"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username"
                className="h-12 rounded-xl border-white/15 bg-white/10 pl-4 pr-10 text-white placeholder:text-white/30"
                autoComplete="username"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-white/80">رمز عبور</Label>
            <div className="relative">
              <Lock className="absolute right-3 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-white/40" />
              <Input
                dir="ltr"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••"
                className="h-12 rounded-xl border-white/15 bg-white/10 pl-4 pr-10 text-white placeholder:text-white/30"
                autoComplete="current-password"
              />
            </div>
          </div>

          {attempts >= 2 && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs leading-5 text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              بعد از ۵ تلاش ناموفق، حساب به مدت ۱۰ دقیقه قفل می‌شود.
            </div>
          )}

          <Button
            type="submit"
            disabled={loading}
            className="h-12 w-full rounded-xl bg-gradient-to-l from-primary to-gold text-base font-black text-white shadow-lg transition-transform hover:scale-[1.01]"
          >
            {loading ? <Loader2 className="ml-2 h-5 w-5 animate-spin" /> : <ShieldCheck className="ml-2 h-5 w-5" />}
            ورود امن به پنل
          </Button>

          <p className="text-center text-[11px] leading-5 text-white/40">
            این بخش فقط برای مدیریت رستوران نخل رفسنجان است.
            <br />
            تمام تلاش‌های ورود در سیستم ثبت می‌شود.
          </p>
        </form>
      </div>
    </div>
  );
}
