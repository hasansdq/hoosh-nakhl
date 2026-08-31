/* Seed — Nakhl Restaurant: admin, categories, menu, settings */
import { PrismaClient } from "@prisma/client";
import { scryptSync, randomBytes } from "crypto";

const db = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

async function main() {
  console.log("🌱 Seeding Nakhl Restaurant...");

  // ---- Admin ----
  const adminExists = await db.adminUser.findUnique({ where: { username: "rayantech" } });
  if (!adminExists) {
    await db.adminUser.create({
      data: {
        username: "rayantech",
        passwordHash: hashPassword("Hasan78484@"),
        displayName: "مدیر رستوران نخل",
      },
    });
    console.log("✅ Admin created: rayantech");
  }

  // ---- Settings defaults ----
  const defaults: Record<string, unknown> = {
    ai: {
      provider: "zai", apiKey: "", model: "", baseUrl: "", temperature: 0.7,
      maxTokens: 900, topP: 0.95, presencePenalty: 0, frequencyPenalty: 0,
      systemPromptExtra: "", maxHistoryMessages: 14, requestTimeout: 60,
      friendlyTone: true, suggestBestSellers: true, allowSmallTalk: true, maxItemsPerOrder: 30,
    },
    sms: {
      provider: "none", devMode: true,
      otpTemplate: "رستوران نخل\nکد تأیید شما: {code}\nاین کد تا {ttl} دقیقه معتبر است.",
      otpTtlMinutes: 3, otpLength: 5,
      melipayamakAuthType: "apikey", melipayamakApiKey: "", melipayamakUsername: "",
      melipayamakPassword: "", melipayamakFrom: "",
      smsirApiKey: "", smsirFrom: "", smsirTemplateId: "", smsirOtpParam: "CODE",
    },
    payment: {
      merchantId: "", sandbox: true, simulationMode: true, currency: "IRR",
      description: "پرداخت سفارش رستوران نخل", callbackUrl: "",
    },
    general: {
      restaurantName: "رستوران نخل", restaurantTagline: "طعم اصیل رفسنجان، با نوآوری هوش مصنوعی",
      address: "رفسنجان، بلوار شهید مطهری، نبش کوچه نخل، پلاک ۱۲", phone: "03434300000",
      workingHours: "همه روزه از ساعت ۱۲ ظهر تا ۱۲ شب", taxPercent: 10, deliveryFee: 35000,
      minOrderAmount: 100000, freeDeliveryOver: 500000, city: "رفسنجان",
      instagram: "nakhl.rafsanjan", telegram: "nakhl_restaurant",
      aboutText: "رستوران نخل رفسنجان با بیش از یک دهه تجربه در ارائه غذاهای اصیل ایرانی، اکنون با هوش مصنوعی «هوش نخل» تجربه سفارش‌دهی جدیدی را به شما هدیه می‌دهد.",
    },
  };
  for (const [key, value] of Object.entries(defaults)) {
    await db.setting.upsert({
      where: { key },
      update: {},
      create: { key, value: JSON.stringify(value), group: key },
    });
  }
  console.log("✅ Settings seeded");

  // ---- Categories ----
  const catData = [
    { name: "کباب‌ها", slug: "kebabs", icon: "flame", sortOrder: 1 },
    { name: "خورشت‌های ایرانی", slug: "stews", icon: "soup", sortOrder: 2 },
    { name: "پلوها", slug: "rice", icon: "wheat", sortOrder: 3 },
    { name: "غذاهای محلی کرمان", slug: "local", icon: "map-pin", sortOrder: 4 },
    { name: "پیش‌غذا و سالاد", slug: "starters", icon: "salad", sortOrder: 5 },
    { name: "دسر", slug: "desserts", icon: "ice-cream", sortOrder: 6 },
    { name: "نوشیدنی‌ها", slug: "drinks", icon: "cup-soda", sortOrder: 7 },
  ];
  const cats: Record<string, string> = {};
  for (const c of catData) {
    const existing = await db.category.findUnique({ where: { slug: c.slug } });
    const row = existing ?? (await db.category.create({ data: c }));
    cats[c.slug] = row.id;
  }
  console.log("✅ Categories seeded");

  // ---- Menu items ----
  const items = [
    // کباب‌ها
    { name: "کباب کوبیده", cat: "kebabs", price: 185000, desc: "دو سیخ کباب کوبیده اصیل با گوشت گوسفندی، گوجه کبابی و نان تازه", special: true, cal: 720, prep: 25, ing: "گوشت گوسفندی، پیاز، زعفران" },
    { name: "جوجه‌کباب زعفرانی", cat: "kebabs", price: 215000, desc: "دو سیخ جوجه‌کباب تازه با سس زعفرانی استثنایی نخل", special: false, cal: 640, prep: 25, ing: "مرغ، زعفران، آب‌لیمو" },
    { name: "کباب برگ", cat: "kebabs", price: 395000, desc: "برش‌های فیله گوسفندی مرینیت‌شده در پیاز و زعفران", special: true, cal: 850, prep: 35, ing: "فیله گوسفندی، پیاز، زعفران" },
    { name: "شیشلیک", cat: "kebabs", price: 450000, desc: "دو سیخ شیشلیک چنجه‌ای با استخوان، تخصص سرآشپز نخل", special: false, cal: 920, prep: 40, ing: "گوشت گوسفندی، فلفل دلمه، پیاز" },
    { name: "کباب بختیاری", cat: "kebabs", price: 295000, desc: "ترکیب فیله مرغ و گوشت چرخ‌شده با زیره‌ی محلی", special: false, cal: 780, prep: 30, ing: "مرغ، گوشت، زیره" },
    { name: "چنجه", cat: "kebabs", price: 320000, desc: "کباب چنجهٔ گوشت گوسفندی با ادویه‌های محلی رفسنجان", special: false, cal: 810, prep: 35, ing: "گوشت، ادویه محلی" },
    // خورشت‌ها
    { name: "قورمه‌سبزی", cat: "stews", price: 165000, desc: "قورمه‌سبزی سنتی با سبزی تازه و گوشت گوسفندی، سرو با برنج ایرانی", special: false, cal: 690, prep: 20, ing: "سبزی، گوشت، لوبیا قرمز" },
    { name: "قیمه‌سیب", cat: "stews", price: 145000, desc: "قیمه با سیب‌زمینی سرخ‌شده و رب گوجه‌ی خانگی", special: false, cal: 610, prep: 20, ing: "گوشت، سیب‌زمینی، گوجه" },
    { name: "فسنجان", cat: "stews", price: 195000, desc: "خورشت فسنجان با گردوی تازه و رب انار خانگی", special: false, cal: 750, prep: 25, ing: "گردو، انار، مرغ" },
    { name: "خورشت بامیه", cat: "stews", price: 175000, desc: "بامیهٔ تازه با سس گوجه و گوشت، مخصوص فصل", special: false, cal: 620, prep: 25, ing: "بامیه، گوشت، گوجه" },
    // پلوها
    { name: "زرشک‌پلو با مرغ", cat: "rice", price: 215000, desc: "زرشک‌پلوی زعفرانی با ران مرغ و پوست پر شده", special: true, cal: 820, prep: 30, ing: "برنج، زعفران، مرغ، زرشک" },
    { name: "باقالی‌پلو با گوشت", cat: "rice", price: 285000, desc: "باقالی‌پلوی ماهیتی با گوشت سردست، ویژهٔ آخر هفته", special: false, cal: 880, prep: 35, ing: "برنج، باقالی، گوشت" },
    { name: "لوبیاپلو با گوشت چرخ‌شده", cat: "rice", price: 155000, desc: "لوبیاپلوی خانگی با سالاد فصل", special: false, cal: 700, prep: 25, ing: "برنج، لوبیا، گوشت" },
    // محلی
    { name: "کلمپهٔ کرمانی", cat: "local", price: 95000, desc: "نان محلی کرمان با گردو و خرماى مضافتی، خاص رفسنجان", special: true, cal: 540, prep: 15, ing: "آرد، گردو، خرمای مضافتی" },
    { name: "آش رفسنجانی", cat: "local", price: 85000, desc: "آش محلی رفسنجان با سبزیجات معطر و حبوبات", special: false, cal: 460, prep: 20, ing: "سبزی، حبوبات، آش" },
    { name: "کوکوی سبزی محلی", cat: "local", price: 75000, desc: "کوکوی سبزی سنتی با ماست و خیار", special: false, cal: 380, prep: 15, ing: "سبزی، تخم‌مرغ" },
    // پیش‌غذا
    { name: "سالاد شیرازی", cat: "starters", price: 45000, desc: "سالاد شیرازی تازه با آبغورهٔ طبیعی", special: false, cal: 120, prep: 5, ing: "گوجه، خیار، پیاز" },
    { name: "کشک بادمجان", cat: "starters", price: 75000, desc: "کشک بادمجان با نعناع داغ و گردوی تازه", special: false, cal: 320, prep: 10, ing: "بادمجان، کشک، گردو" },
    { name: "ماست و خیار", cat: "starters", price: 35000, desc: "ماست‌و‌خیار خانگی با پونه و گلپر", special: false, cal: 150, prep: 3, ing: "ماست، خیار" },
    { name: "سوپ جو", cat: "starters", price: 65000, desc: "سوپ جو با هویج و جعفری تازه", special: false, cal: 240, prep: 8, ing: "جو، هویج، مرغ" },
    // دسر
    { name: "شله‌زرد", cat: "desserts", price: 55000, desc: "شله‌زرد زعفرانی با تزیین پسته و بادام", special: false, cal: 310, prep: 5, ing: "برنج، زعفران، گلاب" },
    { name: "حلوا", cat: "desserts", price: 45000, desc: "حلواى سنتی رفسنجان با زعفران", special: false, cal: 280, prep: 5, ing: "آرد، زعفران، گلاب" },
    { name: "بستنی سنتی زعفرانی", cat: "desserts", price: 65000, desc: "بستنی سنتی با زعفران و خلال پسته", special: true, cal: 340, prep: 3, ing: "شیر، زعفران، پسته" },
    // نوشیدنی
    { name: "نوشابه", cat: "drinks", price: 25000, desc: "نوشابهٔ سرد خانواده", special: false, cal: 140, prep: 1, ing: "-", drink: true },
    { name: "دوغ محلی", cat: "drinks", price: 30000, desc: "دوغ محلی گازدار با پونه", special: false, cal: 60, prep: 1, ing: "ماست، پونه", drink: true },
    { name: "آب معدنی", cat: "drinks", price: 15000, desc: "آب معدنی طبیعی کویر", special: false, cal: 0, prep: 1, ing: "-", drink: true },
    { name: "موهیتو", cat: "drinks", price: 65000, desc: "موهیتوی نعناع تازه با لیمو و سودا", special: true, cal: 180, prep: 5, ing: "نعناع، لیمو", drink: true },
    { name: "شربت خاکشیر", cat: "drinks", price: 35000, desc: "شربت خاکشیر سنتی با یخ", special: false, cal: 90, prep: 2, ing: "خاکشیر", drink: true },
    { name: "شربت بهارنارنج", cat: "drinks", price: 35000, desc: "شربت بهارنارنج اصیل کرمان", special: false, cal: 110, prep: 2, ing: "بهارنارنج", drink: true },
    { name: "دمنوش آویشن", cat: "drinks", price: 40000, desc: "دمنوش آویشن کوهی با عسل", special: false, cal: 40, prep: 5, ing: "آویشن، عسل", drink: true },
  ];

  let created = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const exists = await db.menuItem.findFirst({ where: { name: it.name } });
    if (!exists) {
      await db.menuItem.create({
        data: {
          name: it.name,
          description: it.desc,
          price: it.price,
          categoryId: cats[it.cat],
          isSpecial: it.special,
          isDrink: !!it.drink,
          calories: it.cal,
          prepTime: it.prep,
          ingredients: it.ing,
          sortOrder: i,
          isAvailable: true,
        },
      });
      created++;
    }
  }
  console.log(`✅ Menu items: ${created} created, ${items.length - created} existed`);
  console.log("🎉 Seed complete!");
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
