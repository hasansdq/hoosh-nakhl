/**
 * Nakhl Restaurant — Site Content registry (CMS)
 * ------------------------------------------------
 * Single source of truth for every admin-managed static text/image of the
 * storefront. Each entry declares:
 *   • key      — stable identifier (e.g. `home.hero.title`) stored in the
 *                `SiteContent` table as an *override* of the default below.
 *   • group    — admin-panel grouping (صفحه اصلی / ورود / سربرگ / پاورقی / سئو).
 *   • type     — editor widget: `text` (Input), `textarea`, or `image`
 *                (upload + URL).
 *   • label    — Persian display name shown in /nk-admin.
 *   • description — helper text for the admin.
 *   • default  — the value used when no DB override exists (guarantees the
 *                site renders correctly on a fresh install / API failure).
 *
 * Rich markup conventions (interpreted by <RichText/> in the storefront):
 *   • `[[متن]]` → highlighted (gold-gradient) span.
 *   • `\n`      → line break.
 *
 * Template placeholders (interpolated with live «عمومی» settings):
 *   {restaurantName} {restaurantTagline} {city} {address} {phone}
 *   {workingHours} {email} {instagram} {telegram}
 *
 * This module is imported by BOTH server and client code — keep it free of
 * any directive/dependency.
 */

export type ContentGroup = "home" | "auth" | "header" | "footer" | "seo";
export type ContentType = "text" | "textarea" | "image";

export interface ContentDef {
  key: string;
  group: ContentGroup;
  type: ContentType;
  label: string;
  description?: string;
  default: string;
}

export const CONTENT_GROUP_META: {
  key: ContentGroup;
  title: string;
  description: string;
}[] = [
  {
    key: "home",
    title: "صفحه اصلی",
    description: "هیرو، آمار، مراحل سفارش، دربارهٔ ما، سوالات متداول، تماس و بنر پایانی",
  },
  {
    key: "auth",
    title: "صفحه ورود و ثبت‌نام",
    description: "عنوان‌ها، توضیحات، تصویر پس‌زمینه و کاشی‌های برند در صفحهٔ ورود",
  },
  {
    key: "header",
    title: "سربرگ سایت",
    description: "نوار اطلاعیه بالای سایت و نام برند",
  },
  {
    key: "footer",
    title: "پاورقی سایت",
    description: "عناوین ستون‌ها، نوار اعتماد و متن کپی‌رایت",
  },
  {
    key: "seo",
    title: "سئو و اشتراک‌گذاری",
    description: "عنوان و توضیحات صفحه برای موتورهای جستجو و شبکه‌های اجتماعی",
  },
];

const DEFS: ContentDef[] = [
  // ══════════════════════ صفحه اصلی — هیرو ══════════════════════
  {
    key: "home.hero.badge",
    group: "home",
    type: "text",
    label: "نشان بالای تیتر (هیرو)",
    default: "اولین رستوران {city} با گارسون هوش مصنوعی",
  },
  {
    key: "home.hero.title",
    group: "home",
    type: "textarea",
    label: "تیتر اصلی صفحه اول",
    description: "«[[متن]]» = هایلایت طلایی؛ خط جدید = شکست خط",
    default: "با [[هوش نخل]] سفارش بده،\nمثل حضوری! 🌴",
  },
  {
    key: "home.hero.subtitle",
    group: "home",
    type: "textarea",
    label: "زیرتیتر هیرو",
    default:
      "دیگه لازم نیست منو رو ورق بزنی و فرم پر کنی؛ فقط مثل یک دوست با «هوش نخل» حرف بزن، غذات رو انتخاب کن و پرداختت رو انجام بده. به همین راحتی!",
  },
  {
    key: "home.hero.ctaPrimary",
    group: "home",
    type: "text",
    label: "متن دکمه اصلی هیرو",
    default: "شروع سفارش با هوش نخل",
  },
  {
    key: "home.hero.ctaSecondary",
    group: "home",
    type: "text",
    label: "متن دکمه دوم هیرو",
    default: "مشاهده منو",
  },
  {
    key: "home.hero.trustPayment",
    group: "home",
    type: "text",
    label: "آیتم اعتماد ۱ (هیرو)",
    default: "پرداخت امن زرین‌پال",
  },
  {
    key: "home.hero.trustDelivery",
    group: "home",
    type: "text",
    label: "آیتم اعتماد ۲ (هیرو)",
    default: "ارسال سریع در {city}",
  },
  {
    key: "home.hero.trustHours",
    group: "home",
    type: "text",
    label: "آیتم اعتماد ۳ (هیرو)",
    default: "{workingHours}",
  },
  {
    key: "home.hero.image",
    group: "home",
    type: "image",
    label: "تصویر هیرو",
    description: "تصویر بزرگ کنار تیتر اصلی",
    default: "/food/hero.png",
  },
  {
    key: "home.hero.imageCaptionTitle",
    group: "home",
    type: "text",
    label: "عنوان روی تصویر هیرو",
    default: "{restaurantName} {city}",
  },
  {
    key: "home.hero.imageCaptionSubtitle",
    group: "home",
    type: "text",
    label: "زیرنویس روی تصویر هیرو",
    default: "محیط دلنشین • غذای اصیل ایرانی",
  },
  {
    key: "home.hero.chatBubble",
    group: "home",
    type: "text",
    label: "حباب گفتگوی شناور هیرو",
    default: "هوش نخل: قربان، امروز چه میل دارید؟ 🌿",
  },
  {
    key: "home.hero.ratingTitle",
    group: "home",
    type: "text",
    label: "کارت امتیاز شناور — عدد",
    default: "۴٫۹ از ۵",
  },
  {
    key: "home.hero.ratingSubtitle",
    group: "home",
    type: "text",
    label: "کارت امتیاز شناور — توضیح",
    default: "رضایت مشتریان نخل",
  },

  // ══════════════════════ صفحه اصلی — آمار ══════════════════════
  {
    key: "home.stats1.value",
    group: "home",
    type: "text",
    label: "آمار ۱ — عدد",
    default: "۱۵+",
  },
  {
    key: "home.stats1.label",
    group: "home",
    type: "text",
    label: "آمار ۱ — عنوان",
    default: "سال تجربه",
  },
  {
    key: "home.stats2.value",
    group: "home",
    type: "text",
    label: "آمار ۲ — عدد",
    default: "۵۰٫۰۰۰+",
  },
  {
    key: "home.stats2.label",
    group: "home",
    type: "text",
    label: "آمار ۲ — عنوان",
    default: "سفارش موفق",
  },
  {
    key: "home.stats3.value",
    group: "home",
    type: "text",
    label: "آمار ۳ — عدد",
    default: "۴٫۹",
  },
  {
    key: "home.stats3.label",
    group: "home",
    type: "text",
    label: "آمار ۳ — عنوان",
    default: "رضایت مشتری",
  },
  {
    key: "home.stats4.value",
    group: "home",
    type: "text",
    label: "آمار ۴ — عدد",
    default: "۳۰ دقیقه",
  },
  {
    key: "home.stats4.label",
    group: "home",
    type: "text",
    label: "آمار ۴ — عنوان",
    default: "میانگین ارسال",
  },

  // ══════════════════════ صفحه اصلی — ۴ قدم ══════════════════════
  {
    key: "home.how.title",
    group: "home",
    type: "text",
    label: "عنوان بخش «نحوه سفارش»",
    default: "سفارش در ۴ قدم ساده",
  },
  {
    key: "home.how.subtitle",
    group: "home",
    type: "text",
    label: "زیرعنوان بخش «نحوه سفارش»",
    default: "بدون فرم طولانی، بدون کلیک اضافه — فقط یک گفتگوی ساده",
  },
  {
    key: "home.how.step1.title",
    group: "home",
    type: "text",
    label: "قدم ۱ — عنوان",
    default: "۱. شروع گفتگو",
  },
  {
    key: "home.how.step1.desc",
    group: "home",
    type: "textarea",
    label: "قدم ۱ — توضیح",
    default: "سلام کن و منو کامل رو از هوش نخل بگیر",
  },
  {
    key: "home.how.step2.title",
    group: "home",
    type: "text",
    label: "قدم ۲ — عنوان",
    default: "۲. انتخاب غذا",
  },
  {
    key: "home.how.step2.desc",
    group: "home",
    type: "textarea",
    label: "قدم ۲ — توضیح",
    default: "غذا و نوشیدنی‌ات رو بگو؛ حتی وسط چت هم می‌تونی تغییرش بدی",
  },
  {
    key: "home.how.step3.title",
    group: "home",
    type: "text",
    label: "قدم ۳ — عنوان",
    default: "۳. پیک یا بیرونبر",
  },
  {
    key: "home.how.step3.desc",
    group: "home",
    type: "textarea",
    label: "قدم ۳ — توضیح",
    default: "آدرست رو بده تا با پیک برات بیاد یا خودت تحویل بگیر",
  },
  {
    key: "home.how.step4.title",
    group: "home",
    type: "text",
    label: "قدم ۴ — عنوان",
    default: "۴. پرداخت امن",
  },
  {
    key: "home.how.step4.desc",
    group: "home",
    type: "textarea",
    label: "قدم ۴ — توضیح",
    default: "فاکتور با مالیات شفاف، پرداخت درگاه زرین‌پال و رهگیری لحظه‌ای",
  },

  // ══════════════════════ صفحه اصلی — منو ══════════════════════
  {
    key: "home.menu.title",
    group: "home",
    type: "text",
    label: "عنوان بخش منو",
    default: "نگاهی به منوی نخل",
  },
  {
    key: "home.menu.cta",
    group: "home",
    type: "text",
    label: "دکمه کنار عنوان منو",
    default: "سفارش از هوش نخل",
  },
  {
    key: "home.menu.searchPlaceholder",
    group: "home",
    type: "text",
    label: "متن راهنمای جستجوی منو",
    default: "جستجو در کل منو؛ مثلاً «کباب» یا «دوغ»...",
  },
  {
    key: "home.specials.title",
    group: "home",
    type: "text",
    label: "عنوان پیشنهادهای ویژه",
    default: "پیشنهادهای ویژه نخل",
  },
  {
    key: "home.specials.badge",
    group: "home",
    type: "text",
    label: "نشان کنار پیشنهادهای ویژه",
    default: "منتخب سرآشپز",
  },

  // ══════════════════════ صفحه اصلی — درباره ما ══════════════════════
  {
    key: "home.about.title",
    group: "home",
    type: "text",
    label: "عنوان بخش داستان",
    default: "داستان نخل 🌴",
  },
  {
    key: "home.about.text",
    group: "home",
    type: "textarea",
    label: "پاراگراف دوم داستان",
    description: "پاراگراف اول از «تنظیمات → عمومی → متن درباره ما» خوانده می‌شود",
    default:
      "حالا با «هوش نخل» — گارسون هوشمند ما — همان تجربه حضوری را آنلاین زندگی کنید؛ کافی است مثل یک دوست حرف بزنید تا سفارشتان در چند دقیقه آماده ارسال شود. از کباب برگ ممتاز تا شله‌زارد سنتی، همه با همان ذوق روز اول.",
  },
  {
    key: "home.about.chip1",
    group: "home",
    type: "text",
    label: "برچسب ۱ (داستان)",
    default: "مواد اولیه تازه روزانه",
  },
  {
    key: "home.about.chip2",
    group: "home",
    type: "text",
    label: "برچسب ۲ (داستان)",
    default: "سرآشپز با ۲۰ سال تجربه",
  },
  {
    key: "home.about.chip3",
    group: "home",
    type: "text",
    label: "برچسب ۳ (داستان)",
    default: "پخت با عشق خانوادگی",
  },
  {
    key: "home.about.image",
    group: "home",
    type: "image",
    label: "تصویر بخش داستان",
    default: "/food/hero.png",
  },
  {
    key: "home.about.imageCaptionTitle",
    group: "home",
    type: "text",
    label: "عنوان روی تصویر داستان",
    default: "سفره‌ای به اصالت خودِ ایران",
  },
  {
    key: "home.about.imageCaptionSubtitle",
    group: "home",
    type: "text",
    label: "زیرنویس روی تصویر داستان",
    default: "کباب کرمانی • دیزی خانوادگی • شله‌زارد سنتی",
  },
  {
    key: "home.about.badgeTitle",
    group: "home",
    type: "text",
    label: "کارت شناور داستان — عنوان",
    default: "از ۱۳۸۸",
  },
  {
    key: "home.about.badgeSubtitle",
    group: "home",
    type: "text",
    label: "کارت شناور داستان — توضیح",
    default: "در خدمت رفسنجانی‌های عزیز",
  },

  // ══════════════════════ صفحه اصلی — سوالات متداول ══════════════════════
  {
    key: "home.faq.title",
    group: "home",
    type: "text",
    label: "عنوان سوالات متداول",
    default: "سوالات متداول",
  },
  {
    key: "home.faq.subtitle",
    group: "home",
    type: "text",
    label: "زیرعنوان سوالات متداول",
    default: "پاسخ کوتاه و روشن برای پرتکرارترین سوال‌های شما — سوالی مانده؟ از هوش نخل بپرسید!",
  },
  {
    key: "home.faq.q1",
    group: "home",
    type: "textarea",
    label: "سوال ۱",
    default: "چطور با هوش نخل سفارش بدهم؟",
  },
  {
    key: "home.faq.a1",
    group: "home",
    type: "textarea",
    label: "پاسخ ۱",
    default:
      "کافی است روی «شروع سفارش با هوش نخل» بزنید و مثل حرف زدن با یک گارسون حرفه‌ای سفارشتان را بگویید؛ مثلاً «۲ کباب کوبیده و یک دوغ محلی». هوش نخل منو را پیشنهاد می‌دهد، سفارش را ثبت می‌کند و فاکتور شفاف نشان می‌دهد — بدون فرم طولانی و کلیک اضافه.",
  },
  {
    key: "home.faq.q2",
    group: "home",
    type: "textarea",
    label: "سوال ۲",
    default: "پرداخت چطور انجام می‌شود؟",
  },
  {
    key: "home.faq.a2",
    group: "home",
    type: "textarea",
    label: "پاسخ ۲",
    default:
      "پس از تأیید نهایی سفارش، فاکتوری با جزئیات کامل (جمع اقلام، هزینه ارسال و مالیات ۱۰٪) نمایش داده می‌شود و پرداخت از طریق درگاه امن زرین‌پال انجام می‌شود. رسید پرداخت و کد رهگیری سفارش بلافاصله صادر می‌شود.",
  },
  {
    key: "home.faq.q3",
    group: "home",
    type: "textarea",
    label: "سوال ۳",
    default: "هزینه و زمان ارسال چقدر است؟",
  },
  {
    key: "home.faq.a3",
    group: "home",
    type: "textarea",
    label: "پاسخ ۳",
    default:
      "ارسال با پیک اختصاصی نخل در سطح رفسنجان انجام می‌شود و معمولاً در حدود ۳۰ دقیقه به دست شما می‌رسد. برای سفارش‌های بالای سقف تعیین‌شده، ارسال رایگان است و هزینه دقیق ارسال پیش از پرداخت، به‌صورت شفاف در فاکتور درج می‌شود.",
  },
  {
    key: "home.faq.q4",
    group: "home",
    type: "textarea",
    label: "سوال ۴",
    default: "می‌توانم وسط گفتگو سفارشم را تغییر دهم؟",
  },
  {
    key: "home.faq.a4",
    group: "home",
    type: "textarea",
    label: "پاسخ ۴",
    default:
      "بله! هر لحظه تا قبل از پرداخت می‌توانید اقلام را کم و زیاد کنید، نوشیدنی اضافه کنید، روش ارسال را عوض کنید یا آدرس را تغییر دهید. فقط کافی است در همان گفتگو به هوش نخل بگویید.",
  },
  {
    key: "home.faq.q5",
    group: "home",
    type: "textarea",
    label: "سوال ۵",
    default: "کد تخفیف چطور اعمال می‌شود؟",
  },
  {
    key: "home.faq.a5",
    group: "home",
    type: "textarea",
    label: "پاسخ ۵",
    default:
      "کد تخفیف را همان‌جا در گفتگو به هوش نخل بگویید (مثلاً «کد تخفیفم NAKHL20 است»)؛ اعتبار کد بررسی و مبلغ تخفیف به‌صورت شفاف در فاکتور شما اعمال می‌شود. کدهای فعال را می‌توانید از بنر بالای صفحه هم کپی کنید.",
  },

  // ══════════════════════ صفحه اصلی — تماس و CTA ══════════════════════
  {
    key: "home.contact.title",
    group: "home",
    type: "text",
    label: "عنوان بخش تماس",
    default: "تماس با ما",
  },
  {
    key: "home.contact.subtitle",
    group: "home",
    type: "text",
    label: "زیرعنوان بخش تماس",
    default: "منتظر دیدارتان در {restaurantName} {city} هستیم",
  },
  {
    key: "home.cta.title",
    group: "home",
    type: "text",
    label: "عنوان بنر پایانی",
    default: "گرسنه‌ای؟ همین حالا شروع کن!",
  },
  {
    key: "home.cta.subtitle",
    group: "home",
    type: "textarea",
    label: "متن بنر پایانی",
    default:
      "هوش نخل منتظرته تا مثل یک دوست، سفارشت رو بگیره. از سلام کردن شروع کن — بقیه‌ش با ما!",
  },
  {
    key: "home.cta.button",
    group: "home",
    type: "text",
    label: "دکمه بنر پایانی",
    default: "ورود به گفتگو با هوش نخل",
  },

  // ══════════════════════ صفحه ورود ══════════════════════
  {
    key: "auth.badge",
    group: "auth",
    type: "text",
    label: "نشان بالای عنوان ورود",
    default: "بدون رمز عبور — فقط با پیامک!",
  },
  {
    key: "auth.title",
    group: "auth",
    type: "text",
    label: "عنوان صفحه ورود",
    description: "«[[متن]]» = هایلایت طلایی متحرک",
    default: "ورود | [[ثبت‌نام]]",
  },
  {
    key: "auth.subtitle",
    group: "auth",
    type: "textarea",
    label: "توضیح زیر عنوان ورود",
    default:
      "شماره موبایل خود را وارد کنید تا کد تأیید برایتان پیامک شود؛ حساب ندارید؟ همین مسیر عضویت می‌سازد.",
  },
  {
    key: "auth.terms",
    group: "auth",
    type: "textarea",
    label: "متن پذیرش قوانین",
    description: "«[[متن]]» = لینک قوانین",
    default: "با ورود یا ثبت‌نام، [[قوانین {restaurantName}]] را می‌پذیرید.",
  },
  {
    key: "auth.backLabel",
    group: "auth",
    type: "text",
    label: "متن دکمه بازگشت",
    default: "بازگشت به رستوران",
  },
  {
    key: "auth.brand.name",
    group: "auth",
    type: "text",
    label: "نام برند در پنل ورود",
    default: "{restaurantName}",
  },
  {
    key: "auth.brand.tagline",
    group: "auth",
    type: "text",
    label: "زیرنویس برند در پنل ورود",
    default: "{city} • سفارش آنلاین هوشمند",
  },
  {
    key: "auth.brand.image",
    group: "auth",
    type: "image",
    label: "تصویر پس‌زمینه پنل ورود (دسکتاپ)",
    description: "هم‌زمان تصویر نوار برند موبایل هم هست",
    default: "/food/hero.png",
  },
  {
    key: "auth.brand.badge",
    group: "auth",
    type: "text",
    label: "نشان پنل برند",
    default: "بدون رمز عبور؛ فقط یک پیامک!",
  },
  {
    key: "auth.brand.title",
    group: "auth",
    type: "textarea",
    label: "تیتر پنل برند",
    description: "«[[متن]]» = هایلایت طلایی",
    default: "به خانوادهٔ [[نخل]] بپیوندید",
  },
  {
    key: "auth.brand.subtitle",
    group: "auth",
    type: "textarea",
    label: "توضیح پنل برند",
    default:
      "با عضویت، سفارش‌هایتان را با «هوش نخل» ثبت کنید، آدرس‌ها و علاقه‌مندی‌هایتان را ذخیره کنید و تخفیف‌های ویژهٔ اعضا را از دست ندهید.",
  },
  {
    key: "auth.brand.food1.image",
    group: "auth",
    type: "image",
    label: "کاشی غذا ۱ — تصویر",
    default: "/food/barg.png",
  },
  {
    key: "auth.brand.food1.caption",
    group: "auth",
    type: "text",
    label: "کاشی غذا ۱ — زیرنویس",
    default: "چلوکباب برگ",
  },
  {
    key: "auth.brand.food2.image",
    group: "auth",
    type: "image",
    label: "کاشی غذا ۲ — تصویر",
    default: "/food/koobideh.png",
  },
  {
    key: "auth.brand.food2.caption",
    group: "auth",
    type: "text",
    label: "کاشی غذا ۲ — زیرنویس",
    default: "کوبیده",
  },
  {
    key: "auth.brand.food3.image",
    group: "auth",
    type: "image",
    label: "کاشی غذا ۳ — تصویر",
    default: "/food/bastani.png",
  },
  {
    key: "auth.brand.food3.caption",
    group: "auth",
    type: "text",
    label: "کاشی غذا ۳ — زیرنویس",
    default: "بستنی سنتی",
  },
  {
    key: "auth.brand.feature1.title",
    group: "auth",
    type: "text",
    label: "ویژگی ۱ — عنوان",
    default: "سفارش گفتمانی",
  },
  {
    key: "auth.brand.feature1.desc",
    group: "auth",
    type: "text",
    label: "ویژگی ۱ — توضیح",
    default: "با هوش نخل، مثل حضوری",
  },
  {
    key: "auth.brand.feature2.title",
    group: "auth",
    type: "text",
    label: "ویژگی ۲ — عنوان",
    default: "پیک سریع",
  },
  {
    key: "auth.brand.feature2.desc",
    group: "auth",
    type: "text",
    label: "ویژگی ۲ — توضیح",
    default: "داغ و به‌موقع در {city}",
  },
  {
    key: "auth.brand.feature3.title",
    group: "auth",
    type: "text",
    label: "ویژگی ۳ — عنوان",
    default: "پرداخت امن",
  },
  {
    key: "auth.brand.feature3.desc",
    group: "auth",
    type: "text",
    label: "ویژگی ۳ — توضیح",
    default: "درگاه رسمی زرین‌پال",
  },
  {
    key: "auth.brand.stat1.value",
    group: "auth",
    type: "text",
    label: "آمار پنل برند ۱ — عدد",
    default: "+۳۰",
  },
  {
    key: "auth.brand.stat1.label",
    group: "auth",
    type: "text",
    label: "آمار پنل برند ۱ — عنوان",
    default: "غذای اصیل",
  },
  {
    key: "auth.brand.stat2.value",
    group: "auth",
    type: "text",
    label: "آمار پنل برند ۲ — عدد",
    default: "۷ روز",
  },
  {
    key: "auth.brand.stat2.label",
    group: "auth",
    type: "text",
    label: "آمار پنل برند ۲ — عنوان",
    default: "در هفته",
  },
  {
    key: "auth.brand.stat3.value",
    group: "auth",
    type: "text",
    label: "آمار پنل برند ۳ — عدد",
    default: "۱۲ تا ۱۲",
  },
  {
    key: "auth.brand.stat3.label",
    group: "auth",
    type: "text",
    label: "آمار پنل برند ۳ — عنوان",
    default: "ظهر تا شب",
  },
  {
    key: "auth.testimonial1.text",
    group: "auth",
    type: "textarea",
    label: "نظر مشتری ۱ — متن",
    default:
      "سفارش گفتمانی با «هوش نخل» فوق‌العاده بود؛ فقط چت کردم و سفارشم دقیق و سریع ثبت شد.",
  },
  {
    key: "auth.testimonial1.author",
    group: "auth",
    type: "text",
    label: "نظر مشتری ۱ — نام",
    default: "مهدی ر.",
  },
  {
    key: "auth.testimonial2.text",
    group: "auth",
    type: "textarea",
    label: "نظر مشتری ۲ — متن",
    default: "کباب برگ دقیقاً سرِ زمان تعیین‌شده و داغ رسید. کیفیت گوشت و برنج واقعاً ممتازه.",
  },
  {
    key: "auth.testimonial2.author",
    group: "auth",
    type: "text",
    label: "نظر مشتری ۲ — نام",
    default: "زهرا ک.",
  },
  {
    key: "auth.testimonial3.text",
    group: "auth",
    type: "textarea",
    label: "نظر مشتری ۳ — متن",
    default:
      "بدون تماس تلفنی، بدون دردسر؛ عضو شدم و آدرسم ذخیره می‌شود. تجربهٔ سفارش آنلاین واقعی!",
  },
  {
    key: "auth.testimonial3.author",
    group: "auth",
    type: "text",
    label: "نظر مشتری ۳ — نام",
    default: "حسین ع.",
  },
  {
    key: "auth.mobile.chip",
    group: "auth",
    type: "text",
    label: "چیپ نوار برند موبایل",
    default: "فقط یک پیامک!",
  },

  // ══════════════════════ سربرگ ══════════════════════
  {
    key: "header.promo",
    group: "header",
    type: "text",
    label: "متن نوار اطلاعیه بالای سایت",
    default: "با «هوش نخل» سفارش بده؛ مثل حضوری!",
  },
  {
    key: "header.brandTagline",
    group: "header",
    type: "text",
    label: "زیرنویس لوگو در سربرگ",
    default: "{city} • سفارش آنلاین هوشمند",
  },
  {
    key: "header.loginButton",
    group: "header",
    type: "text",
    label: "متن دکمه ورود سربرگ",
    default: "ورود / ثبت‌نام",
  },

  // ══════════════════════ پاورقی ══════════════════════
  {
    key: "footer.followUs",
    group: "footer",
    type: "text",
    label: "عنوان شبکه‌های اجتماعی",
    default: "ما را دنبال کنید:",
  },
  {
    key: "footer.quickLinksTitle",
    group: "footer",
    type: "text",
    label: "عنوان ستون دسترسی سریع",
    default: "دسترسی سریع",
  },
  {
    key: "footer.contactTitle",
    group: "footer",
    type: "text",
    label: "عنوان ستون تماس",
    default: "تماس با ما",
  },
  {
    key: "footer.trustPayment",
    group: "footer",
    type: "text",
    label: "نوار اعتماد ۱",
    default: "پرداخت امن از طریق درگاه زرین‌پال",
  },
  {
    key: "footer.trustSupport",
    group: "footer",
    type: "text",
    label: "نوار اعتماد ۲",
    default: "پشتیبانی {workingHours}",
  },
  {
    key: "footer.trustDelivery",
    group: "footer",
    type: "text",
    label: "نوار اعتماد ۳",
    default: "ارسال سریع در سراسر {city}",
  },
  {
    key: "footer.copyright",
    group: "footer",
    type: "text",
    label: "متن کپی‌رایت",
    default: "© ۱۴۰۵ {restaurantName} {city} — تمامی حقوق محفوظ است.",
  },
  {
    key: "footer.madeWith",
    group: "footer",
    type: "text",
    label: "متن «ساخته شده با»",
    default: "ساخته شده با ❤️ و هوش مصنوعی",
  },

  // ══════════════════════ سئو ══════════════════════
  {
    key: "seo.title",
    group: "seo",
    type: "text",
    label: "عنوان صفحه (تگ Title)",
    description: "حدود ۶۰ کاراکتر — در نتایج گوگل نمایش داده می‌شود",
    default: "{restaurantName} {city} | سفارش آنلاین با هوش مصنوعی",
  },
  {
    key: "seo.description",
    group: "seo",
    type: "textarea",
    label: "توضیحات متا (Description)",
    description: "حدود ۱۵۰ کاراکتر",
    default:
      "سامانه سفارش آنلاین {restaurantName} با هوش نخل، دستیار هوشمند سفارش غذا. سفارش‌دهی گفتگومحور، پرداخت امن زرین‌پال و ارسال سریع.",
  },
  {
    key: "seo.ogTitle",
    group: "seo",
    type: "text",
    label: "عنوان اشتراک‌گذاری (OG)",
    default: "{restaurantName} {city} | سفارش آنلاین با هوش مصنوعی",
  },
  {
    key: "seo.ogDescription",
    group: "seo",
    type: "text",
    label: "توضیح اشتراک‌گذاری (OG)",
    default: "با هوش نخل سفارش بده، مثل حضوری!",
  },
  {
    key: "seo.keywords",
    group: "seo",
    type: "text",
    label: "کلمات کلیدی (با کاما جدا کنید)",
    default: "رستوران نخل, رفسنجان, سفارش آنلاین غذا, هوش مصنوعی, رستوران",
  },
];

// ── lookup helpers ──

export const CONTENT_DEFS: readonly ContentDef[] = DEFS;

const DEF_BY_KEY: Record<string, ContentDef> = Object.fromEntries(
  DEFS.map((d) => [d.key, d]),
);

export function getContentDef(key: string): ContentDef | undefined {
  return DEF_BY_KEY[key];
}

/** Default values keyed by content key (fallback map for the storefront). */
export function defaultContentMap(): Record<string, string> {
  return Object.fromEntries(DEFS.map((d) => [d.key, d.default]));
}

/** Maximum stored length per field type (validated on save). */
export const CONTENT_MAX_LENGTH: Record<ContentType, number> = {
  text: 600,
  textarea: 4000,
  image: 1000,
};

/**
 * Interpolate `{placeholder}` tokens with the given variables.
 * Unknown tokens are left untouched so the admin sees them literally.
 */
export function interpolateContent(
  text: string,
  vars: Record<string, string>,
): string {
  if (!text.includes("{")) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : match,
  );
}
