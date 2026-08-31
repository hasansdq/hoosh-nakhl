"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toPersianDigits } from "@/lib/fa";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  ImagePlus,
  Images,
  UtensilsCrossed,
  Search,
  Star,
  PackageX,
  PackageCheck,
  Camera,
  X,
  Leaf,
  Flame,
} from "lucide-react";
import { toast } from "sonner";

interface MenuItemRow {
  id: string;
  name: string;
  description: string | null;
  price: number;
  categoryId: string;
  categoryName: string;
  imageUrl: string | null;
  gallery: string[];
  isAvailable: boolean;
  isSpecial: boolean;
  isDrink: boolean;
  isVegetarian: boolean;
  isSpicy: boolean;
  calories: number | null;
  prepTime: number | null;
  ingredients: string | null;
  sortOrder: number;
  orderCount: number;
}

interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  itemsCount: number;
}

const emptyForm = {
  name: "",
  description: "",
  price: "",
  categoryId: "",
  imageUrl: "",
  gallery: [] as string[],
  isAvailable: true,
  isSpecial: false,
  isDrink: false,
  isVegetarian: false,
  isSpicy: false,
  calories: "",
  prepTime: "",
  ingredients: "",
  sortOrder: "0",
};

export function MenuManager({ initialFilter }: { initialFilter?: string } = {}) {
  const [items, setItems] = useState<MenuItemRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string>("ALL");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MenuItemRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [galleryProgress, setGalleryProgress] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<MenuItemRow | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const galleryFileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [itemsRes, catsRes] = await Promise.all([
      api<{ items: MenuItemRow[] }>("/api/admin/menu"),
      api<{ categories: CategoryRow[] }>("/api/admin/categories"),
    ]);
    if (itemsRes.success) setItems(itemsRes.items ?? []);
    if (catsRes.success) setCategories(catsRes.categories ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // seed the client-side filter from the global Cmd+K palette (e.g. a
    // menu item name picked from search results) — applied AFTER items
    // load via the `filtered` derived list, no extra fetch needed.
    if (initialFilter) {
      setSearch(initialFilter);
    }
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, categoryId: categories[0]?.id ?? "" });
    setDialogOpen(true);
  };

  const openEdit = (item: MenuItemRow) => {
    setEditing(item);
    setForm({
      name: item.name,
      description: item.description ?? "",
      price: String(item.price),
      categoryId: item.categoryId,
      imageUrl: item.imageUrl ?? "",
      gallery: Array.isArray(item.gallery) ? [...item.gallery] : [],
      isAvailable: item.isAvailable,
      isSpecial: item.isSpecial,
      isDrink: item.isDrink,
      isVegetarian: item.isVegetarian,
      isSpicy: item.isSpicy,
      calories: item.calories != null ? String(item.calories) : "",
      prepTime: item.prepTime != null ? String(item.prepTime) : "",
      ingredients: item.ingredients ?? "",
      sortOrder: String(item.sortOrder),
    });
    setDialogOpen(true);
  };

  const uploadImage = async (file: File) => {
    setUploading(true);
    setUploadProgress(0);
    const timer = setInterval(() => setUploadProgress((p) => Math.min(90, p + 10)), 180);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", "food");
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      clearInterval(timer);
      if (data.success) {
        setUploadProgress(100);
        setForm((f) => ({ ...f, imageUrl: data.url }));
        toast.success("تصویر آپلود شد 🖼");
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
    }, 500);
  };

  const uploadGalleryFiles = async (files: FileList) => {
    if (!editing) {
      toast.info("برای افزودن گالری، ابتدا آیتم را ذخیره کنید سپس ویرایش کنید");
      return;
    }
    const slotsLeft = 6 - form.gallery.length;
    if (slotsLeft <= 0) {
      toast.error("گالری پر است (۶ از ۶)");
      return;
    }
    const list = Array.from(files).slice(0, slotsLeft);
    if (list.length === 0) return;
    setGalleryUploading(true);
    setGalleryProgress(0);
    const timer = setInterval(() => setGalleryProgress((p) => Math.min(90, p + 8)), 200);
    try {
      const fd = new FormData();
      for (const f of list) fd.append("files", f);
      const res = await fetch(`/api/admin/menu/${editing.id}/gallery`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      clearInterval(timer);
      if (data.success) {
        setGalleryProgress(100);
        const newUrls: string[] = data.urls ?? [];
        setForm((f) => ({
          ...f,
          gallery: [...f.gallery, ...newUrls].slice(0, 6),
        }));
        if (newUrls.length > 0) {
          toast.success(`${toPersianDigits(newUrls.length)} تصویر به گالری اضافه شد 🖼`);
        }
        if (data.errors?.length) {
          toast.warning(`${toPersianDigits(data.errors.length)} فایل ناموفق بود`);
        }
      } else {
        toast.error(data.error ?? "خطا در آپلود گالری");
      }
    } catch {
      clearInterval(timer);
      toast.error("خطا در ارتباط با سرور");
    } finally {
      setTimeout(() => {
        setGalleryUploading(false);
        setGalleryProgress(0);
      }, 500);
    }
  };

  const save = async () => {
    if (form.name.trim().length < 2) return toast.error("نام غذا را وارد کنید");
    const price = Number(form.price.replace(/[^\d]/g, ""));
    if (!price || price < 1000) return toast.error("قیمت معتبر وارد کنید (حداقل ۱,۰۰۰ تومان)");
    if (!form.categoryId) return toast.error("دسته‌بندی را انتخاب کنید");

    setSaving(true);
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      price,
      categoryId: form.categoryId,
      imageUrl: form.imageUrl || null,
      gallery: form.gallery.length > 0 ? form.gallery : null,
      isAvailable: form.isAvailable,
      isSpecial: form.isSpecial,
      isDrink: form.isDrink,
      isVegetarian: form.isVegetarian,
      isSpicy: form.isSpicy,
      calories: form.calories ? Number(form.calories.replace(/\D/g, "")) : null,
      prepTime: form.prepTime ? Number(form.prepTime.replace(/\D/g, "")) : null,
      ingredients: form.ingredients.trim() || null,
      sortOrder: Number(form.sortOrder.replace(/\D/g, "")) || 0,
    };
    const res = editing
      ? await api(`/api/admin/menu/${editing.id}`, { method: "PUT", body: payload })
      : await api("/api/admin/menu", { body: payload });
    setSaving(false);
    if (!res.success) return toast.error(res.error ?? "خطا در ذخیره");
    toast.success(editing ? "آیتم به‌روزرسانی شد ✅" : "آیتم جدید اضافه شد ✅");
    setDialogOpen(false);
    load();
  };

  const toggleAvailable = async (item: MenuItemRow) => {
    const res = await api(`/api/admin/menu/${item.id}`, {
      method: "PUT",
      body: { isAvailable: !item.isAvailable },
    });
    if (res.success) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, isAvailable: !i.isAvailable } : i)));
      toast.success(item.isAvailable ? `${item.name} ناموجود شد` : `${item.name} موجود شد`);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    const res = await api(`/api/admin/menu/${deleteTarget.id}`, { method: "DELETE" });
    setDeleteTarget(null);
    if (!res.success) return toast.error(res.error ?? "خطا در حذف");
    toast.success("آیتم حذف شد");
    load();
  };

  const filtered = items.filter((i) => {
    if (catFilter !== "ALL" && i.categoryId !== catFilter) return false;
    if (search && !i.name.includes(search)) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-black">
            <UtensilsCrossed className="h-6 w-6 text-primary" />
            مدیریت منو
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {toPersianDigits(items.length)} آیتم در {toPersianDigits(categories.length)} دسته‌بندی
          </p>
        </div>
        <Button onClick={openCreate} className="rounded-xl font-bold shadow-lg shadow-primary/25">
          <Plus className="ml-1.5 h-4 w-4" />
          افزودن آیتم جدید
        </Button>
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-72">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجوی نام غذا..."
            className="rounded-xl pr-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setCatFilter("ALL")}
            className={`rounded-xl px-3.5 py-2 text-xs font-bold transition ${
              catFilter === "ALL" ? "bg-primary text-primary-foreground" : "border bg-card hover:bg-accent"
            }`}
          >
            همه
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setCatFilter(c.id)}
              className={`rounded-xl px-3.5 py-2 text-xs font-bold transition ${
                catFilter === c.id ? "bg-primary text-primary-foreground" : "border bg-card hover:bg-accent"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => (
            <Card key={item.id} className={`group gap-0 overflow-hidden rounded-2xl p-0 transition-all hover:shadow-lg ${!item.isAvailable ? "opacity-70" : ""}`}>
              <div className="relative h-36 bg-muted">
                {item.imageUrl ? (
                  <Image src={item.imageUrl} alt={item.name} fill sizes="33vw" className="object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-4xl">🍽</div>
                )}
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent p-2.5 pt-8">
                  <span className="text-sm font-extrabold text-white">{item.name}</span>
                  <span className="rounded-lg bg-white/95 px-2 py-0.5 text-xs font-black text-primary">
                    {item.price.toLocaleString("fa-IR")}
                  </span>
                </div>
                <div className="absolute right-2 top-2 flex gap-1">
                  {item.isSpecial && (
                    <Badge className="gap-1 bg-gold text-white">
                      <Star className="h-3 w-3" />
                    </Badge>
                  )}
                  {item.isDrink && <Badge variant="secondary">نوشیدنی</Badge>}
                  {item.isVegetarian && (
                    <Badge className="bg-emerald-600/15 text-emerald-700 hover:bg-emerald-600/15 dark:text-emerald-400">گیاهی</Badge>
                  )}
                  {item.isSpicy && (
                    <Badge className="bg-red-600/15 text-red-700 hover:bg-red-600/15 dark:text-red-400">تند</Badge>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 p-3">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span>{item.categoryName}</span>
                  <span>•</span>
                  <span>{toPersianDigits(item.orderCount)} فروش</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title={item.isAvailable ? "ناموجود کن" : "موجود کن"}
                    onClick={() => toggleAvailable(item)}
                  >
                    {item.isAvailable ? (
                      <PackageCheck className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <PackageX className="h-4 w-4 text-red-500" />
                    )}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" title="ویرایش" onClick={() => openEdit(item)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    title="حذف"
                    onClick={() => setDeleteTarget(item)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
          {filtered.length === 0 && (
            <Card className="col-span-full border-dashed p-10 text-center text-muted-foreground">
              موردی یافت نشد
            </Card>
          )}
        </div>
      )}

      {/* create/edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-2xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{editing ? `ویرایش «${editing.name}»` : "افزودن آیتم جدید به منو"}</DialogTitle>
            <DialogDescription>
              اطلاعات کامل غذا — این داده‌ها مستقیماً در منوی هوش نخل و فاکتورها استفاده می‌شود
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>نام غذا *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-xl" placeholder="مثلاً: کباب کوبیده" />
            </div>
            <div className="space-y-1.5">
              <Label>قیمت (تومان) *</Label>
              <Input
                dir="ltr"
                inputMode="numeric"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value.replace(/[^\d]/g, "") })}
                className="rounded-xl"
                placeholder="185000"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>توضیحات</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="rounded-xl"
                rows={2}
                placeholder="توضیح کوتاه و اشتها‌برانگیز..."
              />
            </div>
            <div className="space-y-1.5">
              <Label>دسته‌بندی *</Label>
              <Select value={form.categoryId} onValueChange={(v) => setForm({ ...form, categoryId: v })}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="انتخاب کنید" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>ترتیب نمایش</Label>
              <Input dir="ltr" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value.replace(/\D/g, "") })} className="rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label>کالری (اختیاری)</Label>
              <Input dir="ltr" inputMode="numeric" value={form.calories} onChange={(e) => setForm({ ...form, calories: e.target.value.replace(/\D/g, "") })} className="rounded-xl" placeholder="720" />
            </div>
            <div className="space-y-1.5">
              <Label>زمان آماده‌سازی (دقیقه)</Label>
              <Input dir="ltr" inputMode="numeric" value={form.prepTime} onChange={(e) => setForm({ ...form, prepTime: e.target.value.replace(/\D/g, "") })} className="rounded-xl" placeholder="25" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>مواد تشکیل‌دهنده (اختیاری)</Label>
              <Input value={form.ingredients} onChange={(e) => setForm({ ...form, ingredients: e.target.value })} className="rounded-xl" placeholder="گوشت، پیاز، زعفران..." />
            </div>

            {/* image upload */}
            <div className="space-y-1.5 sm:col-span-2">
              <Label>تصویر شاخص</Label>
              <div className="flex items-start gap-3">
                <div className="relative h-28 w-40 shrink-0 overflow-hidden rounded-xl border-2 border-dashed bg-muted/50">
                  {form.imageUrl ? (
                    <>
                      <Image src={form.imageUrl} alt="پیش‌نمایش" fill sizes="160px" className="object-cover" />
                      <button
                        onClick={() => setForm({ ...form, imageUrl: "" })}
                        className="absolute left-1 top-1 rounded-full bg-black/60 p-1 text-white transition hover:bg-black/80"
                        title="حذف تصویر"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => fileRef.current?.click()}
                      className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-muted-foreground transition hover:text-primary"
                    >
                      <ImagePlus className="h-7 w-7" />
                      <span className="text-[11px] font-bold">انتخاب تصویر</span>
                    </button>
                  )}
                </div>
                <div className="flex-1 space-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="w-full rounded-xl"
                  >
                    {uploading ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Camera className="ml-2 h-4 w-4" />}
                    {uploading ? "در حال آپلود..." : "آپلود تصویر (JPG/PNG/WebP)"}
                  </Button>
                  {uploading && <Progress value={uploadProgress} className="h-2" />}
                  <p className="text-[11px] leading-5 text-muted-foreground">
                    حداکثر ۵ مگابایت — تصویر به‌صورت خودکار به WebP بهینه می‌شود (حداکثر عرض ۱۲۰۰ پیکسل)
                  </p>
                  <Input
                    value={form.imageUrl}
                    onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                    placeholder="یا آدرس تصویر را وارد کنید"
                    dir="ltr"
                    className="rounded-xl text-xs"
                  />
                </div>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadImage(f);
                  e.target.value = "";
                }}
              />
            </div>

            {/* gallery section */}
            <div className="space-y-2 sm:col-span-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5 font-bold">
                  <Images className="h-4 w-4 text-primary" />
                  گالری تصاویر
                </Label>
                <span className="text-[11px] font-bold text-muted-foreground">
                  {toPersianDigits(form.gallery.length)} از {toPersianDigits(6)} تصویر
                </span>
              </div>

              <div
                className={`rounded-xl border-2 border-dashed bg-muted/40 p-3 transition ${
                  galleryUploading ? "border-primary/50 opacity-80" : "border-muted-foreground/25"
                }`}
              >
                {form.gallery.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-4 text-center text-muted-foreground">
                    <Images className="h-8 w-8 opacity-50" />
                    <p className="text-[11px] leading-5">
                      هنوز تصویر گالری‌ای اضافه نشده — تصاویر اضافی غذا را اینجا آپلود کنید
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {form.gallery.map((url, idx) => (
                      <div
                        key={url + idx}
                        className="group relative aspect-square overflow-hidden rounded-lg border bg-card"
                      >
                        <Image
                          src={url}
                          alt={`گالری ${idx + 1}`}
                          fill
                          sizes="120px"
                          className="object-cover"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setForm((f) => ({ ...f, gallery: f.gallery.filter((_, i) => i !== idx) }))
                          }
                          className="absolute left-1 top-1 rounded-full bg-black/60 p-1 text-white transition hover:bg-destructive"
                          title="حذف از گالری"
                          aria-label={`حذف تصویر گالری ${toPersianDigits(idx + 1)}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {form.gallery.length > 0 && galleryProgress > 0 && (
                  <Progress value={galleryProgress} className="mt-2 h-1.5" />
                )}

                <div className="mt-3 flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => galleryFileRef.current?.click()}
                    disabled={galleryUploading || form.gallery.length >= 6}
                    className="rounded-xl"
                  >
                    {galleryUploading ? (
                      <Loader2 className="ml-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ImagePlus className="ml-2 h-3.5 w-3.5" />
                    )}
                    {galleryUploading ? "در حال آپلود..." : "افزودن تصاویر گالری"}
                  </Button>
                  {!editing && (
                    <span className="text-[10px] text-muted-foreground">
                      برای افزودن گالری، ابتدا آیتم را بسازید سپس ویرایش کنید
                    </span>
                  )}
                </div>
              </div>

              <p className="text-[11px] leading-5 text-muted-foreground">
                حداکثر ۶ تصویر — هر کدام تا ۵ مگابایت — تصاویر اضافی که کنار تصویر اصلی در سایت نمایش داده می‌شوند
              </p>

              <input
                ref={galleryFileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    uploadGalleryFiles(e.target.files);
                  }
                  e.target.value = "";
                }}
              />
            </div>

            {/* switches */}
            <div className="flex items-center justify-between rounded-xl border p-3.5">
              <div>
                <Label className="font-bold">موجود</Label>
                <p className="text-[11px] text-muted-foreground">قابل سفارش در هوش نخل</p>
              </div>
              <Switch checked={form.isAvailable} onCheckedChange={(v) => setForm({ ...form, isAvailable: v })} />
            </div>
            <div className="flex items-center justify-between rounded-xl border p-3.5">
              <div>
                <Label className="font-bold flex items-center gap-1">
                  <Star className="h-3.5 w-3.5 text-gold" />
                  پیشنهاد ویژه
                </Label>
                <p className="text-[11px] text-muted-foreground">نمایش ستاره‌دار در منو</p>
              </div>
              <Switch checked={form.isSpecial} onCheckedChange={(v) => setForm({ ...form, isSpecial: v })} />
            </div>
            <div className="flex items-center justify-between rounded-xl border p-3.5">
              <div>
                <Label className="font-bold">نوشیدنی</Label>
                <p className="text-[11px] text-muted-foreground">در پیشنهاد نوشیدنی هوش نخل</p>
              </div>
              <Switch checked={form.isDrink} onCheckedChange={(v) => setForm({ ...form, isDrink: v })} />
            </div>
            <div className="flex items-center justify-between rounded-xl border p-3.5">
              <div>
                <Label className="font-bold flex items-center gap-1">
                  <Leaf className="h-3.5 w-3.5 text-emerald-600" />
                  گیاهی
                </Label>
                <p className="text-[11px] text-muted-foreground">بدون گوشت؛ در فیلتر «گیاهی» مشتریان</p>
              </div>
              <Switch checked={form.isVegetarian} onCheckedChange={(v) => setForm({ ...form, isVegetarian: v })} />
            </div>
            <div className="flex items-center justify-between rounded-xl border p-3.5">
              <div>
                <Label className="font-bold flex items-center gap-1">
                  <Flame className="h-3.5 w-3.5 text-red-600" />
                  تند
                </Label>
                <p className="text-[11px] text-muted-foreground">در فیلتر «تند» و هشدار هوش نخل</p>
              </div>
              <Switch checked={form.isSpicy} onCheckedChange={(v) => setForm({ ...form, isSpicy: v })} />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={save} disabled={saving} className="flex-1 rounded-xl font-bold">
              {saving ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : null}
              {editing ? "ذخیره تغییرات" : "افزودن به منو"}
            </Button>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="rounded-xl">
              انصراف
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف «{deleteTarget?.name}»؟</AlertDialogTitle>
            <AlertDialogDescription>
              این عملیات قابل بازگشت نیست. اگر آیتم در سفارش‌های قبلی استفاده شده باشد، فقط از منوی فعال حذف می‌شود.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2">
            <AlertDialogAction
              onClick={remove}
              className="flex-1 rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              بله، حذف کن
            </AlertDialogAction>
            <AlertDialogCancel className="flex-1 rounded-xl">انصراف</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
