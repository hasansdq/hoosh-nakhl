/* Attach generated images to menu items */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const MAP: Record<string, string> = {
  "کباب کوبیده": "/food/koobideh.png",
  "جوجه‌کباب زعفرانی": "/food/joojeh.png",
  "کباب برگ": "/food/barg.png",
  "شیشلیک": "/food/shishlik.png",
  "کباب بختیاری": "/food/bakhtiari.png",
  "چنجه": "/food/chenjeh.png",
  "قورمه‌سبزی": "/food/ghormeh.png",
  "قیمه‌سیب": "/food/gheyme.png",
  "فسنجان": "/food/fesenjan.png",
  "خورشت بامیه": "/food/bamieh.png",
  "زرشک‌پلو با مرغ": "/food/zereshk.png",
  "باقالی‌پلو با گوشت": "/food/baghali.png",
  "لوبیاپلو با گوشت چرخ‌شده": "/food/lobia.png",
  "کلمپهٔ کرمانی": "/food/kalame.png",
  "آش رفسنجانی": "/food/soup.png",
  "سالاد شیرازی": "/food/shirazi.png",
  "کشک بادمجان": "/food/kashk.png",
  "سوپ جو": "/food/soup.png",
  "شله‌زرد": "/food/sholezard.png",
  "بستنی سنتی زعفرانی": "/food/bastani.png",
  "دوغ محلی": "/food/doogh.png",
  "موهیتو": "/food/mojito.png",
};

async function main() {
  let updated = 0;
  for (const [name, url] of Object.entries(MAP)) {
    const r = await db.menuItem.updateMany({ where: { name }, data: { imageUrl: url } });
    updated += r.count;
  }
  console.log(`✅ ${updated} menu items now have images`);
}

main().finally(() => db.$disconnect());
