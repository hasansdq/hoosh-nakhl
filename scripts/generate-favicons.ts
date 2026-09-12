/**
 * Nakhl Restaurant — favicon / brand-icon generator
 * ---------------------------------------------------
 * Renders the brand palm mark (same design as <NakhlLogo/> in
 * src/components/site/Header.tsx) into every icon format the app needs:
 *
 *   src/app/favicon.ico          16/32/48 PNG-in-ICO  (Next.js file convention)
 *   src/app/icon.svg             vector favicon       (Next.js file convention)
 *   src/app/apple-icon.png       180×180 apple-touch  (Next.js file convention)
 *   public/icon-192.png          PWA manifest
 *   public/icon-512.png          PWA manifest
 *   public/icon-maskable-512.png PWA manifest (full-bleed + safe zone)
 *   public/logo.svg              site logo (cached by sw.js)
 *
 * Run: `bun scripts/generate-favicons.ts`
 * (sharp is a devDependency — used by the Next.js image optimizer in dev.)
 */
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";

const GREEN_DARK = "#1f5c40"; // --primary / manifest theme_color
const GREEN_LIGHT = "#2d7a55"; // subtle top-light for depth
const SAND = "#f7f2e4"; // --primary-foreground (warm sand white)

/** The brand palm mark on the 64×64 grid, adapted from <NakhlLogo/>. */
const PALM_PATHS = `
  <path d="M32 52V26" stroke="${SAND}" stroke-width="4.5" stroke-linecap="round" fill="none"/>
  <path d="M23 52h18" stroke="${SAND}" stroke-width="4.5" stroke-linecap="round" fill="none"/>
  <path d="M32 26C32 26 27 19 16.5 18C22 24.5 26 26 32 26Z" fill="${SAND}"/>
  <path d="M32 26C32 26 37 19 47.5 18C42 24.5 38 26 32 26Z" fill="${SAND}"/>
  <path d="M32 28.5C32 28.5 24 26 17.5 30C24 32.5 29 31 32 28.5Z" fill="${SAND}" opacity="0.85"/>
  <path d="M32 28.5C32 28.5 40 26 46.5 30C40 32.5 35 31 32 28.5Z" fill="${SAND}" opacity="0.85"/>
  <path d="M32 24.5C32 24.5 29.5 14 32 6.5C34.5 14 32 24.5 32 24.5Z" fill="${SAND}" opacity="0.92"/>
`;

type Variant = "rounded" | "maskable" | "plain";

function palmSvg(variant: Variant = "rounded"): string {
  // maskable: full-bleed square background, palm shrunk to the 80% safe zone
  // rounded: app-style squircle (favicons, PWA "any", apple, logo)
  // plain:   transparent background, palm only (future use)
  const bg =
    variant === "rounded"
      ? `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
           <stop offset="0" stop-color="${GREEN_LIGHT}"/><stop offset="1" stop-color="${GREEN_DARK}"/>
         </linearGradient></defs>
         <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#bg)"/>`
      : variant === "maskable"
        ? `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
             <stop offset="0" stop-color="${GREEN_LIGHT}"/><stop offset="1" stop-color="${GREEN_DARK}"/>
           </linearGradient></defs>
           <rect width="64" height="64" fill="url(#bg)"/>`
        : "";
  const palm =
    variant === "maskable"
      ? `<g transform="translate(6.4 7.7) scale(0.8)">${PALM_PATHS}</g>`
      : PALM_PATHS;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${bg}${palm}</svg>`;
}

/** Build a classic .ico container holding PNG entries (all modern browsers). */
function buildIco(entries: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(entries.length, 4);
  const dir: Buffer[] = [];
  let offset = 6 + 16 * entries.length;
  for (const e of entries) {
    const d = Buffer.alloc(16);
    d[0] = e.size >= 256 ? 0 : e.size; // width (0 = 256)
    d[1] = e.size >= 256 ? 0 : e.size; // height
    d[2] = 0; // palette colors
    d[3] = 0; // reserved
    d.writeUInt16LE(1, 4); // color planes
    d.writeUInt16LE(32, 6); // bits per pixel
    d.writeUInt32LE(e.data.length, 8); // image size
    d.writeUInt32LE(offset, 12); // image offset
    offset += e.data.length;
    dir.push(d);
  }
  return Buffer.concat([header, ...dir, ...entries.map((e) => e.data)]);
}

async function renderPng(svg: string, size: number): Promise<Buffer> {
  // Render the vector at high density first, then downscale with lanczos —
  // crisp anti-aliased edges even at 16px.
  return sharp(Buffer.from(svg), { density: 576 }) // 64 × 8 = 512 natural
    .resize(size, size, { kernel: "lanczos3" })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

async function main() {
  const root = new URL("..", import.meta.url).pathname; // project root

  // 1) vector favicon (Next.js app-router convention)
  await writeFile(`${root}src/app/icon.svg`, palmSvg("rounded"));

  // 2) favicon.ico — 16/32/48 PNG-in-ICO (app-router convention, /favicon.ico)
  const icoEntries: { size: number; data: Buffer }[] = [];
  for (const size of [16, 32, 48]) {
    icoEntries.push({ size, data: await renderPng(palmSvg("rounded"), size) });
  }
  await writeFile(`${root}src/app/favicon.ico`, buildIco(icoEntries));

  // 3) apple-touch-icon 180×180 (app-router convention)
  await writeFile(`${root}src/app/apple-icon.png`, await renderPng(palmSvg("rounded"), 180));

  // 4) PWA manifest icons (replace the platform's default "Z" placeholders)
  await writeFile(`${root}public/icon-192.png`, await renderPng(palmSvg("rounded"), 192));
  await writeFile(`${root}public/icon-512.png`, await renderPng(palmSvg("rounded"), 512));
  await writeFile(`${root}public/icon-maskable-512.png`, await renderPng(palmSvg("maskable"), 512));

  // 5) site logo (cached by the service worker) — same mark as the favicon
  await writeFile(`${root}public/logo.svg`, palmSvg("rounded"));

  console.log("✓ favicon.ico (16/32/48), icon.svg, apple-icon.png (180)");
  console.log("✓ public/icon-192.png, icon-512.png, icon-maskable-512.png");
  console.log("✓ public/logo.svg");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
