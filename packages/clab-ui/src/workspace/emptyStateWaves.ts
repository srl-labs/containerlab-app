import { emptyStateArtwork } from "./emptyStateArtwork";

const MAX_PULSES = 6;
const MAX_TRAILS = 18;
const TRAIL_LIFETIME = 1.4;
const TRAIL_INTERVAL = 80;
const PULSE_SPEED = 420;
const INTERACTIVE = "button, a, input, select, textarea, [role='button']";
const PALETTE = [
  [0.2, 0.88, 1], [0.55, 0.42, 1], [1, 0.35, 0.66],
  [1, 0.68, 0.27], [0.25, 1, 0.72], [0.35, 0.58, 1]
] as const;

// The pre-SVG noise and twinkle retain their character with a small contrast and
// tempo lift. The six-pixel grid stays still until a click impulse passes through.
// The baked logo sample avoids the original image decoding delay.
const VERTEX_SHADER = `#version 300 es
  precision highp float;
  precision highp int;
  in vec2 a_position;
  uniform vec2 u_viewport;
  uniform float u_dpr;
  uniform float u_light;
  uniform float u_time;
  uniform vec3 u_hover;
  uniform sampler2D u_logo;
  uniform vec4 u_trails[${MAX_TRAILS}];
  uniform float u_trailStrengths[${MAX_TRAILS}];
  uniform vec4 u_pulses[${MAX_PULSES}];
  uniform vec3 u_colors[${MAX_PULSES}];
  out vec4 v_color;
  out float v_size;

  float hash2(vec2 p) {
    uint n = uint(int(p.x)) * 374761393u + uint(int(p.y)) * 668265263u;
    n = (n ^ (n >> 13u)) * 1274126177u;
    return float(n ^ (n >> 16u)) / 4294967296.0;
  }

  float valueNoise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(cell), hash2(cell + vec2(1.0, 0.0)), u.x),
      mix(hash2(cell + vec2(0.0, 1.0)), hash2(cell + vec2(1.0)), u.x), u.y);
  }

  void main() {
    vec2 position = a_position;
    vec2 offset = vec2(0.0);
    vec2 uv = (position - u_viewport * 0.5) / (min(u_viewport.x, u_viewport.y) * 0.72) + 0.5;
    float logo = 0.0;
    if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0)))) {
      float sampleSize = float(textureSize(u_logo, 0).x);
      logo = texture(u_logo, (uv * (sampleSize - 1.0) + 0.5) / sampleSize).r;
    }
    float seed = hash2(floor(position / 6.0 + 0.5));
    float ambientTime = u_time * 1.1;
    float cluster = pow(
      valueNoise(position * 0.012 + ambientTime * vec2(0.13, -0.1)) * 0.62 +
      valueNoise(position * vec2(0.031, 0.029) + ambientTime * vec2(-0.19, 0.16)) * 0.38, 1.55);
    float twinkle = 0.78 + 0.28 * sin(ambientTime * (0.8 + seed * 1.7) + seed * 6.28);
    float field = (0.38 + 0.62 * cluster) * twinkle;
    float amplitude = field * 0.55 + logo * 1.05;
    float grey = mix(100.0 + field * 50.0 + logo * 160.0,
      210.0 - field * 50.0 - logo * 160.0, u_light);
    vec3 color = vec3(clamp(floor(floor(grey + 0.5) / 255.0 * 23.0 + 0.5), 0.0, 23.0) / 23.0);
    float alpha = 0.22 * field + logo * 0.8;

    // Only a scattered subset of dots reacts, each at its own phase and reach.
    // The pointer brushes a fading trail into the field without a circular wash.
    float scatter = hash2(floor(position / 6.0) + vec2(137.0, 71.0));
    float reach = 26.0 + seed * 48.0;
    float excitement = (1.0 - smoothstep(reach * 0.3, reach, length(position - u_hover.xy))) * u_hover.z;
    for (int i = 0; i < ${MAX_TRAILS}; i++) {
      if (u_trailStrengths[i] <= 0.0) continue;
      vec4 trail = u_trails[i];
      vec2 segment = trail.zw - trail.xy;
      float along = clamp(dot(position - trail.xy, segment) / max(dot(segment, segment), 1.0), 0.0, 1.0);
      float distance = length(position - (trail.xy + segment * along));
      float touch = (1.0 - smoothstep(reach * 0.3, reach, distance)) * u_trailStrengths[i];
      excitement = max(excitement, touch);
    }
    float sparkle = sin(u_time * (1.8 + seed * 2.8) + scatter * 32.8);
    float hoverSignal = excitement * smoothstep(0.65, 0.95, scatter) * sparkle;
    float highlight = max(hoverSignal, 0.0);
    alpha = alpha * (1.0 + hoverSignal * 0.55) + highlight * 0.11;
    color = mix(color, vec3(1.0 - u_light), highlight * 0.4);
    float illumination = 0.0;

    for (int i = 0; i < ${MAX_PULSES}; i++) {
      vec4 pulse = u_pulses[i];
      if (pulse.w <= 0.0) continue;
      vec2 direction = position - pulse.xy;
      float radius = length(direction);
      float front = radius - pulse.z * ${PULSE_SPEED}.0;
      float crestDistance = front / 48.0;
      float wakeDistance = (front + 65.0) / 100.0;
      float crest = exp(-crestDistance * crestDistance);
      float wake = exp(-wakeDistance * wakeDistance);
      float energy = (crest + wake * 0.28) * pulse.w;
      offset += direction / max(radius, 1.0)
        * sin(front * 0.045) * (crest * 3.0 + wake) * pulse.w;
      color = mix(color, u_colors[i], min(energy * 1.5, 1.0));
      illumination = max(illumination, energy);
    }

    alpha = min(0.95, alpha + illumination * 0.18);
    float size = amplitude * 6.0 * 0.28 * 1.8 * 2.0 * (30.0 / 32.0)
      * (1.0 + illumination * 0.16 + hoverSignal * 0.13);
    v_size = max(size * u_dpr, 1.0);
    gl_PointSize = v_size + 2.0;
    vec2 clip = (position + offset) / u_viewport * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    v_color = vec4(color, alpha * min(size * size * u_dpr * u_dpr, 1.0));
  }
`;

const FRAGMENT_SHADER = `#version 300 es
  precision mediump float;
  in vec4 v_color;
  in float v_size;
  out vec4 fragmentColor;
  void main() {
    vec2 edge = abs(gl_PointCoord - 0.5) * (v_size + 2.0);
    float corner = v_size * 0.225;
    vec2 q = edge - (v_size * 0.5 - corner);
    float distance = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - corner;
    float coverage = 1.0 - smoothstep(-0.5, 0.5, distance);
    fragmentColor = vec4(v_color.rgb, v_color.a * coverage);
  }
`;

type Pulse = { x: number; y: number; start: number; duration: number; color: readonly number[] };
type Trail = { fromX: number; fromY: number; x: number; y: number; start: number };
type Hover = { x: number; y: number; strength: number };

function createRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl2", { alpha: true, antialias: false, depth: false });
  if (!gl) return null;
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX_SHADER], [gl.FRAGMENT_SHADER, FRAGMENT_SHADER]] as const) {
    const shader = gl.createShader(type);
    if (!shader) { gl.deleteProgram(program); return null; }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) { gl.deleteProgram(program); return null; }
  const buffer = gl.createBuffer();
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const location = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const uniforms = Object.fromEntries(
    ["viewport", "dpr", "light", "time", "hover", "trails", "trailStrengths", "pulses", "colors", "logo"].map((name) => [name, gl.getUniformLocation(program, `u_${name}`)])
  );
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  const { sample } = emptyStateArtwork;
  const ink = Uint8Array.from(atob(sample.ink), (value) => value.charCodeAt(0));
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, sample.size, sample.size, 0, gl.RED, gl.UNSIGNED_BYTE, ink);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(uniforms.logo, 0);
  let count = 0;
  const pulseData = new Float32Array(MAX_PULSES * 4);
  const colors = new Float32Array(MAX_PULSES * 3);
  const trailData = new Float32Array(MAX_TRAILS * 4);
  const trailStrengths = new Float32Array(MAX_TRAILS);

  return {
    resize(width: number, height: number) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uniforms.viewport, width, height);
      gl.uniform1f(uniforms.dpr, dpr);
      const data: number[] = [];
      for (let y = (height / 2) % 6; y < height + 6; y += 6) {
        for (let x = (width / 2) % 6; x < width + 6; x += 6) data.push(x, y);
      }
      count = data.length / 2;
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    },
    draw(now: number, time: number, hover: Hover, trails: Trail[], pulses: Pulse[], light: boolean) {
      gl.uniform1f(uniforms.time, time);
      gl.uniform1f(uniforms.light, Number(light));
      gl.uniform3f(uniforms.hover, hover.x, hover.y, hover.strength);
      trailStrengths.fill(0);
      for (const [index, trail] of trails.entries()) {
        const age = Math.max(0, (now - trail.start) / 1000);
        trailData.set([trail.fromX, trail.fromY, trail.x, trail.y], index * 4);
        trailStrengths[index] = Math.min(1, age / 0.12) * Math.pow(Math.max(0, 1 - age / TRAIL_LIFETIME), 1.5);
      }
      gl.uniform4fv(uniforms.trails, trailData);
      gl.uniform1fv(uniforms.trailStrengths, trailStrengths);
      pulseData.fill(0);
      for (const [index, pulse] of pulses.entries()) {
        const age = (now - pulse.start) / 1000;
        const fade = Math.pow(Math.max(0, 1 - age / pulse.duration), 0.7);
        pulseData.set([pulse.x, pulse.y, age, fade], index * 4);
        colors.set(pulse.color, index * 3);
      }
      gl.uniform4fv(uniforms.pulses, pulseData);
      gl.uniform3fv(uniforms.colors, colors);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.POINTS, 0, count);
    },
    dispose() { gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteProgram(program); }
  };
}

export function attachEmptyStateWaves(host: HTMLDivElement, artwork: SVGSVGElement) {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset.testid = "empty-state-waves";
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:none";
  let renderer: ReturnType<typeof createRenderer> = null;
  let unavailable = false;
  let frame = 0;
  let previousFrame = 0;
  let time = 0;
  let bounds = host.getBoundingClientRect();
  let needsResize = true;
  let light = false;
  let pulses: Pulse[] = [];
  let trails: Trail[] = [];
  const pointer = { x: 0, y: 0, lastX: 0, lastY: 0, emittedAt: -Infinity, inside: false };
  const hover: Hover = { x: 0, y: 0, strength: 0 };

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    previousFrame = 0;
    pulses = [];
    trails = [];
    pointer.inside = false;
    pointer.emittedAt = -Infinity;
    hover.strength = 0;
    canvas.style.display = "none";
    artwork.style.visibility = "";
  }

  function draw(now: number) {
    frame = 0;
    if (document.hidden || reducedMotion.matches || unavailable || !bounds.width || !bounds.height) {
      stop();
      return;
    }
    if (!renderer) {
      renderer = createRenderer(canvas);
      if (!renderer) { unavailable = true; stop(); return; }
      host.append(canvas);
    }
    if (needsResize) {
      renderer.resize(bounds.width, bounds.height);
      needsResize = false;
    }
    pulses = pulses.filter((pulse) => now - pulse.start < pulse.duration * 1000);
    trails = trails.filter((trail) => now - trail.start < TRAIL_LIFETIME * 1000);
    const elapsed = previousFrame ? Math.min(now - previousFrame, 64) : 0;
    time += elapsed / 1000;
    const follow = 1 - Math.exp(-elapsed / 80);
    hover.x += (pointer.x - hover.x) * follow;
    hover.y += (pointer.y - hover.y) * follow;
    const fade = 1 - Math.exp(-elapsed / (pointer.inside ? 180 : 350));
    hover.strength += (Number(pointer.inside) - hover.strength) * fade;
    previousFrame = now;
    renderer.draw(now, time, hover, trails, pulses, light);
    if (canvas.style.display !== "block") {
      canvas.style.display = "block";
      artwork.style.visibility = "hidden";
    }
    frame = requestAnimationFrame(draw);
  }

  function start() {
    if (reducedMotion.matches || document.hidden || unavailable) { stop(); return; }
    bounds = host.getBoundingClientRect();
    if (!bounds.width || !bounds.height) { stop(); return; }
    light = getComputedStyle(artwork).getPropertyValue("--empty-state-light").trim() === "1";
    if (!frame) frame = requestAnimationFrame(draw);
  }

  function canInteract(event: MouseEvent) {
    return !reducedMotion.matches && !document.hidden && !unavailable
      && !(event.target instanceof Element && event.target.closest(INTERACTIVE));
  }

  function addTrail(now: number) {
    trails = [...trails.slice(-(MAX_TRAILS - 1)), {
      fromX: pointer.inside ? pointer.lastX : pointer.x,
      fromY: pointer.inside ? pointer.lastY : pointer.y,
      x: pointer.x, y: pointer.y, start: now
    }];
    pointer.emittedAt = now;
    pointer.lastX = pointer.x;
    pointer.lastY = pointer.y;
  }

  function move(event: PointerEvent) {
    if (event.pointerType === "touch" || !canInteract(event)) { pointer.inside = false; return; }
    const now = performance.now();
    pointer.x = event.clientX - bounds.left;
    pointer.y = event.clientY - bounds.top;
    if (!pointer.inside && hover.strength < 0.01) {
      hover.x = pointer.x;
      hover.y = pointer.y;
    }
    const travel = Math.hypot(pointer.x - pointer.lastX, pointer.y - pointer.lastY);
    if (now - pointer.emittedAt >= TRAIL_INTERVAL && (!pointer.inside || travel >= 6)) {
      addTrail(now);
    }
    pointer.inside = true;
  }

  function click(event: MouseEvent) {
    if (event.button !== 0 || event.detail === 0 || !canInteract(event)) return;
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const reach = Math.hypot(Math.max(x, bounds.width - x), Math.max(y, bounds.height - y));
    pulses = [...pulses.slice(-(MAX_PULSES - 1)), {
      x, y, start: performance.now(), duration: reach / PULSE_SPEED + 0.65,
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)]
    }];
  }

  function loseContext() {
    unavailable = true;
    stop();
  }

  function leave() { pointer.inside = false; }

  const resize = new ResizeObserver(() => {
    needsResize = true;
    start();
  });
  const theme = new MutationObserver(start);
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
  theme.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
  resize.observe(host);
  host.addEventListener("pointermove", move, { passive: true });
  host.addEventListener("pointerleave", leave);
  host.addEventListener("click", click);
  document.addEventListener("visibilitychange", start);
  reducedMotion.addEventListener("change", start);
  canvas.addEventListener("webglcontextlost", loseContext);
  start();
  return () => {
    stop();
    resize.disconnect();
    theme.disconnect();
    host.removeEventListener("pointermove", move);
    host.removeEventListener("pointerleave", leave);
    host.removeEventListener("click", click);
    document.removeEventListener("visibilitychange", start);
    reducedMotion.removeEventListener("change", start);
    canvas.removeEventListener("webglcontextlost", loseContext);
    renderer?.dispose();
    canvas.remove();
  };
}
