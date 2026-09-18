const SAMPLE_SIZE = 280;
const SAMPLE_INSET = 52;
const SPACING = 6;
const FRAME_MS = 33;
const SPRITE_SIZE = 32;
const GREY_LEVELS = 24;

export type EmptyStateView = {
  width: number;
  height: number;
  dpr: number;
  light: boolean;
  hidden: boolean;
};

export type LogoSample = {
  data: Uint8ClampedArray;
  size: number;
};

function makeCanvas(width: number, height: number): OffscreenCanvas {
  return new OffscreenCanvas(width, height);
}

export function rasterizeLogo(image: CanvasImageSource): LogoSample | null {
  const sharp = makeCanvas(SAMPLE_SIZE, SAMPLE_SIZE);
  const sctx = sharp.getContext("2d");
  if (!sctx) return null;
  sctx.drawImage(
    image,
    SAMPLE_INSET,
    SAMPLE_INSET,
    SAMPLE_SIZE - SAMPLE_INSET * 2,
    SAMPLE_SIZE - SAMPLE_INSET * 2,
  );

  const offscreen = makeCanvas(SAMPLE_SIZE, SAMPLE_SIZE);
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

function toneAt(sample: LogoSample, x: number, y: number): number {
  const i = (y * sample.size + x) * 4;
  const alpha = sample.data[i + 3] / 255;
  const lum =
    (sample.data[i] * 0.3 + sample.data[i + 1] * 0.59 + sample.data[i + 2] * 0.11) / 255;
  return alpha * (0.35 + (1 - lum) * 0.65);
}

function inkAt(sample: LogoSample | null, u: number, v: number): number {
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

function hash2(ix: number, iy: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number): number {
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

function makeDotSheet(): OffscreenCanvas {
  const sheet = makeCanvas(SPRITE_SIZE * GREY_LEVELS, SPRITE_SIZE);
  const sctx = sheet.getContext("2d");
  if (!sctx) return sheet;
  const inner = SPRITE_SIZE - 2;
  const radius = inner * 0.225;
  for (let i = 0; i < GREY_LEVELS; i += 1) {
    const g = Math.round((i / (GREY_LEVELS - 1)) * 255);
    sctx.fillStyle = `rgb(${g}, ${g}, ${g})`;
    sctx.beginPath();
    sctx.roundRect(i * SPRITE_SIZE + 1, 1, inner, inner, radius);
    sctx.fill();
  }
  return sheet;
}

export function runEmptyState(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  getView: () => EmptyStateView,
  getSample: () => LogoSample | null,
): () => void {
  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!ctx) return () => {};

  const sheet = makeDotSheet();
  let frame = 0;
  let cancelled = false;
  let lastDraw = 0;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let sample: LogoSample | null = null;
  let count = 0;
  let xs = new Float32Array(0);
  let ys = new Float32Array(0);
  let logos = new Float32Array(0);
  let seeds = new Float32Array(0);

  const rebuild = () => {
    const cx = width / 2;
    const cy = height / 2;
    const logoSize = Math.min(width, height) * 0.72;
    const ox = ((cx % SPACING) + SPACING) % SPACING;
    const oy = ((cy % SPACING) + SPACING) % SPACING;
    const cols = Math.ceil((width + SPACING - ox) / SPACING);
    const rows = Math.ceil((height + SPACING - oy) / SPACING);
    const n = cols * rows;
    xs = new Float32Array(n);
    ys = new Float32Array(n);
    logos = new Float32Array(n);
    seeds = new Float32Array(n);
    let i = 0;
    for (let y = oy; y < height + SPACING; y += SPACING) {
      for (let x = ox; x < width + SPACING; x += SPACING) {
        xs[i] = x;
        ys[i] = y;
        logos[i] = inkAt(sample, (x - cx) / logoSize + 0.5, (y - cy) / logoSize + 0.5);
        seeds[i] = hash2(Math.round(x / SPACING), Math.round(y / SPACING));
        i += 1;
      }
    }
    count = i;
  };

  const fit = (view: EmptyStateView) => {
    width = Math.max(1, view.width);
    height = Math.max(1, view.height);
    dpr = view.dpr;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rebuild();
  };

  const draw = (now: number, light: boolean) => {
    const t = now / 1000;
    const maxR = SPACING * 0.28;
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = light ? "multiply" : "lighter";
    for (let i = 0; i < count; i += 1) {
      const x = xs[i];
      const y = ys[i];
      const seed = seeds[i];
      const logo = logos[i];
      const cluster = Math.pow(
        valueNoise(x * 0.012 + t * 0.13, y * 0.012 - t * 0.1) * 0.62 +
          valueNoise(x * 0.031 - t * 0.19, y * 0.029 + t * 0.16) * 0.38,
        1.55,
      );
      const twinkle = 0.78 + 0.22 * Math.sin(t * (0.8 + seed * 1.7) + seed * 6.28);
      const field = (0.38 + 0.62 * cluster) * twinkle;
      const amp = field * 0.55 + logo * 1.05;
      const grey = light
        ? Math.round(210 - field * 50 - logo * 160)
        : Math.round(100 + field * 50 + logo * 160);
      const alpha = 0.2 * field + logo * 0.8;
      if (alpha < 0.03) continue;
      const s = amp * maxR * 1.8;
      const level = Math.max(
        0,
        Math.min(GREY_LEVELS - 1, Math.round((grey / 255) * (GREY_LEVELS - 1))),
      );
      ctx.globalAlpha = alpha;
      ctx.drawImage(
        sheet,
        level * SPRITE_SIZE,
        0,
        SPRITE_SIZE,
        SPRITE_SIZE,
        x - s,
        y - s,
        s * 2,
        s * 2,
      );
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  };

  const tick = (now: number) => {
    frame = 0;
    if (cancelled) return;
    const view = getView();
    const nextSample = getSample();
    if (view.hidden) {
      frame = requestAnimationFrame(tick);
      return;
    }
    if (
      view.width !== width ||
      view.height !== height ||
      view.dpr !== dpr ||
      nextSample !== sample
    ) {
      sample = nextSample;
      fit(view);
    }
    if (now - lastDraw >= FRAME_MS) {
      lastDraw = now;
      draw(now, view.light);
    }
    frame = requestAnimationFrame(tick);
  };

  fit(getView());
  frame = requestAnimationFrame(tick);

  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
  };
}
