"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAppStore } from "@/lib/store";
import { api } from "@/lib/client-api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Phone, ShieldCheck, UserPlus, Loader2, MessageSquare, Info } from "lucide-react";
import { toast } from "sonner";
import { toPersianDigits, formatPhone } from "@/lib/fa";

type Step = "phone" | "otp" | "register";
type Purpose = "LOGIN" | "REGISTER" | null;

export function AuthModal() {
  const { authOpen, setAuthOpen, refreshUser, setView, user } = useAppStore();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpToken, setOtpToken] = useState("");
  const [purpose, setPurpose] = useState<Purpose>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [otpLength, setOtpLength] = useState(5);

  // register form
  const [form, setForm] = useState({
    firstName: "", lastName: "", nationalId: "", birthDate: "", gender: "", email: "",
  });

  const phoneRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (authOpen) {
      setTimeout(() => phoneRef.current?.focus(), 150);
    }
  }, [authOpen]);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const close = useCallback(() => {
    setAuthOpen(false);
    setTimeout(() => {
      setStep("phone");
      setOtp("");
      setDevCode(null);
      setPurpose(null);
      setOtpToken("");
    }, 300);
  }, [setAuthOpen]);

  const sendOtp = async () => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) {
      toast.error("شماره موبایل را کامل وارد کنید (مثال: ۰۹۱۲۳۴۵۶۷۸۹)");
      return;
    }
    setLoading(true);
    setDevCode(null);
    const res = await api<{ purpose?: Purpose; ttlMinutes?: number; devCode?: string; otpLength?: number }>(
      "/api/auth/send-otp",
      { body: { phone: digits } }
    );
    setLoading(false);
    if (!res.success) {
      toast.error(res.error ?? "خطا در ارسال کد");
      return;
    }
    setPurpose((res.purpose as Purpose) ?? null);
    if (res.devCode) {
      setDevCode(res.devCode);
      setOtpLength(String(res.devCode).length);
    }
    setStep("otp");
    setCountdown(120);
    toast.success("کد تأیید پیامک شد 📩");
  };

  const verifyOtp = async (value?: string) => {
    const code = (value ?? otp).replace(/\D/g, "");
    if (code.length < 4) {
      toast.error("کد تأیید را کامل وارد کنید");
      return;
    }
    setLoading(true);
    const res = await api<{ registered: boolean; otpToken?: string }>("/api/auth/verify-otp", {
      body: { phone: phone.replace(/\D/g, ""), code },
    });
    setLoading(false);
    if (!res.success) {
      toast.error(res.error ?? "کد نادرست است");
      setOtp("");
      return;
    }
    if (res.registered) {
      await refreshUser();
      toast.success("خوش آمدید! 🌴");
      close();
      setView("chat");
    } else {
      setOtpToken(res.otpToken ?? "");
      setStep("register");
    }
  };

  const register = async () => {
    if (form.firstName.trim().length < 2 || form.lastName.trim().length < 2) {
      toast.error("نام و نام خانوادگی را کامل وارد کنید");
      return;
    }
    if (form.nationalId && !/^\d{10}$/.test(form.nationalId.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))))) {
      toast.error("کد ملی باید ۱۰ رقم باشد");
      return;
    }
    setLoading(true);
    const res = await api("/api/auth/register", {
      body: {
        phone: phone.replace(/\D/g, ""),
        otpToken,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        nationalId: form.nationalId.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))),
        birthDate: form.birthDate,
        gender: form.gender,
        email: form.email,
      },
    });
    setLoading(false);
    if (!res.success) {
      toast.error(res.error ?? "خطا در ثبت‌نام");
      return;
    }
    await refreshUser();
    toast.success("ثبت‌نام با موفقیت انجام شد! خوش آمدید 🌴");
    close();
    setView("chat");
  };

  return (
    <Dialog open={authOpen} onOpenChange={(open) => !open && close()} dir="rtl">
      <DialogContent className="max-w-md rounded-2xl p-0 overflow-hidden" aria-describedby="auth-desc">
        {/* header banner */}
        <div className="relative bg-gradient-to-l from-primary to-primary/80 px-6 pb-8 pt-6 text-primary-foreground">
          <div className="palm-pattern absolute inset-0 opacity-20" aria-hidden />
          <DialogHeader className="relative">
            <DialogTitle className="flex items-center gap-2 text-xl font-extrabold">
              {step === "phone" && <Phone className="h-5 w-5" />}
              {step === "otp" && <MessageSquare className="h-5 w-5" />}
              {step === "register" && <UserPlus className="h-5 w-5" />}
              {step === "phone" && "ورود / ثبت‌نام"}
              {step === "otp" && "کد تأیید"}
              {step === "register" && "تکمیل اطلاعات"}
            </DialogTitle>
            <DialogDescription className="text-primary-foreground/85" id="auth-desc">
              {step === "phone" && "ورود و عضویت فقط با شماره موبایل و کد یکبارمصرف پیامکی — بدون رمز عبور!"}
              {step === "otp" && `کد ${toPersianDigits(String(otpLength))} رقمی پیامک‌شده به ${formatPhone(phone)} را وارد کنید`}
              {step === "register" && "اطلاعات هویتی خود را برای تکمیل عضویت وارد کنید"}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="p-6 pt-2">
          {step === "phone" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="phone">شماره موبایل</Label>
                <Input
                  id="phone"
                  ref={phoneRef}
                  dir="ltr"
                  inputMode="tel"
                  placeholder="09123456789"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/[^\d۰-۹+]/g, ""))}
                  onKeyDown={(e) => e.key === "Enter" && sendOtp()}
                  className="h-12 rounded-xl text-center text-lg tracking-widest"
                />
                <p className="text-xs text-muted-foreground">
                  با ورود یا ثبت‌نام، <a className="text-primary underline underline-offset-2" href="#" onClick={(e) => e.preventDefault()}>قوانین رستوران نخل</a> را می‌پذیرید.
                </p>
              </div>
              <Button onClick={sendOtp} disabled={loading} className="h-12 w-full rounded-xl text-base font-bold">
                {loading ? <Loader2 className="ml-2 h-5 w-5 animate-spin" /> : <MessageSquare className="ml-2 h-5 w-5" />}
                دریافت کد تأیید
              </Button>
            </div>
          )}

          {step === "otp" && (
            <div className="space-y-4">
              {devCode && (
                <div className="flex items-start gap-2 rounded-xl border border-gold/40 bg-gold/10 p-3 text-xs leading-6">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                  <div>
                    <b>حالت آزمایشی:</b> پنل پیامک هنوز متصل نشده، بنابراین کد تأیید همین‌جا نمایش داده می‌شود:{" "}
                    <span className="rounded-lg bg-card px-2 py-0.5 font-mono text-base font-bold tracking-widest text-primary" dir="ltr">
                      {devCode}
                    </span>
                  </div>
                </div>
              )}
              <div className="flex flex-col items-center gap-3">
                <InputOTP
                  maxLength={otpLength}
                  value={otp}
                  onChange={(value) => {
                    setOtp(value);
                    if (value.length === otpLength) verifyOtp(value);
                  }}
                  dir="ltr"
                >
                  <InputOTPGroup>
                    {Array.from({ length: Math.min(3, otpLength) }).map((_, i) => (
                      <InputOTPSlot key={i} index={i} className="h-12 w-11 text-lg" />
                    ))}
                  </InputOTPGroup>
                  {otpLength > 3 && (
                    <>
                      <InputOTPSeparator />
                      <InputOTPGroup>
                        {Array.from({ length: otpLength - 3 }).map((_, i) => (
                          <InputOTPSlot key={i + 3} index={i + 3} className="h-12 w-11 text-lg" />
                        ))}
                      </InputOTPGroup>
                    </>
                  )}
                </InputOTP>
              </div>
              <Button onClick={() => verifyOtp()} disabled={loading || otp.length < otpLength} className="h-12 w-full rounded-xl text-base font-bold">
                {loading ? <Loader2 className="ml-2 h-5 w-5 animate-spin" /> : <ShieldCheck className="ml-2 h-5 w-5" />}
                تأیید و ادامه
              </Button>
              <div className="flex items-center justify-between text-xs">
                <button onClick={() => setStep("phone")} className="text-muted-foreground transition hover:text-primary">
                  ← تغییر شماره
                </button>
                {countdown > 0 ? (
                  <span className="text-muted-foreground">
                    ارسال مجدد کد تا {toPersianDigits(countdown)} ثانیه
                  </span>
                ) : (
                  <button onClick={sendOtp} className="font-semibold text-primary hover:underline">
                    ارسال مجدد کد ↻
                  </button>
                )}
              </div>
            </div>
          )}

          {step === "register" && (
            <div className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>نام *</Label>
                  <Input
                    value={form.firstName}
                    onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                    placeholder="مثال: حسین"
                    className="h-11 rounded-xl"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>نام خانوادگی *</Label>
                  <Input
                    value={form.lastName}
                    onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                    placeholder="مثال: رضایی"
                    className="h-11 rounded-xl"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>کد ملی (اختیاری)</Label>
                <Input
                  dir="ltr"
                  inputMode="numeric"
                  value={form.nationalId}
                  onChange={(e) => setForm({ ...form, nationalId: e.target.value.replace(/[^\d۰-۹]/g, "") })}
                  placeholder="کد ۱۰ رقمی"
                  className="h-11 rounded-xl"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>تاریخ تولد (اختیاری)</Label>
                  <Input
                    placeholder="۱۳۷۵/۰۳/۱۲"
                    value={form.birthDate}
                    onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
                    className="h-11 rounded-xl"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>جنسیت (اختیاری)</Label>
                  <div className="flex gap-1.5">
                    {[
                      { v: "MALE", l: "آقا" },
                      { v: "FEMALE", l: "خانم" },
                    ].map((g) => (
                      <button
                        key={g.v}
                        type="button"
                        onClick={() => setForm({ ...form, gender: form.gender === g.v ? "" : g.v })}
                        className={`h-11 flex-1 rounded-xl border text-sm font-semibold transition ${
                          form.gender === g.v
                            ? "border-primary bg-primary text-primary-foreground"
                            : "hover:bg-accent"
                        }`}
                      >
                        {g.l}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>ایمیل (اختیاری)</Label>
                <Input
                  dir="ltr"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="you@example.com"
                  className="h-11 rounded-xl"
                />
              </div>
              <Button onClick={register} disabled={loading} className="h-12 w-full rounded-xl text-base font-bold">
                {loading ? <Loader2 className="ml-2 h-5 w-5 animate-spin" /> : <UserPlus className="ml-2 h-5 w-5" />}
                تکمیل ثبت‌نام
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
