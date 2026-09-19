---
Task ID: 15-a
Agent: full-stack-developer (subagent 15-a)
Task: Customer favorites + recently viewed items feature

Work Log:
- خواندن worklog + agent-ctx + فایل‌های کلیدی پروژه (schema.prisma، auth.ts، api.ts، store.ts، HomeView.tsx، ProfileView.tsx، AuthModal.tsx، cart-store.ts، sms/index.ts، client-api.ts، menu/route.ts، reviews/route.ts) برای تطابق با کنوانسیون‌ها (requireUser از @/lib/api، ok/fail JSON shape، sonner برای toast، useAppStore/Zustand موجود، سبد خرید با cart-store جداگانه، dev OTP در پاسخ send-otp برگردانده می‌شود).
- Prisma: افزودن `model Favorite` با id/userId/menuItemId/createdAt/relations + `@@unique([userId, menuItemId])` و `@@index([userId])`. افزودن `favorites Favorite[]` به User (بین reviews) و به MenuItem (بین reviews). `bun run db:push` موفق (Generated Prisma Client v6.19.2 در ۲۰۳ms). `touch next.config.ts` برای restart dev server — بعد از ~۲۰ ثانیه `/api/favorites` از ۴۰۴ به ۴۰۱ (auth-needed) رفت، یعنی endpoint فعال شد.
- NEW API: `src/app/api/favorites/route.ts` — GET (requireUser → 401 if not logged in, برمی‌گرداند `{ success, favorites: [{ id, menuItemId, menuItem: { id, name, description, price, imageUrl, gallery: string[], isAvailable, isSpecial, isDrink, calories, prepTime } }] }` با orderBy createdAt desc و include menuItem select). POST (requireUser، validate menuItemId exists + isAvailable، create با catch P2002 → idempotent return با alreadyExists: true و رکورد موجود). Zod validation روی menuItemId. 404/400 به‌فرمت فارسی. `mapFavorite` helper برای یکنواخت‌سازی shape.
- NEW API: `src/app/api/favorites/[id]/route.ts` — DELETE (requireUser + ownership check با findFirst userId+id، 404 اگر not-owned، delete، return `{ success, message }`). پترن `ctx: { params: Promise<{ id: string }> }` برای Next.js 16 (await ctx.params).
- EDITED store.ts: افزودن `FavoriteItem` interface (id, menuItemId, menuItem: MenuItemPublic). افزودن state `favorites: FavoriteItem[]`، `favoriteIds: string[]` (derived)، `favoritesLoading`، `recentlyViewed: string[]`، `recentlyViewedHydrated`. افزودن actions:
  - `refreshFavorites()` — اگر !user → set []، در غیر این صورت GET /api/favorites → set favorites + favoriteIds.
  - `isFavorite(menuItemId)` — helper O(1) روی favoriteIds.
  - `toggleFavorite(menuItemId)` — اگر !user → setAuthOpen(true) + toast.info «برای ذخیره علاقه‌مندی‌ها وارد شوید» + return false. در غیر این صورت optimistic update (remove یا add itemId)، API call (DELETE یا POST با reconciliation از response canonical)، rollback روی error، toast.success/error برای هر state.
  - `hydrateRecentlyViewed()` — خواندن از localStorage (key `nakhl-recently-viewed`)، parse با fallback امن.
  - `recordRecentlyViewed(menuItemId)` — unshift + dedupe + cap at 12 + write localStorage.
  - `refreshUser()` — بعد از set user (auth موفق)، fire-and-forget `refreshFavorites()` تا favorites خودکار sync شوند. در logout (user=null) favorites و favoriteIds را reset می‌کند.
  - افزودن import `toast` from sonner برای toast داخل store (sonner خارج React هم callable است).
- EDITED HomeView.tsx:
  - افزودن `Heart` به imports از lucide-react.
  - جدید: `FavoriteToggle` local component — props `itemId, itemName, positionClass`. subscribe به `favoriteIds.includes(itemId)` با useAppStore selector برای re-render. onClick: stopPropagation + preventDefault (برای جلوگیری از trigger onClick والد که lightbox را باز می‌کند) + void toggleFavorite(itemId). شکل: `absolute ${positionClass} z-20 h-8 w-8 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center` + `text-white/90 hover:text-red-500` (outline) یا `text-red-500` + `fill-red-500` (favorited). aria-pressed + aria-label فارسی + title فارسی.
  - `AddToCartButton`: افزودن `recordRecentlyViewed(item.id)` در handleAdd.
  - `MenuCard`: افزودن `recordRecentlyViewed` در openLightbox (هنگام باز کردن گالری). افزودن `<FavoriteToggle positionClass="absolute right-2.5 top-2.5" />` داخل image container. جابجایی badgeهای موجود: catName از top-right به top-left (`left-2.5 top-2.5`)، isSpecial از top-left به زیر catName (`left-2.5 top-12`) تا با heart در top-right تداخل نداشته باشد. (badgeهای bottom-left: ZoomIn و hasGallery Images بدون تغییر باقی ماندند).
  - `SpecialCard`: افزودن `recordRecentlyViewed` در openLightbox. افزودن `<FavoriteToggle positionClass="absolute left-3 top-3" />` (top-left چون top-right با badge «ویژه» اشغال است). جابجایی ZoomIn از top-left به bottom-right (`right-3 bottom-3`) تا با heart تداخل نداشته باشد. (badge «ویژه» top-right و hasGallery Images bottom-left بدون تغییر).
  - HomeView main: افزودن subscription به `favorites`, `recentlyViewed`, `hydrateRecentlyViewed`. افزودن useEffect برای hydrateRecentlyViewed در mount.
  - جدید سکشن ۱: «موردعلاقه‌های شما ❤️» — نمایش فقط اگر `user && favorites.length > 0`. layout: horizontal scroll (`flex gap-4 overflow-x-auto pb-3 nice-scroll`) از MenuCardهای favorite.menuItem (w-72 sm:w-80 shrink-0). header با آیکون Heart قرمز + Badge شمارنده با toPersianDigits.
  - جدید سکشن ۲: «اخیراً دیده‌شده‌ها 👀» — نمایش فقط اگر `recentlyViewed.length > 0` (حتی اگر user null باشد — localStorage-based است). lookup آیتم‌ها از menu store با fallback امن (اگر آیتم در منوی فعلی نباشد skip می‌شود، و اگر همه ناموجود شوند یک پیغام فارسی نشان داده می‌شود). همان layout افقی.
  - ترتیب قرارگیری: Hero → Coupon → Specials → Favorites (اگر user + length>0) → Recently Viewed (اگر length>0) → Stats Band → ... (تطابق با spec که گفت «After the special items section» و «After favorites OR if not logged in»).
- EDITED ProfileView.tsx:
  - افزودن imports: `Heart`, `ShoppingCart` از lucide-react، `useAppStore, type FavoriteItem` از store، `useCartStore` از cart-store، `formatToman` از fa.
  - بازنویسی destructure: استفاده از useAppStore selectors جداگانه (user, refreshUser, refreshFavorites, setView, favorites, toggleFavorite) + addItem از useCartStore. حذف setUser (استفاده نشده).
  - افزودن `useEffect` با dependency [user, refreshFavorites] که refreshFavorites را در mount user صدا بزند (idempotent — store cache می‌کند).
  - جدید Card «موردعلاقه‌های من» با CardTitle (آیکون Heart قرمز) و Badge شمارنده — قرار گرفته بین profile header Card و addresses Card. اگر favorites.length === 0: empty state با border-dashed + آیکون Heart بزرگ + متن «هنوز هیچ غذایی را به علاقه‌مندی‌هایتان اضافه نکرده‌اید.» + توضیح «به منو بروید و روی قلب هر غذا کلیک کنید تا در اینجا ذخیره شود.» + Button «مشاهده منو» که setView('home') می‌کند. در غیر این صورت: grid 1/2/3 از FavoriteRowها.
  - جدید: `FavoriteRow` local component — props `fav, onAddToCart, onRemove`. مشابه MenuCard: تصویر h-36 + badges (ویژه/ناموجود)، name + price (formatToman)، description line-clamp-2، دو دکمه: «افزودن به سبد» (ShoppingCart آیکون، disabled اگر !isAvailable، در صورت موفقیت toast.success) و «حذف از علاقه‌مندی‌ها» (Heart با fill-red-500، variant outline با text-red-500 hover:bg-red-500/10، صدا زدن onRemove که toggleFavorite را صدا می‌زند).
- Behavioral touches تأیید: `recordRecentlyViewed` در AddToCartButton.handleAdd + در MenuCard/SpecialCard openLightbox. `refreshFavorites` در refreshUser بعد از موفقیت auth. `toggleFavorite` در FavoriteToggle روی همه card types. وقتی user لاگ‌این می‌شود، AuthModal مسیر refreshUser را طی می‌کند → favorites خودکار sync.
- Validation:
  - `bun run lint` → exit 0، 0 errors 0 warnings.
  - curl GET /api/favorites (no auth) → 401 «برای ذخیره علاقه‌مندی‌ها ابتدا وارد شوید» ✓.
  - Browser E2E با session ایزوله `nakhl-15a-favorites` روی gateway :81:
    * روی home با user لاگ‌اوت: click heart روی کباب کوبیده (Specials section) → AuthModal باز شد + toast «برای ذخیره علاقه‌مندی‌ها وارد شوید» ✓.
    * ورود با phone 09131234567 (قاسم محمدی موجود) + OTP (dev mode: code از پاسخ send-otp دریافت شد: 32154) → ورود موفق، auto-redirect به chat view (طبق AuthModal) → رفت به home → heart روی کباب کوبیده اکنون «حذف کباب کوبیده از علاقهمندیها» (filled red) ✓ + سکشن جدید «موردعلاقه‌های شما ❤️» با 1 کارت کباب کوبیده ظاهر شد ✓.
    * Add-to-cart روی کباب برگ، کباب کوبیده، زرشک‌پلو → سکشن «اخیراً دیده‌شده‌ها 👀» با 3 کارت (به ترتیب جدید به قدیم: زرشک‌پلو، کباب کوبیده، کباب برگ) ظاهر شد ✓ + localStorage به `[3 ids]` update شد ✓.
    * favorite دوم: کلیک heart روی کباب برگ → سکشن favorites 2 کارت شد ✓.
    * رفت به profile → سکشن «موردعلاقه‌های من» با 2 کارت (زرشک‌پلو + کباب برگ) + دکمه‌های «افزودن به سبد» و «حذف از علاقه‌مندی‌ها» ✓.
    * کلیک «حذف از علاقه‌مندی‌ها» روی کباب کوبیده در profile → favorite حذف شد (DELETE /api/favorites/{id} 200 در dev.log) → وقتی همه favoriteها حذف شدند، empty state با متن «هنوز هیچ غذایی را...» + دکمه «مشاهده منو» ✓.
    * کلیک «مشاهده منو» → navigate به home view ✓.
    * افزودن دوباره 2 favorite (کباب برگ + زرشک‌پلو) روی home → سکشن favorites برگشت ✓.
  - dev.log: فقط GET/POST/DELETE /api/favorites 200/401 (مطابق انتظار) + prisma:query SELECTها برای favorite و menuItem و order. هیچ runtime error یا exception.
- Screenshots (در /home/z/my-project/qa/):
  - round15-favorites-home.png — صفحه home با user لاگ‌این شده، سکشن «موردعلاقه‌های شما ❤️» با 2 کارت (زرشک‌پلو + کباب برگ) و سکشن «اخیراً دیده‌شده‌ها 👀» با 3 کارت.
  - round15-favorites-profile.png — صفحه profile با سکشن «موردعلاقه‌های من» و 2 کارت favorite + دکمه‌های افزودن به سبد و حذف.
  - round15-favorites-profile-empty.png — حالت empty state با متن «هنوز هیچ غذایی را...» + دکمه «مشاهده منو».
  - round15-favorites-home-2.png — اسکرین‌شات کمکی از صفحه home (scroll پایین‌تر).

Stage Summary:
- NEW schema: `Favorite` model (id, userId, menuItemId, createdAt, relations, @@unique, @@index) + relations روی User و MenuItem.
- NEW API: `/api/favorites` (GET list + POST create با P2002 idempotent) و `/api/favorites/[id]` (DELETE با ownership check). همگی requireUser با 401 فارسی «برای ذخیره علاقه‌مندی‌ها ابتدا وارد شوید».
- EDITED store: افزودن favorites/favoriteIds/favoritesLoading state + refreshFavorites/isFavorite/toggleFavorite actions با optimistic UI + rollback + toast در store (sonner callable خارج React). افزودن recentlyViewed/recentlyViewedHydrated state + hydrateRecentlyViewed/recordRecentlyViewed actions با localStorage key `nakhl-recently-viewed` (max 12 + dedupe). refreshUser بعد از auth موفق refreshFavorites را صدا می‌زند.
- EDITED HomeView: افزودن `FavoriteToggle` local component (heart button با fill-red-500 + bg-black/30 backdrop-blur-sm)، heart button روی MenuCard (top-right) و SpecialCard (top-left)، جابجایی badgeهای موجود برای جلوگیری از تداخل، سکشن «موردعلاقه‌های شما ❤️» (فقط اگر user + favorites>0) با horizontal scroll از MenuCardها، سکشن «اخیراً دیده‌شده‌ها 👀» (اگر recentlyViewed>0، مستقل از user) با horizontal scroll. recordRecentlyViewed در AddToCartButton و در openLightbox فراخوانی می‌شود.
- EDITED ProfileView: سکشن «موردعلاقه‌های من» Card بین header و addresses با grid 1/2/3 از FavoriteRow (تصویر + name + price + افزودن به سبد + حذف از علاقه‌مندی‌ها)، empty state با متن فارسی + دکمه «مشاهده منو».
- Verification: lint exit 0 (0/0). E2E browser QA PASS: heart روی guest → AuthModal + toast؛ login با 09131234567 + dev OTP (32154) → heart اکنون filled red + سکشن favorites ظاهر شد؛ add-to-cart 3 آیتم → سکشن recently-viewed با ترتیب جدید-به-قدیم ظاهر شد + localStorage همگام؛ profile → سکشن موردعلاقه‌های من با 2 کارت + دکمه‌های add-to-cart/remove؛ remove همه favorites → empty state؛ re-favorite → بازگشت سکشن. dev.log تمیز (فقط 200/401 on /api/favorites + Prisma queries).
- Files explicitly NOT touched: prisma/schema.prisma فایل‌های ادمین (AdminPanel, AdminDashboard, OrdersManager, MenuManager)، ChatView، page.tsx (به‌جز store integration نیازی نبود — HomeView به‌تنهایی hydrateRecentlyViewed را صدا می‌زند)، notify-service، TrackView/OrdersView، globals.css، sw.js، manifest.json، هیچ فایل 3-b یا 3-a.
