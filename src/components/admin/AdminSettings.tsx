"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Bot,
  MessageSquare,
  CreditCard,
  Store,
  Save,
  Loader2,
  Plug,
  CheckCircle2,
  XCircle,
  Search,
  Sparkles,
  Info,
  Sun,
  Moon,
  Clock3,
  UtensilsCrossed,
} from "lucide-react";
import { toPersianDigits } from "@/lib/fa";
import { CategoryIcon } from "@/components/CategoryIcon";
import {
  describeBusinessHours,
  isDinnerShiftNow,
  openStatusText,
  parseHHMM,
  nowMinutesInRestaurantTz,
  type BusinessHours,
  type HoursPeriod,
  type PeriodKey,
} from "@/lib/hours";

// ==================== AI ====================

interface AISettings {
  provider: "zai" | "openai" | "openrouter";
  apiKey: string;
  model: string;
  baseUrl: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  presencePenalty: number;
  frequencyPenalty: number;
  systemPromptExtra: string;
  maxHistoryMessages: number;
  requestTimeout: number;
  friendlyTone: boolean;
  suggestBestSellers: boolean;
  allowSmallTalk: boolean;
  maxItemsPerOrder: number;
}

function AiSettingsTab() {
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [testMsg, setTestMsg] = useState("");
  const [models, setModels] = useState<{ id: string; name?: string }[]>([]);
  const [modelSearch, setModelSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api<{ settings: AISettings }>("/api/admin/settings?group=ai");
    if (res.success) setSettings(res.settings);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetching
    load();
  }, [load]);

  const testConnection = async () => {
    if (!settings) return;
    setTesting(true);
    setConnected(null);
    setTestMsg("");
    const res = await api<{ connected: boolean; message: string; models: { id: string; name?: string }[] }>(
      "/api/admin/ai/test",
      {
        body: {
          provider: settings.provider,
          apiKey: settings.apiKey,
          baseUrl: settings.baseUrl,
        },
      }
    );
    setTesting(false);
    if (!res.success) {
      setConnected(false);
      setTestMsg(res.error ?? "خطا در تست");
      return;
    }
    setConnected(res.connected);
    setTestMsg(res.message ?? "");
    setModels(res.models ?? []);
    if (res.connected) toast.success("اتصال برقرار است ✅");
    else toast.error(res.message ?? "اتصال ناموفق");
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    const res = await api("/api/admin/settings", {
      method: "PUT",
      body: {
        group: "ai",
        values: {
          provider: settings.provider,
          apiKey: settings.apiKey,
          model: settings.model,
          baseUrl: settings.baseUrl,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          topP: settings.topP,
          presencePenalty: settings.presencePenalty,
          frequencyPenalty: settings.frequencyPenalty,
          systemPromptExtra: settings.systemPromptExtra,
          maxHistoryMessages: settings.maxHistoryMessages,
          requestTimeout: settings.requestTimeout,
          friendlyTone: settings.friendlyTone,
          suggestBestSellers: settings.suggestBestSellers,
          allowSmallTalk: settings.allowSmallTalk,
          maxItemsPerOrder: settings.maxItemsPerOrder,
        },
      },
    });
    setSaving(false);
    if (!res.success) return toast.error(res.error ?? "خطا در ذخیره");
    toast.success("تنظیمات هوش مصنوعی ذخیره شد ✅");
    load();
  };

  if (loading || !settings) return <Skeleton className="h-96 rounded-2xl" />;

  const filteredModels = models.filter((m) =>
    modelSearch ? m.id.toLowerCase().includes(modelSearch.toLowerCase()) : true
  );

  return (
    <div className="space-y-4">
      <Card className="gap-0 rounded-2xl">
        <CardHeader className="border-b py-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-5 w-5 text-primary" />
            سرویس‌دهنده هوش مصنوعی
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          {/* provider selection */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              { v: "zai", t: "موتور داخلی نخل", d: "GLM — بدون کلید API" },
              { v: "openai", t: "OpenAI", d: "platform.openai.com" },
              { v: "openrouter", t: "OpenRouter", d: "openrouter.ai" },
            ].map((p) => (
              <button
                key={p.v}
                onClick={() => {
                  setSettings({ ...settings, provider: p.v as AISettings["provider"] });
                  setModels([]);
                  setConnected(null);
                }}
                className={`rounded-2xl border-2 p-3.5 text-right transition ${
                  settings.provider === p.v
                    ? "border-primary bg-primary/5 shadow-md"
                    : "hover:border-primary/40"
                }`}
              >
                <div className="text-sm font-extrabold">{p.t}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{p.d}</div>
                {settings.provider === p.v && (
                  <Badge className="mt-2 bg-primary text-primary-foreground">انتخاب فعال</Badge>
                )}
              </button>
            ))}
          </div>

          {/* API key */}
          {settings.provider !== "zai" && (
            <div className="space-y-1.5">
              <Label>کلید API</Label>
              <div className="flex gap-2">
                <Input
                  dir="ltr"
                  type="password"
                  value={settings.apiKey}
                  onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="rounded-xl"
                />
              </div>
              <p className="text-[11px] leading-5 text-muted-foreground">
                کلید API فقط در سرور ذخیره می‌شود و هرگز به مرورگر کاربران ارسال نمی‌شود. 🔒
              </p>
            </div>
          )}

          {/* base url */}
          {settings.provider !== "zai" && (
            <div className="space-y-1.5">
              <Label>Base URL سفارشی (اختیاری)</Label>
              <Input
                dir="ltr"
                value={settings.baseUrl}
                onChange={(e) => setSettings({ ...settings, baseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1"
                className="rounded-xl"
              />
            </div>
          )}

          {/* test & models */}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={testConnection} disabled={testing} variant="outline" className="rounded-xl font-bold">
              {testing ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Plug className="ml-2 h-4 w-4" />}
              تست اتصال و دریافت مدل‌ها
            </Button>
            {connected === true && (
              <Badge className="gap-1 bg-emerald-500/10 text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" /> متصل
              </Badge>
            )}
            {connected === false && (
              <Badge variant="destructive" className="gap-1">
                <XCircle className="h-3.5 w-3.5" /> قطع
              </Badge>
            )}
          </div>

          {testMsg && (
            <div
              className={`rounded-xl border p-3 text-xs leading-6 ${
                connected ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400" : "border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-400"
              }`}
            >
              {testMsg}
            </div>
          )}

          {/* model select */}
          {models.length > 0 && (
            <div className="space-y-2 rounded-2xl border p-3.5">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-bold">انتخاب مدل ({models.length} مدل موجود)</Label>
                {settings.model && (
                  <Badge className="bg-primary text-primary-foreground" dir="ltr">
                    {settings.model}
                  </Badge>
                )}
              </div>
              {models.length > 8 && (
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    dir="ltr"
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    placeholder="Search models..."
                    className="rounded-xl pr-9 text-xs"
                  />
                </div>
              )}
              <div className="nice-scroll max-h-56 space-y-1 overflow-y-auto pl-1">
                {filteredModels.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setSettings({ ...settings, model: m.id })}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-right text-xs transition ${
                      settings.model === m.id
                        ? "bg-primary text-primary-foreground font-bold"
                        : "hover:bg-muted"
                    }`}
                  >
                    <span dir="ltr" className="truncate">{m.id}</span>
                    {settings.model === m.id && <CheckCircle2 className="h-4 w-4 shrink-0" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* advanced */}
      <Card className="gap-0 rounded-2xl">
        <CardHeader className="border-b py-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5 text-gold" />
            تنظیمات پیشرفته رفتار هوش نخل
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 p-4">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <Label className="font-bold">خلاقیت (Temperature)</Label>
                <Badge variant="secondary">{settings.temperature.toFixed(1)}</Badge>
              </div>
              <Slider
                dir="ltr"
                min={0}
                max={2}
                step={0.1}
                value={[settings.temperature]}
                onValueChange={([v]) => setSettings({ ...settings, temperature: v })}
              />
              <p className="text-[10px] text-muted-foreground">کمتر = پاسخ‌های دقیق‌تر | بیشتر = خلاقانه‌تر</p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <Label className="font-bold">حداکثر توکن پاسخ</Label>
                <Badge variant="secondary">{settings.maxTokens}</Badge>
              </div>
              <Slider
                dir="ltr"
                min={200}
                max={4000}
                step={100}
                value={[settings.maxTokens]}
                onValueChange={([v]) => setSettings({ ...settings, maxTokens: v })}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <Label className="font-bold">Top P</Label>
                <Badge variant="secondary">{settings.topP.toFixed(2)}</Badge>
              </div>
              <Slider
                dir="ltr"
                min={0.1}
                max={1}
                step={0.05}
                value={[settings.topP]}
                onValueChange={([v]) => setSettings({ ...settings, topP: v })}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <Label className="font-bold">تعداد پیام در حافظه گفتگو</Label>
                <Badge variant="secondary">{settings.maxHistoryMessages}</Badge>
              </div>
              <Slider
                dir="ltr"
                min={4}
                max={40}
                step={2}
                value={[settings.maxHistoryMessages]}
                onValueChange={([v]) => setSettings({ ...settings, maxHistoryMessages: v })}
              />
              <p className="text-[10px] text-muted-foreground">پیام‌های قدیمی‌تر برای صرفه‌جویی توکن حذف می‌شوند</p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <Label className="font-bold">مهلت پاسخ مدل (ثانیه)</Label>
                <Badge variant="secondary">{settings.requestTimeout}</Badge>
              </div>
              <Slider
                dir="ltr"
                min={15}
                max={180}
                step={5}
                value={[settings.requestTimeout]}
                onValueChange={([v]) => setSettings({ ...settings, requestTimeout: v })}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <Label className="font-bold">حداکثر آیتم هر سفارش</Label>
                <Badge variant="secondary">{settings.maxItemsPerOrder}</Badge>
              </div>
              <Slider
                dir="ltr"
                min={5}
                max={50}
                step={1}
                value={[settings.maxItemsPerOrder]}
                onValueChange={([v]) => setSettings({ ...settings, maxItemsPerOrder: v })}
              />
            </div>
          </div>

          {/* behaviors */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="flex items-center justify-between rounded-xl border p-3.5">
              <div>
                <Label className="text-sm font-bold">لحن دوستانه</Label>
                <p className="text-[11px] text-muted-foreground">گفتگو صمیمی مثل یک رفیق</p>
              </div>
              <Switch
                checked={settings.friendlyTone}
                onCheckedChange={(v) => setSettings({ ...settings, friendlyTone: v })}
              />
            </div>
            <div className="flex items-center justify-between rounded-xl border p-3.5">
              <div>
                <Label className="text-sm font-bold">پیشنهاد پرفروش‌ها</Label>
                <p className="text-[11px] text-muted-foreground">معرفی غذاهای ویژه</p>
              </div>
              <Switch
                checked={settings.suggestBestSellers}
                onCheckedChange={(v) => setSettings({ ...settings, suggestBestSellers: v })}
              />
            </div>
            <div className="flex items-center justify-between rounded-xl border p-3.5">
              <div>
                <Label className="text-sm font-bold">گفتگوی آزاد</Label>
                <p className="text-[11px] text-muted-foreground">پاسخ به سوالات متفرقه</p>
              </div>
              <Switch
                checked={settings.allowSmallTalk}
                onCheckedChange={(v) => setSettings({ ...settings, allowSmallTalk: v })}
              />
            </div>
          </div>

          {/* system prompt extra */}
          <div className="space-y-1.5">
            <Label>دستورالعمل‌های ویژه هوش نخل (System Prompt اضافه)</Label>
            <Textarea
              value={settings.systemPromptExtra}
              onChange={(e) => setSettings({ ...settings, systemPromptExtra: e.target.value })}
              rows={4}
              className="rounded-xl text-sm leading-7"
              placeholder="مثلاً: اگر مشتری کلمه «تخفیف» گفت، کد تخفیف NAKHL10 را به او معرفی کن..."
            />
            <p className="text-[11px] leading-5 text-muted-foreground">
              این متن با اولویت بالا به پرامپت سیستمی هوش نخل اضافه می‌شود. پرامپت اصلی (منو، قیمت‌ها و مراحل
              سفارش) به‌صورت خودکار و امن از دیتابیس ساخته می‌شود و نیاز به دستکاری ندارد.
            </p>
          </div>
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving} size="lg" className="w-full rounded-2xl font-black shadow-lg shadow-primary/25">
        {saving ? <Loader2 className="ml-2 h-5 w-5 animate-spin" /> : <Save className="ml-2 h-5 w-5" />}
        ذخیره تنظیمات هوش مصنوعی
      </Button>
    </div>
  );
}

// ==================== SMS ====================

interface SmsSettings {
  provider: "none" | "melipayamak" | "smsir";
  devMode: boolean;
  otpTemplate: string;
  otpTtlMinutes: number;
  otpLength: number;
  melipayamakAuthType: "apikey" | "password";
  melipayamakApiKey: string;
  melipayamakUsername: string;
  melipayamakPassword: string;
  melipayamakFrom: string;
  melipayamakPatternCode: string;
  smsirApiKey: string;
  smsirFrom: string;
  smsirTemplateId: string;
  smsirOtpParam: string;
}

function SmsSettingsTab() {
  const [settings, setSettings] = useState<SmsSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api<{ settings: SmsSettings }>("/api/admin/settings?group=sms");
    if (res.success) setSettings(res.settings);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetching
    load();
  }, [load]);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    const res = await api("/api/admin/settings", { method: "PUT", body: { group: "sms", values: settings } });
    setSaving(false);
    if (!res.success) return toast.error(res.error ?? "خطا");
    toast.success("تنظیمات پیامک ذخیره شد ✅");
    load();
  };

  const test = async () => {
    if (!settings) return;
    setTesting(true);
    // مقادیر فعلی فرم ارسال می‌شود تا تست قبل از ذخیره هم ممکن باشد؛
    // مقادیر ماسک‌شده (•) در سرور نادیده گرفته می‌شوند و از تنظیمات ذخیره‌شده تکمیل می‌گردند
    const res = await api<{ success: boolean; message: string; devMode?: boolean; credit?: number }>("/api/admin/sms/test", {
      method: "POST",
      body: { values: settings },
    });
    setTesting(false);
    if (res.success) {
      toast.success(res.message ?? "تست انجام شد");
    } else {
      toast.error(res.error ?? "خطا در تست اتصال");
    }
  };

  if (loading || !settings) return <Skeleton className="h-96 rounded-2xl" />;

  return (
    <div className="space-y-4">
      <Card className="gap-0 rounded-2xl">
        <CardHeader className="border-b py-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-5 w-5 text-primary" />
            پنل پیامکی
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              { v: "none", t: "بدون پنل (توسعه)", d: "کد در صفحه نمایش داده می‌شود" },
              { v: "melipayamak", t: "ملی‌پیامک", d: "melipayamak.com" },
              { v: "smsir", t: "SMS.IR", d: "sms.ir" },
            ].map((p) => (
              <button
                key={p.v}
                onClick={() => setSettings({ ...settings, provider: p.v as SmsSettings["provider"] })}
                className={`rounded-2xl border-2 p-3.5 text-right transition ${
                  settings.provider === p.v ? "border-primary bg-primary/5 shadow-md" : "hover:border-primary/40"
                }`}
              >
                <div className="text-sm font-extrabold">{p.t}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{p.d}</div>
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5">
            <div>
              <Label className="text-sm font-bold">حالت توسعه (Dev Mode)</Label>
              <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
                وقتی فعال باشد، کد تأیید به‌جای پیامک در صفحه ورود نمایش داده می‌شود — مناسب تست
              </p>
            </div>
            <Switch checked={settings.devMode} onCheckedChange={(v) => setSettings({ ...settings, devMode: v })} />
          </div>

          {/* OTP config */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>طول کد تأیید</Label>
              <Select
                value={String(settings.otpLength)}
                onValueChange={(v) => setSettings({ ...settings, otpLength: Number(v) })}
              >
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[4, 5, 6].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n} رقم</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>مدت اعتبار کد (دقیقه)</Label>
              <Input
                dir="ltr"
                type="number"
                min={1}
                max={15}
                value={settings.otpTtlMinutes}
                onChange={(e) => setSettings({ ...settings, otpTtlMinutes: Number(e.target.value) || 3 })}
                className="rounded-xl"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>متن پیامک کد تأیید</Label>
            <Textarea
              value={settings.otpTemplate}
              onChange={(e) => setSettings({ ...settings, otpTemplate: e.target.value })}
              rows={3}
              className="rounded-xl text-sm leading-7"
            />
            <p className="text-[11px] text-muted-foreground">
              متغیرها: {"{code}"} = کد تأیید، {"{ttl}"} = مدت اعتبار
            </p>
          </div>

          {/* Melipayamak */}
          {settings.provider === "melipayamak" && (
            <div className="space-y-4 rounded-2xl border p-4">
              <div className="text-sm font-extrabold text-primary">تنظیمات ملی‌پیامک</div>
              <div className="space-y-1.5">
                <Label>نوع احراز هویت</Label>
                <Select
                  value={settings.melipayamakAuthType}
                  onValueChange={(v) => setSettings({ ...settings, melipayamakAuthType: v as SmsSettings["melipayamakAuthType"] })}
                >
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="apikey">کلید API (پنل جدید console.melipayamak.com)</SelectItem>
                    <SelectItem value="password">نام کاربری/رمز (پنل قدیمی rest.payamak-panel.com)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {settings.melipayamakAuthType === "apikey" ? (
                <div className="space-y-1.5">
                  <Label>کلید API</Label>
                  <Input dir="ltr" type="password" value={settings.melipayamakApiKey} onChange={(e) => setSettings({ ...settings, melipayamakApiKey: e.target.value })} className="rounded-xl" placeholder="مثال: kp_9f8e7d6c..." />
                  <p className="text-[11px] leading-5 text-muted-foreground">
                    کلید کنسول را بسازید: <span dir="ltr">console.melipayamak.com</span> ← بخش «کلیدها» ← افزودن کلید؛ سپس کلید را همین‌جا ذخیره کنید.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>نام کاربری پنل</Label>
                    <Input dir="ltr" value={settings.melipayamakUsername} onChange={(e) => setSettings({ ...settings, melipayamakUsername: e.target.value })} className="rounded-xl" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>رمز عبور پنل</Label>
                    <Input dir="ltr" type="password" value={settings.melipayamakPassword} onChange={(e) => setSettings({ ...settings, melipayamakPassword: e.target.value })} className="rounded-xl" />
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>شماره فرستنده (From)</Label>
                <Input dir="ltr" value={settings.melipayamakFrom} onChange={(e) => setSettings({ ...settings, melipayamakFrom: e.target.value })} className="rounded-xl" placeholder="5000... یا 3000..." />
                <p className="text-[11px] leading-5 text-muted-foreground">
                  شماره خط اختصاصی پنل (الزامی برای ارسال ساده) — بدون آن ارسال با کلید API انجام نمی‌شود.
                </p>
              </div>
              <div className="space-y-1.5 rounded-xl border border-emerald-600/25 bg-emerald-500/5 p-3">
                <Label>کد پترن خدماتی — ارسال کد یکبارمصرف (اختیاری)</Label>
                <Input
                  dir="ltr"
                  inputMode="numeric"
                  value={settings.melipayamakPatternCode}
                  onChange={(e) => setSettings({ ...settings, melipayamakPatternCode: e.target.value.replace(/\D/g, "") })}
                  className="rounded-xl"
                  placeholder="مثال: 254"
                />
                <p className="text-[11px] leading-5 text-muted-foreground">
                  روش توصیه‌شدهٔ ملی‌پیامک برای پیامک یکبارمصرف: ابتدا در پنل ملی‌پیامک (بخش «پترن / متون پیش‌فرض»)
                  پترنی با <b>دقیقاً یک متغیر</b> بسازید (مثال: <span dir="ltr">کد تأیید شما: %0</span>) و پس از تأیید،
                  «کد پترن» را اینجا وارد کنید. ارسال از <b>خط خدماتی اشتراکی</b> انجام می‌شود و حتی به شماره‌های
                  لیست‌سیاه مخابرات هم تحویل می‌گردد. اگر خالی بماند، ارسال ساده از خط اختصاصی انجام می‌شود و
                  «متن پیامک کد تأیید» بالا استفاده خواهد شد (در حالت پترن، متن از خود پنل ملی‌پیامک خوانده می‌شود).
                </p>
              </div>
            </div>
          )}

          {/* SMS.IR */}
          {settings.provider === "smsir" && (
            <div className="space-y-4 rounded-2xl border p-4">
              <div className="text-sm font-extrabold text-primary">تنظیمات SMS.IR</div>
              <div className="space-y-1.5">
                <Label>کلید API (x-api-key)</Label>
                <Input dir="ltr" type="password" value={settings.smsirApiKey} onChange={(e) => setSettings({ ...settings, smsirApiKey: e.target.value })} className="rounded-xl" placeholder="از پنل sms.ir → کلیدهای API" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>شماره خط فرستنده (اختیاری)</Label>
                  <Input dir="ltr" value={settings.smsirFrom} onChange={(e) => setSettings({ ...settings, smsirFrom: e.target.value })} className="rounded-xl" placeholder="3000..." />
                </div>
                <div className="space-y-1.5">
                  <Label>شناسه قالب تأیید (اختیاری)</Label>
                  <Input dir="ltr" value={settings.smsirTemplateId} onChange={(e) => setSettings({ ...settings, smsirTemplateId: e.target.value.replace(/\D/g, "") })} className="rounded-xl" placeholder="مثلاً 100000" />
                </div>
              </div>
              {settings.smsirTemplateId && (
                <div className="space-y-1.5">
                  <Label>نام پارامتر کد در قالب</Label>
                  <Input dir="ltr" value={settings.smsirOtpParam} onChange={(e) => setSettings({ ...settings, smsirOtpParam: e.target.value })} className="rounded-xl" placeholder="CODE" />
                  <p className="text-[11px] text-muted-foreground">
                    اگر قالب تأیید تنظیم شود، از سرویس Verify اختصاصی SMS.IR (بهینه برای کد یکبارمصرف) استفاده می‌شود؛
                    در غیر این صورت ارسال Rapid انجام می‌شود.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={save} disabled={saving} className="flex-1 rounded-xl font-bold">
              {saving ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Save className="ml-2 h-4 w-4" />}
              ذخیره تنظیمات پیامک
            </Button>
            <Button onClick={test} disabled={testing} variant="outline" className="rounded-xl font-bold">
              {testing ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Plug className="ml-2 h-4 w-4" />}
              تست اتصال
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ==================== Payment ====================

interface PaymentSettings {
  merchantId: string;
  sandbox: boolean;
  simulationMode: boolean;
  currency: string;
  description: string;
  callbackUrl: string;
}

function PaymentSettingsTab() {
  const [settings, setSettings] = useState<PaymentSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await api<{ settings: PaymentSettings }>("/api/admin/settings?group=payment");
      if (res.success) setSettings(res.settings);
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    const res = await api("/api/admin/settings", { method: "PUT", body: { group: "payment", values: settings } });
    setSaving(false);
    if (!res.success) return toast.error(res.error ?? "خطا");
    toast.success("تنظیمات درگاه پرداخت ذخیره شد ✅");
  };

  if (loading || !settings) return <Skeleton className="h-72 rounded-2xl" />;

  return (
    <Card className="gap-0 rounded-2xl">
      <CardHeader className="border-b py-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard className="h-5 w-5 text-primary" />
          درگاه پرداخت زرین‌پال
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <div className="space-y-1.5">
          <Label>مرچنت‌آیدی زرین‌پال</Label>
          <Input
            dir="ltr"
            type="password"
            value={settings.merchantId}
            onChange={(e) => setSettings({ ...settings, merchantId: e.target.value })}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            className="rounded-xl"
          />
          <p className="text-[11px] text-muted-foreground">
            از پنل زرین‌پال → درگاه‌ها → مرچنت‌آیدی را کپی کنید
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-xl border p-3.5">
            <div>
              <Label className="text-sm font-bold">حالت Sandbox</Label>
              <p className="mt-0.5 text-[11px] text-muted-foreground">اتصال به محیط آزمایشی زرین‌پال</p>
            </div>
            <Switch checked={settings.sandbox} onCheckedChange={(v) => setSettings({ ...settings, sandbox: v })} />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5">
            <div>
              <Label className="text-sm font-bold">درگاه شبیه‌سازی‌شده</Label>
              <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
                پرداخت داخل سامانه شبیه‌سازی می‌شود (برای دمو قبل از دریافت مرچنت)
              </p>
            </div>
            <Switch checked={settings.simulationMode} onCheckedChange={(v) => setSettings({ ...settings, simulationMode: v })} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>توضیحات تراکنش</Label>
          <Input
            value={settings.description}
            onChange={(e) => setSettings({ ...settings, description: e.target.value })}
            className="rounded-xl"
          />
        </div>

        <div className="space-y-1.5">
          <Label>آدرس بازگشت (Callback URL) — اختیاری</Label>
          <Input
            dir="ltr"
            value={settings.callbackUrl}
            onChange={(e) => setSettings({ ...settings, callbackUrl: e.target.value })}
            placeholder="https://your-domain.com/api/payment/callback"
            className="rounded-xl"
          />
          <p className="text-[11px] leading-5 text-muted-foreground">
            اگر خالی باشد، به‌صورت خودکار از دامنه فعلی استفاده می‌شود. حتماً در پنل زرین‌پال نیز همین آدرس را ثبت کنید.
          </p>
        </div>

        <Button onClick={save} disabled={saving} className="w-full rounded-xl font-bold">
          {saving ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Save className="ml-2 h-4 w-4" />}
          ذخیره تنظیمات پرداخت
        </Button>
      </CardContent>
    </Card>
  );
}

// ==================== General ====================

interface GeneralSettings {
  restaurantName: string;
  restaurantTagline: string;
  address: string;
  phone: string;
  email: string;
  /** متن نمایشی — از businessHours مشتق می‌شود؛ دیگر مستقیم ویرایش نمی‌شود */
  workingHours: string;
  businessHours: BusinessHours;
  taxPercent: number;
  deliveryFee: number;
  minOrderAmount: number;
  freeDeliveryOver: number;
  city: string;
  instagram: string;
  telegram: string;
  aboutText: string;
}

/** تایم‌پیکر HH:MM — دو دراپ‌داون ساعت/دقیقه با ارقام فارسی */
function TimePicker({
  value,
  onChange,
  allowMidnightEnd = false,
  disabled = false,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  allowMidnightEnd?: boolean;
  disabled?: boolean;
  label: string;
}) {
  const [h, m] = value.split(":");
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  if (allowMidnightEnd) hours.push("24");
  const minutes = h === "24" ? ["00"] : ["00", "15", "30", "45"];
  const setHour = (nh: string) => onChange(nh === "24" ? "24:00" : `${nh}:${m}`);
  const setMinute = (nm: string) => onChange(`${h}:${nm}`);

  return (
    <div dir="ltr" className="flex items-center gap-1.5" role="group" aria-label={label}>
      <Select value={h} onValueChange={setHour} disabled={disabled}>
        <SelectTrigger className="w-[4.25rem] rounded-xl font-bold" aria-label={`${label} — ساعت`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {hours.map((hh) => (
            <SelectItem key={hh} value={hh} className="justify-center font-bold">
              {toPersianDigits(hh)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="select-none font-black text-muted-foreground">:</span>
      <Select value={m} onValueChange={setMinute} disabled={disabled || h === "24"}>
        <SelectTrigger className="w-[4.25rem] rounded-xl font-bold" aria-label={`${label} — دقیقه`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {minutes.map((mm) => (
            <SelectItem key={mm} value={mm} className="justify-center font-bold">
              {toPersianDigits(mm)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** ویرایشگر ساعات کاری — دو بازهٔ ناهار/شام با تایم‌پیکر + وضعیت زنده */
function BusinessHoursEditor({
  hours,
  onChange,
}: {
  hours: BusinessHours;
  onChange: (h: BusinessHours) => void;
}) {
  // تیک ۳۰ ثانیه‌ای تا بج «الان باز/بسته» وقتی پنل باز است تازه بماند
  const [nowMin, setNowMin] = useState(() => nowMinutesInRestaurantTz());
  useEffect(() => {
    const t = window.setInterval(() => setNowMin(nowMinutesInRestaurantTz()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const status = openStatusText(hours, nowMin);
  const periodMeta: { key: PeriodKey; title: string; icon: typeof Sun; hint: string }[] = [
    { key: "lunch", title: "سرویس ناهار", icon: Sun, hint: "مثلاً ۱۲:۰۰ تا ۱۶:۰۰" },
    { key: "dinner", title: "سرویس شام", icon: Moon, hint: "مثلاً ۱۹:۰۰ تا ۲۴:۰۰" },
  ];

  const setPeriod = (key: PeriodKey, patch: Partial<HoursPeriod>) =>
    onChange({ ...hours, [key]: { ...hours[key], ...patch } });

  return (
    <div className="space-y-3 rounded-2xl border bg-muted/20 p-4">
      {/* وضعیت لحظه‌ای */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black ${
            status.open
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
              : "bg-rose-500/15 text-rose-700 dark:text-rose-400"
          }`}
        >
          <Clock3 className="h-3.5 w-3.5" />
          {status.label} — {status.detail}
        </span>
        <span className="text-[11px] font-bold text-muted-foreground">
          {describeBusinessHours(hours)} <span className="font-normal">(به وقت ایران)</span>
        </span>
      </div>

      {periodMeta.map(({ key, title, icon: Icon, hint }) => {
        const p = hours[key];
        const openMin = parseHHMM(p.open);
        const closeMin = parseHHMM(p.close);
        const crossesMidnight =
          openMin !== null && closeMin !== null && closeMin < openMin;
        return (
          <div
            key={key}
            className={`rounded-xl border bg-card p-3 transition-opacity ${
              p.enabled ? "" : "opacity-55"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-extrabold">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                    key === "lunch"
                      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      : "bg-indigo-500/10 text-slate-600 dark:text-slate-300"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                {title}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-muted-foreground">
                  {p.enabled ? "پذیرش سفارش فعال" : "غیرفعال"}
                </span>
                <Switch
                  checked={p.enabled}
                  onCheckedChange={(v) => setPeriod(key, { enabled: v })}
                  aria-label={`${p.enabled ? "غیرفعال‌سازی" : "فعال‌سازی"} ${title}`}
                />
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">ساعت شروع</Label>
                <TimePicker
                  value={p.open}
                  onChange={(v) => setPeriod(key, { open: v })}
                  disabled={!p.enabled}
                  label={`شروع ${title}`}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">ساعت پایان</Label>
                <TimePicker
                  value={p.close}
                  onChange={(v) => setPeriod(key, { close: v })}
                  allowMidnightEnd
                  disabled={!p.enabled}
                  label={`پایان ${title}`}
                />
              </div>
            </div>
            <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
              {crossesMidnight
                ? "⏰ پایان کوچک‌تر از شروع است — این بازه از نیمه‌شب عبور می‌کند و تا روز بعد ادامه می‌یابد."
                : `حداقل و حداکثر منطقی: ${hint}`}
            </p>
          </div>
        );
      })}

      <p className="text-[10px] leading-5 text-muted-foreground">
        خارج از این بازه‌ها، ثبت و پرداخت سفارش در سایت و گفتگوی هوش نخل به‌صورت خودکار غیرفعال می‌شود و
        پیام «رستوران الان بسته است» با ساعت باز شدن نمایش داده می‌شود. «۲۴:۰۰» یعنی نیمه‌شب.
      </p>
    </div>
  );
}

function GeneralSettingsTab() {
  const [settings, setSettings] = useState<GeneralSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await api<{ settings: GeneralSettings }>("/api/admin/settings?group=general");
      if (res.success) setSettings(res.settings);
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    // متن نمایشی همیشه از بازه‌های ساختاریافته مشتق می‌شود (تطابق DB با آنچه سایت می‌بیند)
    const values = { ...settings, workingHours: describeBusinessHours(settings.businessHours) };
    const res = await api("/api/admin/settings", { method: "PUT", body: { group: "general", values } });
    setSaving(false);
    if (!res.success) return toast.error(res.error ?? "خطا");
    toast.success("تنظیمات عمومی ذخیره شد ✅");
  };

  if (loading || !settings) return <Skeleton className="h-96 rounded-2xl" />;

  return (
    <Card className="gap-0 rounded-2xl">
      <CardHeader className="border-b py-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Store className="h-5 w-5 text-primary" />
          اطلاعات رستوران و قواعد سفارش
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>نام رستوران</Label>
            <Input value={settings.restaurantName} onChange={(e) => setSettings({ ...settings, restaurantName: e.target.value })} className="rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <Label>شعار</Label>
            <Input value={settings.restaurantTagline} onChange={(e) => setSettings({ ...settings, restaurantTagline: e.target.value })} className="rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <Label>شهر</Label>
            <Input value={settings.city} onChange={(e) => setSettings({ ...settings, city: e.target.value })} className="rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <Label>تلفن</Label>
            <Input dir="ltr" value={settings.phone} onChange={(e) => setSettings({ ...settings, phone: e.target.value })} className="rounded-xl" placeholder="03434300000" />
          </div>
          <div className="space-y-1.5">
            <Label>ایمیل (اختیاری)</Label>
            <Input dir="ltr" value={settings.email} onChange={(e) => setSettings({ ...settings, email: e.target.value })} className="rounded-xl" placeholder="info@example.com" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>آدرس</Label>
            <Input value={settings.address} onChange={(e) => setSettings({ ...settings, address: e.target.value })} className="rounded-xl" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <div className="flex items-center justify-between">
              <Label>ساعات کاری و پذیرش سفارش (ناهار / شام)</Label>
              <span className="text-[10px] font-bold text-muted-foreground">متن نمایشی مشتری‌ها: خودکار ساخته می‌شود</span>
            </div>
            <BusinessHoursEditor
              hours={settings.businessHours}
              onChange={(businessHours) => setSettings({ ...settings, businessHours })}
            />
            <p className="text-[10px] leading-4 text-muted-foreground">
              این بازه‌ها به‌صورت زنده در <b className="text-foreground">بج «الان باز/بسته» هدر، فوتر و بخش «تماس با ما»</b> سایت اعمال می‌شوند و خارج از آن‌ها سفارش‌گیری قفل می‌شود.
            </p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <div className="flex items-center justify-between">
              <Label>شیفت‌بندی منو — غذاهای «فقط شیفت شب»</Label>
              <span className="text-[10px] font-bold text-muted-foreground">بر اساس ساعات شام بالا اعمال می‌شود</span>
            </div>
            <DinnerOnlyCategoriesEditor businessHours={settings.businessHours} />
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-xl border border-primary/25 bg-primary/5 p-3 text-[11px] leading-5 text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>
            این اطلاعات به‌صورت زنده در <b className="text-foreground">هدر، فوتر و بخش «تماس با ما»</b> سایت نمایش داده می‌شود — هر تغییر و ذخیره، بلافاصله در نمای مشتری اعمال می‌شود.
          </span>
        </div>

        <div className="rounded-2xl border p-4">
          <div className="mb-3 flex items-center gap-1.5 text-sm font-extrabold text-primary">
            <Info className="h-4 w-4" />
            قواعد مالی سفارش (هوش نخل از همین مقادیر فاکتور می‌سازد)
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label>درصد مالیات ارزش افزوده</Label>
              <Input dir="ltr" type="number" min={0} max={30} value={settings.taxPercent} onChange={(e) => setSettings({ ...settings, taxPercent: Number(e.target.value) || 0 })} className="rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label>هزینه پیک (تومان)</Label>
              <Input dir="ltr" value={settings.deliveryFee} onChange={(e) => setSettings({ ...settings, deliveryFee: Number(e.target.value.replace(/\D/g, "")) || 0 })} className="rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label>حداقل مبلغ سفارش</Label>
              <Input dir="ltr" value={settings.minOrderAmount} onChange={(e) => setSettings({ ...settings, minOrderAmount: Number(e.target.value.replace(/\D/g, "")) || 0 })} className="rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label>ارسال رایگان بالای (تومان)</Label>
              <Input dir="ltr" value={settings.freeDeliveryOver} onChange={(e) => setSettings({ ...settings, freeDeliveryOver: Number(e.target.value.replace(/\D/g, "")) || 0 })} className="rounded-xl" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>اینستاگرام (بدون @)</Label>
            <Input dir="ltr" value={settings.instagram} onChange={(e) => setSettings({ ...settings, instagram: e.target.value })} className="rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <Label>تلگرام (بدون @)</Label>
            <Input dir="ltr" value={settings.telegram} onChange={(e) => setSettings({ ...settings, telegram: e.target.value })} className="rounded-xl" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>درباره رستوران</Label>
          <Textarea value={settings.aboutText} onChange={(e) => setSettings({ ...settings, aboutText: e.target.value })} rows={3} className="rounded-xl" />
        </div>

        <Button onClick={save} disabled={saving} className="w-full rounded-xl font-bold">
          {saving ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Save className="ml-2 h-4 w-4" />}
          ذخیره تنظیمات عمومی
        </Button>
      </CardContent>
    </Card>
  );
}

// ==================== Dinner-only shift categories (شیفت‌بندی منو) ====================

interface AdminCategoryRow {
  id: string;
  name: string;
  icon?: string | null;
  itemsCount: number;
  isActive: boolean;
  dinnerOnly: boolean;
}

/**
 * انتخاب دسته‌های «فقط شیفت شب» — غذاهای دسته‌های انتخاب‌شده فقط در سرویس شام
 * قابل سفارش‌اند؛ در شیفت ناهار (یا خارج از ساعات کاری) سایت و هوش نخل آن‌ها را
 * با پیام «فقط در شیفت شب قابل سفارش است» مسدود می‌کنند.
 */
function DinnerOnlyCategoriesEditor({ businessHours }: { businessHours: BusinessHours }) {
  const [cats, setCats] = useState<AdminCategoryRow[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await api<{ categories: AdminCategoryRow[] }>("/api/admin/categories");
      if (res.success && Array.isArray(res.categories)) {
        setCats(res.categories);
        setSelected(new Set(res.categories.filter((c) => c.dinnerOnly).map((c) => c.id)));
      } else {
        setCats([]);
      }
    })();
  }, []);

  // وضعیت زندهٔ شیفت فعلی (به وقت ایران، هر ۳۰ ثانیه) — nowMin state + derive
  const [nowMin, setNowMin] = useState(() => nowMinutesInRestaurantTz());
  useEffect(() => {
    const t = window.setInterval(() => setNowMin(nowMinutesInRestaurantTz()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const openStatus = openStatusText(businessHours, nowMin);
  const dinnerActive = isDinnerShiftNow(businessHours, nowMin);

  const toggle = (id: string) => {
    setDirty(true);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    const res = await api<{ message?: string }>("/api/admin/categories/shifts", {
      method: "PUT",
      body: { dinnerOnlyIds: [...selected] },
    });
    setSaving(false);
    if (!res.success) return toast.error(res.error ?? "خطا در ذخیره شیفت‌بندی منو");
    setDirty(false);
    toast.success(res.message ?? "شیفت‌بندی منو ذخیره شد ✅");
  };

  if (cats === null) return <Skeleton className="h-44 rounded-2xl" />;

  const selectedCount = selected.size;
  const blockedItemCount = cats.filter((c) => selected.has(c.id)).reduce((s, c) => s + c.itemsCount, 0);

  return (
    <div className="rounded-2xl border border-gold/30 bg-gold/5 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-extrabold">
          <Moon className="h-4.5 w-4.5 text-gold" />
          شیفت‌بندی منو — دسته‌های «فقط شیفت شب»
        </div>
        <span
          role="status"
          className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black ${
            dinnerActive
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
              : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
          }`}
          title={`${openStatus.label} — ${openStatus.detail} (به وقت ایران)`}
        >
          {dinnerActive ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
          {dinnerActive
            ? "شیفت فعلی: شام — آیتم‌های شب فعال‌اند"
            : openStatus.open
              ? "شیفت فعلی: ناهار — آیتم‌های شب قفل‌اند"
              : "رستوران بسته — آیتم‌های شب قفل‌اند"}
        </span>
      </div>

      <p className="mb-3 text-[11px] leading-5 text-muted-foreground">
        غذاهای دسته‌های انتخاب‌شده <b className="text-foreground">فقط در سرویس شام</b> قابل سفارش‌اند؛ در شیفت ناهار،
        سایت و هوش نخل آن‌ها را با پیام «این غذا فقط در شیفت شب قابل سفارش است» مسدود می‌کنند. دسته‌های دیگر در هر دو شیفت فعال می‌مانند.
      </p>

      {cats.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-muted-foreground/25 px-4 py-6 text-center text-xs font-bold text-muted-foreground">
          هنوز دسته‌ای در منو ثبت نشده است — ابتدا از «مدیریت منو» دسته‌بندی بسازید
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {cats.map((c) => {
            const on = selected.has(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c.id)}
                aria-pressed={on}
                title={on ? `غذاهای «${c.name}» فقط در شیفت شب قابل سفارش‌اند` : `غذاهای «${c.name}» در هر دو شیفت قابل سفارش‌اند`}
                className={`flex min-h-16 items-center gap-2.5 rounded-xl border-2 p-3 text-right transition-all active:scale-[0.98] ${
                  on
                    ? "border-gold bg-gold/15 shadow-md shadow-gold/15"
                    : "border-border bg-card hover:border-gold/40"
                }`}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors ${
                    on ? "bg-slate-800 text-white dark:bg-slate-700" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {on ? <Moon className="h-4.5 w-4.5" /> : <CategoryIcon icon={c.icon} className="h-4.5 w-4.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-xs font-extrabold ${on ? "text-gold-foreground" : ""}`}>
                    {c.name}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    {toPersianDigits(c.itemsCount)} قلم
                    {!c.isActive && " • غیرفعال"}
                  </span>
                </span>
                {on && <CheckCircle2 className="h-4 w-4 shrink-0 text-gold" />}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-bold text-muted-foreground">
          {selectedCount > 0
            ? `${toPersianDigits(selectedCount)} دسته انتخاب شده — ${toPersianDigits(blockedItemCount)} غذا فقط در شیفت شب`
            : "هیچ دسته‌ای انتخاب نشده — کل منو در هر دو شیفت فعال است"}
        </span>
        <Button onClick={save} disabled={saving || !dirty} size="sm" className="rounded-xl px-5 font-bold">
          {saving ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Save className="ml-2 h-4 w-4" />}
          ذخیره شیفت‌بندی منو
        </Button>
      </div>
    </div>
  );
}

// ==================== Main ====================

export function AdminSettings() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-black">تنظیمات سامانه</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          پیکربندی هوش مصنوعی، پنل پیامک، درگاه پرداخت و اطلاعات رستوران
        </p>
      </div>
      <Tabs defaultValue="ai" dir="rtl">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 rounded-2xl bg-muted/60 p-1.5">
          <TabsTrigger value="ai" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Bot className="h-4 w-4" /> هوش مصنوعی
          </TabsTrigger>
          <TabsTrigger value="sms" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <MessageSquare className="h-4 w-4" /> پیامک
          </TabsTrigger>
          <TabsTrigger value="payment" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <CreditCard className="h-4 w-4" /> پرداخت
          </TabsTrigger>
          <TabsTrigger value="general" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Store className="h-4 w-4" /> عمومی
          </TabsTrigger>
        </TabsList>
        <TabsContent value="ai" className="mt-4"><AiSettingsTab /></TabsContent>
        <TabsContent value="sms" className="mt-4"><SmsSettingsTab /></TabsContent>
        <TabsContent value="payment" className="mt-4"><PaymentSettingsTab /></TabsContent>
        <TabsContent value="general" className="mt-4"><GeneralSettingsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
