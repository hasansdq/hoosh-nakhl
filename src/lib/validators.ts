import { z } from "zod";

export const phoneSchema = z
  .string()
  .min(10, "شماره موبایل معتبر نیست")
  .max(20, "شماره موبایل معتبر نیست");

export const otpSchema = z
  .string()
  .regex(/^\d{4,8}$/, "کد تأیید باید فقط رقم باشد");

export const registerSchema = z.object({
  phone: phoneSchema,
  otpToken: z.string().min(10),
  firstName: z.string().trim().min(2, "نام را وارد کنید").max(50),
  lastName: z.string().trim().min(2, "نام خانوادگی را وارد کنید").max(60),
  nationalId: z
    .string()
    .trim()
    .regex(/^\d{10}$/, "کد ملی باید ۱۰ رقم باشد")
    .optional()
    .or(z.literal("")),
  birthDate: z.string().trim().max(15).optional().or(z.literal("")),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional().or(z.literal("")),
  email: z.string().trim().email("ایمیل معتبر نیست").optional().or(z.literal("")),
});

export const dietaryPrefsSchema = z.object({
  vegetarian: z.boolean(),
  avoidSpicy: z.boolean(),
  allergies: z.string().trim().max(200, "متن حساسیت‌ها حداکثر ۲۰۰ نویسه"),
  dislikes: z.string().trim().max(200, "متن موارد نپسندیده حداکثر ۲۰۰ نویسه"),
});

export const profileUpdateSchema = z.object({
  firstName: z.string().trim().min(2, "نام را وارد کنید").max(50).optional(),
  lastName: z.string().trim().min(2).max(60).optional(),
  nationalId: z
    .string()
    .trim()
    .regex(/^\d{10}$/, "کد ملی باید ۱۰ رقم باشد")
    .optional()
    .or(z.literal("")),
  birthDate: z.string().trim().max(15).optional().or(z.literal("")),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional().or(z.literal("")),
  email: z.string().trim().email("ایمیل معتبر نیست").optional().or(z.literal("")),
  avatarUrl: z.string().trim().max(300).optional(),
  dietaryPrefs: dietaryPrefsSchema.optional(),
});

export const addressSchema = z.object({
  title: z.string().trim().min(2, "عنوان را وارد کنید").max(60),
  fullAddress: z.string().trim().min(10, "آدرس کامل را وارد کنید").max(500),
  postalCode: z.string().trim().regex(/^\d{10}$/).optional().or(z.literal("")),
  isDefault: z.boolean().optional(),
});

export const categorySchema = z.object({
  name: z.string().trim().min(2, "نام دسته را وارد کنید").max(60),
  icon: z.string().trim().max(40).optional().or(z.literal("")),
  sortOrder: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
});

export const menuItemSchema = z.object({
  name: z.string().trim().min(2, "نام غذا را وارد کنید").max(80),
  description: z.string().trim().max(600).optional().nullable(),
  price: z.number().int().min(1000, "قیمت حداقل ۱,۰۰۰ تومان").max(500_000_000),
  categoryId: z.string().min(5, "دسته‌بندی را انتخاب کنید"),
  imageUrl: z.string().trim().max(300).optional().nullable(),
  gallery: z
    .array(
      z
        .string()
        .trim()
        .max(300)
        .regex(
          /^(\/uploads\/|\/food\/|https?:\/\/).+$/,
          "آدرس تصویر گالری نامعتبر است"
        )
    )
    .max(6, "گالری حداکثر ۶ تصویر می‌تواند داشته باشد")
    .optional()
    .nullable(),
  isAvailable: z.boolean().optional(),
  isSpecial: z.boolean().optional(),
  isDrink: z.boolean().optional(),
  isVegetarian: z.boolean().optional(),
  isSpicy: z.boolean().optional(),
  calories: z.number().int().min(0).max(5000).optional().nullable(),
  prepTime: z.number().int().min(0).max(600).optional().nullable(),
  ingredients: z.string().trim().max(600).optional().nullable(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

export const adminLoginSchema = z.object({
  username: z.string().trim().min(3).max(60),
  password: z.string().min(4).max(200),
});

export const chatMessageSchema = z.object({
  sessionId: z.string().min(5).optional(),
  message: z.string().trim().min(1, "پیام خالی است").max(1000),
});

export function zodErrorToMessage(err: z.ZodError): string {
  return err.issues[0]?.message ?? "داده ارسالی نامعتبر است";
}
