"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { useAppStore, EMPTY_DIETARY_PREFS, type AppUser, type DietaryPrefs, type FavoriteItem } from "@/lib/store";
import { useCartStore } from "@/lib/cart-store";
import { api } from "@/lib/client-api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  User,
  Phone,
  Calendar,
  Mail,
  MapPin,
  Camera,
  Loader2,
  Check,
  Pencil,
  Trash2,
  Star,
  Plus,
  IdCard,
  Heart,
  ShoppingCart,
  Salad,
  Leaf,
  Flame,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { formatPhone, formatJalali, toPersianDigits, formatToman } from "@/lib/fa";

interface AddressRow {
  id: string;
  title: string;
  fullAddress: string;
  postalCode: string | null;
  isDefault: boolean;
}

export function ProfileView() {
  const user = useAppStore((s) => s.user);
  const refreshUser = useAppStore((s) => s.refreshUser);
  const setUser = useAppStore((s) => s.setUser);
  const refreshFavorites = useAppStore((s) => s.refreshFavorites);
  const setView = useAppStore((s) => s.setView);
  const favorites = useAppStore((s) => s.favorites);
  const toggleFavorite = useAppStore((s) => s.toggleFavorite);
  const addItem = useCartStore((s) => s.addItem);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    firstName: "", lastName: "", nationalId: "", birthDate: "", gender: "", email: "",
  });
  const [addresses, setAddresses] = useState<AddressRow[]>([]);
  const [newAddress, setNewAddress] = useState({ title: "", fullAddress: "", postalCode: "" });
  const [addingAddress, setAddingAddress] = useState(false);

  const [prefsForm, setPrefsForm] = useState<DietaryPrefs>(EMPTY_DIETARY_PREFS);
  const [prefsSaving, setPrefsSaving] = useState(false);

  useEffect(() => {
    if (user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync form state with loaded user
      setForm({
        firstName: user.firstName ?? "",
        lastName: user.lastName ?? "",
        nationalId: user.nationalId ?? "",
        birthDate: user.birthDate ? formatJalali(user.birthDate) : "",
        gender: user.gender ?? "",
        email: user.email ?? "",
      });
      setPrefsForm(user.dietaryPrefs ?? EMPTY_DIETARY_PREFS);
      // make sure favorites are loaded (idempotent — store caches results)
      void refreshFavorites();
    }
  }, [user, refreshFavorites]);

  const loadAddresses = async () => {
    const res = await api<{ addresses: AddressRow[] }>("/api/profile/addresses");
    if (res.success) setAddresses(res.addresses ?? []);
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetching
    if (user) loadAddresses();
  }, [user]);

  const uploadAvatar = async (file: File) => {
    setUploading(true);
    setUploadProgress(0);

    // simulate progress until response (fetch has no upload progress)
    const timer = setInterval(() => {
      setUploadProgress((p) => Math.min(90, p + 12));
    }, 200);

    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/profile/avatar", { method: "POST", body: fd });
      const data = await res.json();
      clearInterval(timer);
      if (data.success) {
        setUploadProgress(100);
        await refreshUser();
        toast.success("تصویر پروفایل به‌روزرسانی شد ✨");
      } else {
        toast.error(data.error ?? "خطا در آپلود");
      }
    } catch {
      clearInterval(timer);
      toast.error("خطا در آپلود فایل");
    }
    setTimeout(() => {
      setUploading(false);
      setUploadProgress(0);
    }, 600);
  };

  const saveProfile = async () => {
    setSaving(true);
    const res = await api("/api/profile/profile", {
      method: "PUT",
      body: form,
    });
    setSaving(false);
    if (!res.success) {
      toast.error(res.error ?? "خطا در ذخیره");
      return;
    }
    toast.success("پروفایل ذخیره شد ✅");
    setEditing(false);
    await refreshUser();
  };

  const savePrefs = async () => {
    setPrefsSaving(true);
    const res = await api<{ user: AppUser }>("/api/profile/profile", {
      method: "PUT",
      body: { dietaryPrefs: prefsForm },
    });
    setPrefsSaving(false);
    if (!res.success) {
      toast.error(res.error ?? "خطا در ذخیره ترجیحات");
      return;
    }
    toast.success("ترجیحات غذایی ذخیره شد 🥗");
    if (res.user) setUser(res.user);
    else await refreshUser();
  };

  const addAddress = async () => {
    if (newAddress.title.trim().length < 2 || newAddress.fullAddress.trim().length < 10) {
      toast.error("عنوان و آدرس کامل را وارد کنید");
      return;
    }
    setAddingAddress(true);
    const res = await api("/api/profile/addresses", { body: newAddress });
    setAddingAddress(false);
    if (!res.success) {
      toast.error(res.error ?? "خطا در ذخیره آدرس");
      return;
    }
    setNewAddress({ title: "", fullAddress: "", postalCode: "" });
    toast.success("آدرس ذخیره شد 📍");
    loadAddresses();
  };

  const deleteAddress = async (id: string) => {
    const res = await api(`/api/profile/addresses/${id}`, { method: "DELETE" });
    if (res.success) {
      toast.success("آدرس حذف شد");
      loadAddresses();
    } else toast.error(res.error ?? "خطا");
  };

  const setDefaultAddress = async (id: string) => {
    const res = await api(`/api/profile/addresses/${id}`, { method: "PUT" });
    if (res.success) {
      toast.success("به‌عنوان آدرس پیش‌فرض ذخیره شد ⭐");
      loadAddresses();
    }
  };

  if (!user) return null;

  const initials = `${user.firstName?.[0] ?? "ن"}${user.lastName?.[0] ?? ""}`;

  const savedPrefs = user.dietaryPrefs ?? EMPTY_DIETARY_PREFS;
  const prefsDirty =
    prefsForm.vegetarian !== savedPrefs.vegetarian ||
    prefsForm.avoidSpicy !== savedPrefs.avoidSpicy ||
    prefsForm.allergies !== savedPrefs.allergies ||
    prefsForm.dislikes !== savedPrefs.dislikes;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-black">
        <User className="h-7 w-7 text-primary" />
        پروفایل من
      </h1>

      {/* profile header card */}
      <Card className="mb-6 overflow-hidden rounded-2xl p-0">
        <div className="relative h-28 bg-gradient-to-l from-primary to-gold">
          <div className="palm-pattern absolute inset-0 opacity-20" aria-hidden />
        </div>
        <CardContent className="relative pb-6">
          <div className="-mt-12 flex flex-wrap items-end justify-between gap-4">
            <div className="relative">
              <Avatar className="h-24 w-24 border-4 border-card bg-card shadow-xl">
                {user.avatarUrl ? (
                  <AvatarImage src={user.avatarUrl} alt="تصویر پروفایل" />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-2xl font-black text-primary">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="absolute -bottom-1 -left-1 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:scale-110 disabled:opacity-60"
                aria-label="تغییر تصویر پروفایل"
                title="تغییر تصویر (حداکثر ۵ مگابایت)"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadAvatar(f);
                  e.target.value = "";
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="gap-1">
                <Check className="h-3.5 w-3.5 text-emerald-500" />
                عضو نخل از {formatJalali(user.createdAt)}
              </Badge>
            </div>
          </div>

          {uploading && (
            <div className="mt-4">
              <Progress value={uploadProgress} className="h-2" />
              <p className="mt-1 text-xs text-muted-foreground">در حال آپلود و بهینه‌سازی تصویر...</p>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-extrabold">
                {user.firstName ?? ""} {user.lastName ?? ""}
              </h2>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground" dir="ltr">
                <Phone className="h-4 w-4" />
                {formatPhone(user.phone)}
              </p>
            </div>
            {!editing && (
              <Button variant="outline" onClick={() => setEditing(true)} className="rounded-xl font-bold">
                <Pencil className="ml-2 h-4 w-4" />
                ویرایش اطلاعات
              </Button>
            )}
          </div>

          {editing ? (
            <div className="mt-6 space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>نام</Label>
                  <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label>نام خانوادگی</Label>
                  <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label>کد ملی</Label>
                  <Input dir="ltr" value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.target.value.replace(/[^\d۰-۹]/g, "") })} className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label>تاریخ تولد (شمسی)</Label>
                  <Input placeholder="۱۳۷۵/۰۳/۱۲" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label>جنسیت</Label>
                  <div className="flex gap-1.5">
                    {[
                      { v: "MALE", l: "آقا" },
                      { v: "FEMALE", l: "خانم" },
                      { v: "OTHER", l: "سایر" },
                    ].map((g) => (
                      <button
                        key={g.v}
                        type="button"
                        onClick={() => setForm({ ...form, gender: form.gender === g.v ? "" : g.v })}
                        className={`h-10 flex-1 rounded-xl border text-sm font-semibold transition ${
                          form.gender === g.v ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"
                        }`}
                      >
                        {g.l}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>ایمیل</Label>
                  <Input dir="ltr" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-xl" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={saveProfile} disabled={saving} className="rounded-xl font-bold">
                  {saving ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Check className="ml-2 h-4 w-4" />}
                  ذخیره تغییرات
                </Button>
                <Button variant="outline" onClick={() => setEditing(false)} className="rounded-xl">
                  انصراف
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <InfoRow icon={IdCard} label="کد ملی" value={user.nationalId ? toPersianDigits(user.nationalId) : "ثبت نشده"} />
              <InfoRow icon={Calendar} label="تاریخ تولد" value={user.birthDate ? formatJalali(user.birthDate) : "ثبت نشده"} />
              <InfoRow icon={Mail} label="ایمیل" value={user.email ?? "ثبت نشده"} />
              <InfoRow
                icon={User}
                label="جنسیت"
                value={user.gender === "MALE" ? "آقا" : user.gender === "FEMALE" ? "خانم" : user.gender === "OTHER" ? "سایر" : "ثبت نشده"}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* dietary preferences */}
      <Card className="mb-6 rounded-2xl">
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Salad className="h-5 w-5 text-primary" />
              ترجیحات غذایی من 🥗
            </CardTitle>
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-gold" />
              هوش نخل هنگام پیشنهاد غذا و سفارش این‌ها را لحاظ می‌کند
            </p>
          </div>
          {prefsDirty && (
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold text-amber-600 dark:text-amber-400">
              <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />
              تغییرات ذخیره نشده
            </span>
          )}
        </CardHeader>
        <CardContent>
          {!user.dietaryPrefs && (
            <p className="mb-4 rounded-xl border border-dashed px-3.5 py-2.5 text-xs text-muted-foreground">
              هنوز ترجیحی ثبت نکرده‌اید — با ذخیره این اطلاعات، پیشنهادهای هوش نخل دقیق‌تر می‌شود.
            </p>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/30 px-3.5 py-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                  <Leaf className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold">گیاهی‌خور هستم</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">فقط غذاهای گیاهی پیشنهاد شود</div>
                </div>
              </div>
              <Switch
                checked={prefsForm.vegetarian}
                onCheckedChange={(v) => setPrefsForm({ ...prefsForm, vegetarian: v })}
                aria-label="گیاهی‌خور هستم"
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/30 px-3.5 py-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
                  <Flame className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold">از غذای تند پرهیز می‌کنم</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">غذاهای تند پیشنهاد نشود</div>
                </div>
              </div>
              <Switch
                checked={prefsForm.avoidSpicy}
                onCheckedChange={(v) => setPrefsForm({ ...prefsForm, avoidSpicy: v })}
                aria-label="از غذای تند پرهیز می‌کنم"
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>حساسیت‌های غذایی</Label>
                <span className="text-[10px] text-muted-foreground">
                  {toPersianDigits(prefsForm.allergies.length)}/۲۰۰
                </span>
              </div>
              <Textarea
                placeholder="مثلاً: بادام‌زمینی، گلوتن، لاکتوز..."
                value={prefsForm.allergies}
                onChange={(e) => setPrefsForm({ ...prefsForm, allergies: e.target.value })}
                maxLength={200}
                className="min-h-16 rounded-xl"
                aria-label="حساسیت‌های غذایی"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>غذاهایی که دوست ندارم</Label>
                <span className="text-[10px] text-muted-foreground">
                  {toPersianDigits(prefsForm.dislikes.length)}/۲۰۰
                </span>
              </div>
              <Textarea
                placeholder="مثلاً: بامیه، کرفس..."
                value={prefsForm.dislikes}
                onChange={(e) => setPrefsForm({ ...prefsForm, dislikes: e.target.value })}
                maxLength={200}
                className="min-h-16 rounded-xl"
                aria-label="غذاهایی که دوست ندارم"
              />
            </div>
          </div>

          <Button
            onClick={savePrefs}
            disabled={prefsSaving || !prefsDirty}
            className="mt-4 w-full rounded-xl font-bold"
          >
            {prefsSaving ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Check className="ml-2 h-4 w-4" />}
            ذخیره ترجیحات
          </Button>
        </CardContent>
      </Card>

      {/* favorites */}
      <Card className="mb-6 rounded-2xl">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Heart className="h-5 w-5 text-red-500" />
            موردعلاقه‌های من
          </CardTitle>
          <Badge variant="secondary" className="gap-1 bg-red-500/10 text-red-500">
            <Heart className="h-3.5 w-3.5" />
            {toPersianDigits(favorites.length)}
          </Badge>
        </CardHeader>
        <CardContent>
          {favorites.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-muted-foreground/25 px-6 py-12 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 text-red-500">
                <Heart className="h-8 w-8" />
              </span>
              <p className="max-w-sm text-sm font-bold">
                هنوز هیچ غذایی را به علاقه‌مندی‌هایتان اضافه نکرده‌اید.
              </p>
              <p className="max-w-sm text-xs leading-6 text-muted-foreground">
                به منو بروید و روی قلب هر غذا کلیک کنید تا در اینجا ذخیره شود.
              </p>
              <Button
                onClick={() => {
                  setView("home");
                  window.scrollTo({ top: 0 });
                }}
                className="mt-1 rounded-xl font-bold"
              >
                مشاهده منو
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {favorites.map((fav: FavoriteItem) => (
                <FavoriteRow
                  key={fav.id}
                  fav={fav}
                  onAddToCart={() => {
                    if (!fav.menuItem.isAvailable) {
                      toast.error("این غذا فعلاً ناموجود است");
                      return;
                    }
                    addItem({
                      itemId: fav.menuItem.id,
                      name: fav.menuItem.name,
                      price: fav.menuItem.price,
                      imageUrl: fav.menuItem.imageUrl,
                    });
                    toast.success(`${fav.menuItem.name} به سبد خرید اضافه شد 🛒`);
                  }}
                  onRemove={() => void toggleFavorite(fav.menuItemId)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* addresses */}
      <Card className="rounded-2xl">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <MapPin className="h-5 w-5 text-primary" />
            آدرس‌های من
          </CardTitle>
          <Badge variant="secondary">{toPersianDigits(addresses.length)}/۱۰</Badge>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {addresses.map((addr) => (
              <div key={addr.id} className={`rounded-xl border p-3.5 ${addr.isDefault ? "border-primary/40 bg-primary/5" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-bold">
                      {addr.title}
                      {addr.isDefault && (
                        <Badge className="gap-1 bg-gold/15 text-gold-foreground">
                          <Star className="h-3 w-3 text-gold" />
                          پیش‌فرض
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs leading-6 text-muted-foreground">{addr.fullAddress}</p>
                    {addr.postalCode && (
                      <p className="mt-1 text-[11px] text-muted-foreground" dir="ltr">
                        کد پستی: {toPersianDigits(addr.postalCode)}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {!addr.isDefault && (
                      <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setDefaultAddress(addr.id)} title="پیش‌فرض کن">
                        <Star className="h-4 w-4" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={() => deleteAddress(addr.id)} title="حذف">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}

            <Separator className="my-2" />
            <div className="rounded-xl border border-dashed p-3.5">
              <div className="mb-3 flex items-center gap-1.5 text-sm font-bold">
                <Plus className="h-4 w-4 text-primary" />
                افزودن آدرس جدید
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Input placeholder="عنوان (خانه، محل کار...)" value={newAddress.title} onChange={(e) => setNewAddress({ ...newAddress, title: e.target.value })} className="rounded-xl" />
                <Input placeholder="آدرس کامل" value={newAddress.fullAddress} onChange={(e) => setNewAddress({ ...newAddress, fullAddress: e.target.value })} className="rounded-xl sm:col-span-2" />
                <Input placeholder="کد پستی (اختیاری)" dir="ltr" value={newAddress.postalCode} onChange={(e) => setNewAddress({ ...newAddress, postalCode: e.target.value.replace(/\D/g, "") })} className="rounded-xl" />
                <Button onClick={addAddress} disabled={addingAddress} className="rounded-xl font-bold sm:col-span-2">
                  {addingAddress ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Plus className="ml-2 h-4 w-4" />}
                  ذخیره آدرس
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-muted/30 px-3.5 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4.5 w-4.5" />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className="truncate font-bold">{value}</div>
      </div>
    </div>
  );
}

function FavoriteRow({
  fav,
  onAddToCart,
  onRemove,
}: {
  fav: FavoriteItem;
  onAddToCart: () => void;
  onRemove: () => void;
}) {
  const item = fav.menuItem;
  return (
    <div
      className={`group flex h-full flex-col overflow-hidden rounded-2xl border bg-card transition-all hover:-translate-y-1 ${
        !item.isAvailable ? "opacity-60" : ""
      }`}
    >
      <div className="relative h-36 shrink-0 overflow-hidden">
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={item.name}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover transition duration-500 group-hover:scale-110"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-primary/10 text-4xl">🍽</div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-card/95 to-transparent" />
        {item.isSpecial && (
          <Badge className="absolute right-2.5 top-2.5 rounded-full bg-gold px-2 text-[10px] font-bold text-gold-foreground shadow-sm">
            ★ ویژه
          </Badge>
        )}
        {!item.isAvailable && (
          <Badge className="absolute left-2.5 top-2.5 rounded-full bg-destructive px-2 text-[10px] font-bold text-destructive-foreground shadow-sm">
            ناموجود
          </Badge>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-extrabold leading-7">{item.name}</h3>
          <span className="shrink-0 rounded-lg bg-primary/8 px-2 py-0.5 text-xs font-black text-primary">
            {formatToman(item.price)}
          </span>
        </div>
        {item.description && (
          <p className="mt-1.5 line-clamp-2 text-[11px] leading-[1.8] text-muted-foreground">
            {item.description}
          </p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
          <Button
            onClick={onAddToCart}
            disabled={!item.isAvailable}
            size="sm"
            className="h-9 min-w-32 flex-1 rounded-xl text-xs font-bold shadow-sm"
            aria-label={`افزودن ${item.name} به سبد خرید`}
          >
            <ShoppingCart className="ml-1 h-4 w-4" />
            افزودن به سبد
          </Button>
          <Button
            onClick={onRemove}
            variant="outline"
            size="sm"
            className="h-9 min-w-32 flex-1 rounded-xl text-xs font-bold text-red-500 hover:bg-red-500/10 hover:text-red-600"
            aria-label={`حذف ${item.name} از علاقه‌مندی‌ها`}
            title="حذف از علاقه‌مندی‌ها"
          >
            <Heart className="ml-1 h-4 w-4 fill-red-500" />
            حذف از علاقه‌مندی‌ها
          </Button>
        </div>
      </div>
    </div>
  );
}
