import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import * as THREE from "three";
import { SVGLoader, type SVGResult } from "three/addons/loaders/SVGLoader.js";

import { useWorkspaceHost } from "./WorkspaceHost";

// Front-facing light sums to π, so the face toward the camera renders exactly its material color
// (Lambert divides by π); turned faces still shade while the logo spins.
const AMBIENT_INTENSITY = 1.2;
const KEY_INTENSITY = 1.8;
const FALLBACK_BODY_COLOR = "#878787";
const LIQUID_COLOR = 0x00c9ff;
// The flask's gray fill in the logo; every other fill is liquid.
const LOGO_BODY_FILL = "#828282";
// Extrusion depths as a share of the logo width. The liquid and bubbles sit inside the glass.
const BODY_DEPTH = 0.1;
const LIQUID_DEPTH = 0.07;
// Thin strokes at rail size need more samples than the screen has; the canvas downsamples them.
const SUPERSAMPLE = 2;
const LOGO_SIZE = 28;

/** The logo button's muted text color, so the logo sits at the same contrast as the idle rail icons. */
function bodyColor(element: Element): string {
  const color = getComputedStyle(element).color;
  return /^(#|rgb)/.test(color) ? color : FALLBACK_BODY_COLOR;
}

function pathFill(path: THREE.ShapePath): string {
  const style = path.userData.style;
  const fill: unknown = typeof style === "object" && style !== null ? Reflect.get(style, "fill") : undefined;
  return typeof fill === "string" ? fill.toLowerCase() : "";
}

/** The logo SVG extruded into a mark that faces the camera, centered and fit to the view. */
function buildMark(svg: SVGResult, body: THREE.Material, liquid: THREE.Material): THREE.Group {
  const parts = svg.paths.map((path) => ({
    shapes: SVGLoader.createShapes(path),
    isBody: pathFill(path) === LOGO_BODY_FILL
  }));
  const flat = new THREE.Box3();
  for (const part of parts) {
    for (const shape of part.shapes) {
      for (const point of shape.getPoints()) flat.expandByPoint(new THREE.Vector3(point.x, point.y, 0));
    }
  }
  const size = flat.getSize(new THREE.Vector3());
  const center = flat.getCenter(new THREE.Vector3());
  const mark = new THREE.Group();
  for (const part of parts) {
    const depth = size.x * (part.isBody ? BODY_DEPTH : LIQUID_DEPTH);
    const geometry = new THREE.ExtrudeGeometry(part.shapes, { depth, bevelEnabled: false, curveSegments: 12 });
    geometry.translate(-center.x, -center.y, -depth / 2);
    mark.add(new THREE.Mesh(geometry, part.isBody ? body : liquid));
  }
  // SVG y points down; the renderer keeps the mirrored faces front facing.
  const scale = 2.05 / Math.max(size.x, size.y);
  mark.scale.set(scale, -scale, scale);
  return mark;
}

function disposeModel(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material.dispose();
  });
}

export function RailLogo(props: { showTooltip?: boolean }) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const { assetUrl: publicAssetUrl } = useWorkspaceHost();
  const hostRef = useRef<HTMLDivElement>(null);
  const kickRef = useRef<(spin: boolean) => void>(() => {});

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1.15, 1.15, 1.15, -1.15, 0.1, 20);
    camera.position.set(0, 0, 8);
    camera.lookAt(0, 0, 0);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min((window.devicePixelRatio || 1) * SUPERSAMPLE, 4));
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.pointerEvents = "none";
    host.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY));
    const key = new THREE.DirectionalLight(0xffffff, KEY_INTENSITY);
    key.position.copy(camera.position);
    scene.add(key);

    // Diffuse only: a highlight would wash out the logo's flat front faces.
    const body = new THREE.MeshLambertMaterial({ color: new THREE.Color(bodyColor(host)) });
    const liquid = new THREE.MeshLambertMaterial({ color: LIQUID_COLOR });

    const pivot = new THREE.Group();
    scene.add(pivot);

    let yaw = 0;
    let wy = 0;
    let spinLeft = 0;
    let disposed = false;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (spinLeft !== 0) {
        const step = Math.sign(spinLeft) * Math.PI * 2.4 * dt;
        if (Math.abs(step) >= Math.abs(spinLeft)) {
          spinLeft = 0;
          yaw = 0;
          wy = 0;
        } else {
          yaw += step;
          spinLeft -= step;
        }
      } else {
        wy -= yaw * 22 * dt;
        wy *= Math.exp(-5 * dt);
        yaw += wy * dt;
      }
      const moving = spinLeft !== 0 || Math.abs(wy) > 0.002 || Math.abs(yaw) > 0.002;
      if (!moving) {
        yaw = 0;
        wy = 0;
      }
      pivot.rotation.set(0, yaw, 0);
      renderer.render(scene, camera);
      frame = moving ? requestAnimationFrame(tick) : 0;
    };
    kickRef.current = (spin) => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const dir = Math.random() < 0.5 ? 1 : -1;
      if (spin) {
        if (spinLeft === 0) spinLeft = dir * Math.PI * 2;
      } else {
        wy += dir * (6 + Math.random() * 5);
      }
      if (!frame) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };

    new SVGLoader().load(publicAssetUrl("containerlab.svg"), (svg) => {
      if (disposed) return;
      pivot.add(buildMark(svg, body, liquid));
      renderer.render(scene, camera);
      host.style.backgroundImage = "none";
    }, undefined, () => { /* The SVG remains visible if WebGL or the logo is unavailable. */ });

    renderer.setSize(LOGO_SIZE, LOGO_SIZE, false);

    // Theme switches restyle the root (standalone) or the body class (VS Code).
    const recolor = new MutationObserver(() => {
      body.color.setStyle(bodyColor(host));
      if (!frame) renderer.render(scene, camera);
    });
    recolor.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
    recolor.observe(document.body, { attributes: true, attributeFilter: ["class"] });

    return () => {
      disposed = true;
      recolor.disconnect();
      cancelAnimationFrame(frame);
      kickRef.current = () => {};
      disposeModel(pivot);
      body.dispose();
      liquid.dispose();
      renderer.dispose();
      host.replaceChildren();
    };
  }, [publicAssetUrl]);

  return (
    <Tooltip
      disableFocusListener={!props.showTooltip}
      disableHoverListener={!props.showTooltip}
      disableInteractive
      leaveDelay={0}
      placement="right"
      title="TopoViewer"
      open={props.showTooltip === true && tooltipOpen}
      onOpen={() => setTooltipOpen(true)}
      onClose={() => setTooltipOpen(false)}
    >
      <IconButton
        size="small"
        onClick={() => kickRef.current(Math.random() < 0.4)}
        aria-label="TopoViewer"
        data-testid="workspace-logo"
        sx={{ width: 36, height: 36, borderRadius: 1, overflow: "hidden", color: "text.secondary" }}
      >
        <Box ref={hostRef} sx={{ width: LOGO_SIZE, height: LOGO_SIZE, backgroundImage: `url("${publicAssetUrl("containerlab.svg")}")`, backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center" }} />
      </IconButton>
    </Tooltip>
  );
}
