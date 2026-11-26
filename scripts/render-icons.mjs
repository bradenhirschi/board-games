// Renders the Home Screen icons for Plunder and the game picker with Playwright (Chromium).
// Run from the repo root: node scripts/render-icons.mjs
// Stock Market's icons are hand-made PNGs and aren't touched.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Playwright is preinstalled globally in the dev container (not a project dependency).
const { chromium } = createRequire(import.meta.url)("playwright");

const anchorPath = readFileSync("games/plunder/art/anchor.svg", "utf8").match(
  /<g id="line">\s*<path[^>]* d="([^"]+)"/,
)[1];

/** Each icon is drawn on a 512-unit square; `inset` shrinks the art for maskable icons (safe zone). */
const art = {
  plunder: (inset) => `
    <rect width="512" height="512" fill="#14202b"/>
    <g transform="translate(256 256) scale(${inset}) translate(-256 -256)">
      <g transform="translate(88 22) scale(4.6)">
        <path d="${anchorPath}" fill="#d9a441" fill-rule="evenodd"/>
      </g>
      <text x="256" y="420" text-anchor="middle" font-family="DejaVu Serif, Georgia, serif" font-weight="700"
        font-size="70" letter-spacing="3" fill="#efe2c2">PLUNDER</text>
    </g>`,
  home: (inset) => `
    <rect width="512" height="512" fill="#f4efe4"/>
    <g transform="translate(256 256) scale(${inset}) translate(-256 -256)">
      <g transform="rotate(-14 200 220)">
        <rect x="80" y="100" width="230" height="230" rx="40" fill="#14202b"/>
        ${pips(80, 100, 230, [0, 2, 4, 6, 8], "#d9a441")}
      </g>
      <g transform="rotate(10 320 320)">
        <rect x="205" y="205" width="230" height="230" rx="40" fill="#173f35" stroke="#f4efe4" stroke-width="14"/>
        ${pips(205, 205, 230, [0, 2, 3, 5, 6, 8], "#f5ecd9")}
      </g>
    </g>`,
};

/** Die pips on a 3×3 grid (0 = top left, 8 = bottom right). */
function pips(x, y, size, cells, color) {
  return cells
    .map((c) => {
      const cx = x + size * (0.25 + 0.25 * (c % 3));
      const cy = y + size * (0.25 + 0.25 * Math.floor(c / 3));
      return `<circle cx="${cx}" cy="${cy}" r="${size * 0.085}" fill="${color}"/>`;
    })
    .join("");
}

const outputs = [
  // [game, file, size, inset]
  ["plunder", "public/icons/plunder/icon-192.png", 192, 1],
  ["plunder", "public/icons/plunder/icon-512.png", 512, 1],
  ["plunder", "public/icons/plunder/icon-maskable-512.png", 512, 0.78],
  ["plunder", "app/(plunder)/plunder/apple-icon.png", 180, 1],
  ["plunder", "app/(plunder)/plunder/icon.png", 64, 1],
  ["home", "public/icons/home/icon-192.png", 192, 1],
  ["home", "public/icons/home/icon-512.png", 512, 1],
  ["home", "public/icons/home/icon-maskable-512.png", 512, 0.8],
  ["home", "app/(home)/apple-icon.png", 180, 1],
  ["home", "app/(home)/icon.png", 64, 1],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [game, file, size, inset] of outputs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0}svg{display:block}</style>
     <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">${art[game](inset)}</svg>`,
  );
  await page.screenshot({ path: file, omitBackground: false });
  console.log(file);
}
await browser.close();
