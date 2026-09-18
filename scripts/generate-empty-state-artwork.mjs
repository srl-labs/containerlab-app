import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// Run with pnpm generate:empty-state. Only this offline generator rasterizes the source logo.
async function generateArtwork(svg) {
  const SAMPLE_SIZE = 280;
  const SAMPLE_INSET = 52;
  function rasterizeLogo(image) {
    const sharp = new OffscreenCanvas(SAMPLE_SIZE, SAMPLE_SIZE);
    const sctx = sharp.getContext("2d");
    if (!sctx) return null;
    sctx.drawImage(
      image,
      SAMPLE_INSET,
      SAMPLE_INSET,
      SAMPLE_SIZE - SAMPLE_INSET * 2,
      SAMPLE_SIZE - SAMPLE_INSET * 2,
    );

    const offscreen = new OffscreenCanvas(SAMPLE_SIZE, SAMPLE_SIZE);
    const ctx = offscreen.getContext("2d");
    if (!ctx) return null;
    ctx.filter = "blur(24px)";
    ctx.drawImage(sharp, 0, 0);
    ctx.filter = "none";
    ctx.globalAlpha = 0.4;
    ctx.drawImage(sharp, 0, 0);
    ctx.globalAlpha = 1;
    return { data: ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data, size: SAMPLE_SIZE };
  }

  function toneAt(sample, x, y) {
    const i = (y * sample.size + x) * 4;
    const alpha = sample.data[i + 3] / 255;
    const lum =
      (sample.data[i] * 0.3 + sample.data[i + 1] * 0.59 + sample.data[i + 2] * 0.11) / 255;
    return alpha * (0.35 + (1 - lum) * 0.65);
  }

  function inkAt(sample, u, v) {
    if (!sample || u < 0 || v < 0 || u >= 1 || v >= 1) return 0;
    const s = sample.size - 1;
    const fx = u * s;
    const fy = v * s;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(s, x0 + 1);
    const y1 = Math.min(s, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const a = toneAt(sample, x0, y0) * (1 - tx) + toneAt(sample, x1, y0) * tx;
    const b = toneAt(sample, x0, y1) * (1 - tx) + toneAt(sample, x1, y1) * tx;
    return a * (1 - ty) + b * ty;
  }

  function hash2(ix, iy) {
    let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  function valueNoise(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    return (
      hash2(x0, y0) * (1 - ux) * (1 - uy) +
      hash2(x0 + 1, y0) * ux * (1 - uy) +
      hash2(x0, y0 + 1) * (1 - ux) * uy +
      hash2(x0 + 1, y0 + 1) * ux * uy
    );
  }


  const image = new Image();
  image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  await image.decode();
  const sample = rasterizeLogo(image);
  if (!sample) throw new Error("Logo sampling failed");
  const tileSize = 180;
  const size = 900;
  const spacing = 6;
  const fieldPaths = new Map();
  const logoPaths = new Map();
  const round = value => Math.round(value * 10) / 10;
  const addDot = (paths, x, y, radius, dark, light, levels) => {
    const d = Math.round(dark * levels);
    const l = Math.round(light * levels);
    if (d === 0 && l === 0) return;
    const key = `${d}:${l}`;
    let group = paths.get(key);
    if (!group) { group = { dark: d / levels, light: l / levels, path: "" }; paths.set(key, group); }
    const side = round(radius * 2);
    group.path += `M${round(x - radius)} ${round(y - radius)}h${side}v${side}h-${side}z`;
  };
  for (let y = 0; y < size; y += spacing) {
    for (let x = 0; x < size; x += spacing) {
      const tx = x % tileSize;
      const ty = y % tileSize;
      const seed = hash2(tx / spacing, ty / spacing);
      const cluster = Math.pow(valueNoise(tx * 0.012, ty * 0.012) * 0.62 + valueNoise(tx * 0.031, ty * 0.029) * 0.38, 1.55);
      const field = (0.38 + 0.62 * cluster) * (0.78 + 0.22 * Math.sin(seed * 6.28));
      const baseDark = (0.2 * field) * (100 + field * 50) / 255;
      const baseLight = (0.2 * field) * (45 + field * 50) / 255;
      const radius = field * 0.55 * spacing * 0.28 * 1.8;
      if (x <= tileSize && y <= tileSize) addDot(fieldPaths, x, y, radius, baseDark, baseLight, 256);
      const logo = inkAt(sample, (x - size / 2) / (size * 0.72) + 0.5, (y - size / 2) / (size * 0.72) + 0.5);
      if (logo < 0.01) continue;
      const alpha = 0.2 * field + logo * 0.8;
      const dark = alpha * Math.min(255, 100 + field * 50 + logo * 160) / 255;
      const light = alpha * (45 + field * 50 + logo * 160) / 255;
      addDot(logoPaths, x, y, (field * 0.55 + logo * 1.05) * spacing * 0.28 * 1.8,
        Math.max(0, (dark - baseDark) / (1 - baseDark)), Math.max(0, (light - baseLight) / (1 - baseLight)), 64);
    }
  }
  return { size, tileSize, field: [...fieldPaths.values()], logo: [...logoPaths.values()] };
}

const root = new URL("../", import.meta.url);
const svg = await readFile(new URL("packages/clab-ui/src/assets/images/containerlab.svg", root), "utf8");
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const artwork = await page.evaluate(generateArtwork, svg);
  const target = new URL("packages/clab-ui/src/workspace/emptyStateArtwork.ts", root);
  await writeFile(target, `// Generated by scripts/generate-empty-state-artwork.mjs. Do not edit by hand.\nexport const emptyStateArtwork = ${JSON.stringify(artwork, null, 2)};\n`);
  console.log(`Generated ${fileURLToPath(target)} (${artwork.field.length + artwork.logo.length} SVG paths).`);
} finally {
  await browser.close();
}
