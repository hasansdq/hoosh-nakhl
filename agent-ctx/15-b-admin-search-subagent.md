---
Task ID: 15-b
Agent: full-stack-developer (subagent 15-b)
Task: Admin Cmd+K global search command palette

Work Log:
- خواندن worklog + agent-ctx (به‌خصوص 15-a که در همان راند اجرا شد) برای اطمینان از عدم تداخل: فایل‌های ممنوعه (prisma/schema.prisma، HomeView.tsx، ProfileView.tsx، store.ts، /api/favorites/*، ChatView.tsx) دست نخورده ماند. خواندن الگوهای موجود در AdminPanel.tsx، auth.ts، api.ts (requireAdmin, ok/fail)، stats route.ts، orders route.ts (الگوی `where: { OR: [{orderNumber:{contains:q}}, {user:{OR:[...]}}] }` + include user)، OrdersManager.tsx، UsersManager.tsx، MenuManager.tsx، CouponsManager.tsx، fa.ts (formatToman, toPersianDigits, formatPhone, timeAgo)، dialog.tsx (shadcn با radix-overlay + content centered). تأیید نصب cmdk@1.1.1 در package.json + لیست exports (Command, Item, Group, List, Input, Empty, Loading, Separator).
- NEW src/app/api/admin/search/route.ts (GET):
  - requireAdmin → 401 «دسترسی غیرمجاز» در صورت نبود session (الگوی موجود).
  - query param `q` (URL-encoded)؛ trim؛ اگر length<2 → `ok({ results: { orders:[], users:[], menuItems:[], coupons:[] }, took: 0 })` (بدون round-trip به DB — palette به‌جای آن recent searches از localStorage نشان می‌دهد).
  - In-memory cache با global Map (`__nakhlAdminSearchCache`) با TTL 30s، keyed by query. bypass cache برای empty q. bounded cleanup وقتی cache.size>50 (حذف expired entries).
  - جستجوی موازی با `Promise.all`:
    * Orders: `where: { OR: [{orderNumber:{contains:qUpper}}, {orderNumber:{contains:q}}, {user:{OR:[{firstName:{contains:q}}, {lastName:{contains:q}}, {phone:{contains:q}}]}}] }` با include user (firstName/lastName/phone) + orderBy createdAt desc + take 8. map به `{ type:'order', id, orderNumber, userName: '${firstName} ${lastName}'.trim() || phone, total, status, paymentStatus, createdAt }`.
    * Users: `where: { OR: [{firstName:{contains:q}}, {lastName:{contains:q}}, {phone:{contains:q}}] }` + orderBy createdAt desc + take 8. map به `{ type:'user', id, firstName, lastName, phone, createdAt }`.
    * MenuItems: `where: { OR: [{name:{contains:q}}, {description:{contains:q}}] }` + orderBy name asc + take 8. map به `{ type:'menu', id, name, price, isAvailable, isSpecial, imageUrl }`.
    * Coupons: `where: { OR: [{code:{contains:qUpper}}, {code:{contains:q}}, {title:{contains:q}}] }` + orderBy createdAt desc + take 5. map به `{ type:'coupon', id, code, title, couponType, value, isActive }`.
  - SQLite `contains` case-sensitive برای ASCII است؛ `qUpper = q.toUpperCase()` برای جستجوی orderNumber/coupon.code (که UPPERCASE ذخیره می‌شوند NK-XXXX / PALM20) اضافه شد تا تایپ "palm" کد PALM20 را پیدا کند. برای Persian text case‌ irrelevant است.
  - Response: `{ success, results: { orders, users, menuItems, coupons }, took: <ms> }`.
- NEW src/components/admin/AdminSearchPalette.tsx ('use client'):
  - imports: cmdk Command primitive + Dialog/DialogContent/DialogTitle (shadcn که روی radix-overlay سوار است) + Avatar/Badge + api + fa helpers + lucide icons (Search, Loader2, ShoppingBag, Users, UtensilsCrossed, Ticket, X, Clock, CornerDownLeft, ArrowUpDown).
  - Props: `{ open: boolean; onClose: () => void; onSelect: (sel: AdminSearchSelection) => void }`. AdminSearchSelection = `{ type: 'order'|'user'|'menu'|'coupon'; id; label?; filter? }`.
  - Dialog shadcn با className override به top-anchored: `fixed top-[10vh] left-1/2 -translate-x-1/2 translate-y-0 max-w-2xl rounded-2xl border border-primary/20 bg-card p-0 shadow-2xl` + animation `data-[state=open]:slide-in-from-top-2`. showCloseButton=false (چون cmdk خودش escape/close را handle می‌کند).
  - DialogTitle با sr-only (برای a11y، چون visual title نمی‌خواهیم).
  - cmdk Command با shouldFilter={false} (server-side search می‌کنیم، نه client-side command-score) + loop (arrow keys wrap).
  - Input row: h-12 + Search icon (right-4 RTL) + Loader2 spinner (left-4 وقتی loading) + دکمه X (left-3 وقتی query غیر-empty) برای clear. placeholder فارسی «جستجوی سفارش‌ها، کاربران، منو، کدهای تخفیف... (⌘K)».
  - List: max-h-[60vh] overflow-y-auto + nice-scroll (custom scrollbar از globals.css).
  - Empty state (query<2 chars):
    * اگر recent searches در localStorage (`nakhl-admin-recent-searches` key) موجود باشد: chipهایی به‌شکل pill button که با کلیک، query را set می‌کنند و search را دوباره run می‌کنند.
    * در غیر این صورت: آیکون Search بزرگ + پیام فارسی + hint ⌘K.
  - Results: 4 گروه با heading (آیکون + label + count badge فارسی):
    * «سفارش‌ها» — هر row: آیکون ShoppingBag + orderNumber (LTR) + «کد سفارش» + «مشتری: {userName}» + timeAgo + Badge paymentStatus + Badge status + price chip.
    * «کاربران» — هر row: Avatar (initial حرف اول نام) + name + phone (LTR) + timeAgo.
    * «منو» — هر row: تصویر ۴۰px با Image از next/image (object-cover) + name + Badge «ناموجود»/«ویژه» + price chip.
    * «کپون‌ها» — هر row: Ticket آیکون + code chip (mono LTR) + title + Badge غیرفعال (اگر) + Badge value (درصد یا مبلغ).
  - هر Item: hover:bg-primary/10 + data-[selected=true]:bg-primary/15 + data-[selected=true]:ring-1 ring-primary/20 (طلایی‌متمایل با accent primary).
  - Command.Empty: «نتیجه‌ای برای «{query}» یافت نشد» وقتی totalResults==0 و !loading.
  - Footer: hint chips با ArrowUpDown/CornerDownLeft/Escape/⌘K آیکون‌ها + متن فارسی (انتخاب/رفتن/بستن/باز کردن).
  - Debounced search 200ms + reqIdRef (افزایشی) برای discard stale responses.
  - Recent searches: localStorage key `nakhl-admin-recent-searches` با max 6 + dedupe؛ در handleSelect (وقتی user یک result را pick می‌کند) query فعلی به recent اضافه می‌شود.
  - Reset روی close: query="", results=EMPTY_RESULTS, loading=false.
  - FOCUS: inputRef.current?.focus() در mount با setTimeout 60ms.
- EDITED src/components/admin/OrdersManager.tsx (حداقلی):
  - import useRef اضافه شد.
  - signature: `({ initialFilter }: { initialFilter?: string } = {})`.
  - load() اکنون `(p = page, opts?: { search?: string })` می‌پذیرد و از `q = opts?.search ?? search` استفاده می‌کند.
  - firstRender ref برای skip کردن [page, statusFilter] effect در mount اولیه (جلوگیری از double-fetch).
  - mount-only useEffect: اگر initialFilter باشد → setSearch(initialFilter) + load(1, { search: initialFilter })، در غیر این صورت load(1).
- EDITED src/components/admin/UsersManager.tsx (حداقلی، الگوی مشابه OrdersManager):
  - import useRef.
  - signature: `({ initialFilter }: { initialFilter?: string } = {})`.
  - load() اکنون `(p = 1, opts?: { search?: string })` می‌پذیرد.
  - firstRender ref + mount-only effect.
- EDITED src/components/admin/MenuManager.tsx (حداقلی):
  - signature: `({ initialFilter }: { initialFilter?: string } = {})`.
  - در mount effect (که load را صدا می‌زند)، اگر initialFilter باشد → setSearch(initialFilter). filtered list client-side است (search state → `items.filter(i => i.name.includes(search))`)، پس no extra fetch لازم نیست.
- EDITED src/components/admin/AdminPanel.tsx:
  - import AdminSearchPalette + AdminSearchSelection + Search icon.
  - state جدید: `searchOpen: boolean` و `searchNav: { tab: AdminTab; filter?: string; nonce: number } | null` (nonce = Date.now() برای remount manager در هر selection جدید).
  - useEffect با document keydown listener: اگر `(e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K' || e.key === 'چ')` → e.preventDefault() + setSearchOpen(true). (چ = Cmd+K در کیبورد فارسی با shift).
  - handleSearchSelect(sel): setSearchOpen(false) + map type به tab (order→'orders'، user→'users'، menu→'menu'، coupon→'coupons') + setSearchNav({ tab, filter: sel.filter, nonce: Date.now() }) + setTab(tabForSel).
  - Top bar: دکمه جستجو قبل از live indicator اضافه شد — gold-bordered (border-gold/40 bg-gold/5 text-gold-foreground)، h-9، آیکون Search + «جستجوی سریع...» (hidden در mobile) + kbd ⌘K (gold-tinted).
  - main content: MenuManager، OrdersManager، UsersManager اکنون با `key={searchNav?.tab === 'X' ? 'X-${nonce}' : 'X'}` و `initialFilter={searchNav?.tab === 'X' ? searchNav.filter : undefined}` رندر می‌شوند. این patterns باعث می‌شود در هر selection جدید، manager با initialFilter جدید remount شود.
  - mount AdminSearchPalette در پایان component با open={searchOpen} + onClose + onSelect.
- Validation:
  - `bun run lint` → exit 0، 0 errors 0 warnings. (چند round iterate برای پیدا کردن الگوی صحیح eslint-disable comments — rule `react-hooks/set-state-in-effect` فقط روی FIRST setState در هر effect branch fires می‌کند، نه روی subsequent load() calls.)
  - curl smoke tests با session واقعی admin (login via POST /api/admin/login → cookie):
    * GET /api/admin/search?q=قاسم → 200 با 3 orders (NK-DLTM6299, NK-HCOP8230, NK-0MJU4327 — همه قاسم محمدی) + 1 user (قاسم محمدی، 989131234567)، took:6ms ✓
    * GET /api/admin/search?q=کباب → 200 با 5 menu items (جوجه‌کباب زعفرانی، چنجه، کباب بختیاری، کباب برگ، کباب کوبیده)، took:4ms ✓
    * GET /api/admin/search?q=palm → 200 با 1 coupon (PALM20) — case-insensitive match کار می‌کند ✓
    * GET /api/admin/search?q=NK-DLT → 200 با 1 order (NK-DLTM6299) ✓
    * GET /api/admin/search?q=a → 200 با empty results (length<2 → empty) ✓
    * GET /api/admin/search (no auth) → 401 «دسترسی غیرمجاز» ✓
  - Browser E2E با session ایزوله `nakhl-15b` روی gateway :81:
    * Login با rayantech / Hasan78484@ → موفق ✓
    * Top bar دکمه «جستجوی سریع... ⌘K» طلایی ظاهر شد ✓
    * Click دکمه → palette باز شد (top-anchored، input focus، placeholder فارسی، اگر recent نبود راهنما با ⌘K) ✓
    * Type «قاسم» → 3 order + 1 user در 4 group با count badges فارسی: «سفارش‌ها (۳)» + «کاربران (۱)». اولین order (NK-DLTM۶۲۹۹) selected (data-[selected=true]). status/paymentStatus badges فارسی ✓
    * Type «کباب» → 5 menu items با تصویر thumbnail + name + price + Badge «ویژه» روی کباب برگ و کباب کوبیده ✓
    * Type «PALM» → 1 coupon PALM20 با code chip + title + Badge ۲۰٪ ✓
    * Click order result (NK-DLTM6299) → palette بسته شد + tab به «سفارش‌ها» رفت + search box با «NK-DLTM6299» pre-filled شد + list به 1 order فیلتر شد ✓
    * Ctrl+K → palette دوباره باز شد + recent searches chip «قاسم» ظاهر شد ✓
    * Click «قاسم» chip → search دوباره run شد + همان 4 نتایج ✓
    * Click user result → palette بسته + tab به «کاربران» + search با «989131234567» pre-fill + list به 1 user فیلتر ✓
    * Ctrl+K → type «کباب» → click «کباب کوبیده» → tab به «مدیریت منو» + search با «کباب کوبیده» pre-fill + grid به 1 item فیلتر ✓
    * Ctrl+K → type «PALM» → click PALM20 → tab به «کدهای تخفیف» (CouponsManager فیلتر ندارد، فقط tab switch) ✓
    * Escape → palette بسته شد ✓
    * No browser console errors (فقط Fast Refresh logs).
  - dev.log: فقط GET /api/admin/search 200 (compile 3-11ms + render 14-28ms) + prisma:query LIKE-based queries. هیچ runtime error. Cache hits در دومین جستجوی «قاسم» در 18ms (اولی 33ms).
- Screenshots (در /home/z/my-project/qa/):
  - round15-admin-search-button.png — top bar با دکمه «جستجوی سریع... ⌘K» طلایی.
  - round15-admin-search-empty.png — palette باز، no query، حالت empty (راهنما).
  - round15-admin-search-recent.png — palette باز با recent searches chip «قاسم» (بعد از اولین selection).
  - round15-admin-search-results.png — نتایج جستجوی «قاسم»: ۳ سفارش + ۱ کاربر.
  - round15-admin-search-menu.png — نتایج جستجوی «کباب»: ۵ آیتم منو با thumbnail.
  - round15-admin-search-coupon.png — نتایج جستجوی «PALM»: ۱ کد تخفیف PALM20.
  - round15-admin-search-nav-orders.png — بعد از کلیک روی order: orders tab با search pre-filled «NK-DLTM6299» + list فیلترشده.

Stage Summary:
- NEW: `src/app/api/admin/search/route.ts` (GET، requireAdmin، parallel Promise.all روی orders/users/menuItems/coupons، 30s in-memory cache با global Map، case-insensitive برای ASCII fields با qUpper، response { success, results, took }).
- NEW: `src/components/admin/AdminSearchPalette.tsx` ('use client، cmdk + shadcn Dialog با className override top-anchored، shouldFilter=false، 200ms debounce، reqIdRef برای stale-discard، 4 group با SectionHeading (icon+label+count badge)، empty state با recent searches از localStorage (`nakhl-admin-recent-searches` max 6)، footer با hint chips، RTL، status/payment badges فارسی، Image برای menu thumbnails، Avatar برای users).
- EDITED (حداقلی): `OrdersManager.tsx` + `UsersManager.tsx` (initialFilter prop + firstRender ref + load(p, opts?) signature + mount-only effect که initialFilter را consume می‌کند). `MenuManager.tsx` (initialFilter prop + setSearch در mount effect). `AdminPanel.tsx` (import palette + Search icon، state searchOpen/searchNav با nonce، document keydown listener برای Cmd+K/Ctrl+K، handleSearchSelect با map type→tab، دکمه جستجوی طلایی در top bar، pass key+initialFilter به managers، mount palette).
- Verification: lint exit 0 (0 errors 0 warnings). curl smoke 6/6 PASS. Browser E2E 9/9 PASS (open via button + Ctrl+K، type + results + grouped sections، click navigates to orders/users/menu/coupons + search pre-filled، recent searches chip ESC closes، no console errors). dev.log تمیز (فقط GET /api/admin/search 200 + Prisma LIKE queries).
- Files explicitly NOT touched: prisma/schema.prisma، HomeView.tsx، ProfileView.tsx، src/lib/store.ts، src/app/api/favorites/*، ChatView.tsx، notify-service، TrackView/OrdersView، page.tsx، globals.css، sw.js، manifest.json، هیچ فایل 15-a یا 3-a/3-b.
- Deviation: برای coupons فقط tab-switch انجام شد (CouponsManager search input ندارد) — مطابق spec که گفت «minimum viable: switch tabs + filter (اگر موجود باشد)».
