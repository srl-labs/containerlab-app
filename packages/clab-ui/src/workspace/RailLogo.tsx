import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { useWorkspaceHost } from "./WorkspaceHost";

function faceCamera(object: THREE.Object3D) {
  let bestY = 0;
  let bestArea = 0;
  const size = new THREE.Vector3();
  for (let i = 0; i < 36; i += 1) {
    const yaw = (i / 36) * Math.PI * 2;
    object.rotation.set(0, yaw, 0);
    object.updateMatrixWorld(true);
    new THREE.Box3().setFromObject(object).getSize(size);
    const area = size.x * size.y;
    if (area > bestArea) {
      bestArea = area;
      bestY = yaw;
    }
  }
  object.rotation.set(0, bestY, 0);
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.pointerEvents = "none";
    host.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.05);
    key.position.copy(camera.position);
    scene.add(key);

    const body = new THREE.MeshStandardMaterial({
      color: 0x889099,
      metalness: 0.35,
      roughness: 0.45,
    });
    const liquid = new THREE.MeshStandardMaterial({
      color: 0x00c9ff,
      metalness: 0.1,
      roughness: 0.35,
      emissive: 0x003344,
      emissiveIntensity: 0.25,
    });

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

    const loader = new GLTFLoader();
    loader.load(publicAssetUrl("model.gltf"), (gltf) => {
      if (disposed) { disposeModel(gltf.scene); return; }
      const model = gltf.scene;
      let index = 0;
      model.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) material.dispose();
        child.material = index === 0 ? liquid : body;
        index += 1;
      });
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      model.position.sub(box.getCenter(new THREE.Vector3()));
      model.scale.setScalar(2.05 / Math.max(size.x, size.y, size.z));
      faceCamera(model);
      pivot.add(model);
      renderer.render(scene, camera);
      host.style.backgroundImage = "none";
    }, undefined, () => { /* The SVG remains visible if WebGL or the model is unavailable. */ });

    renderer.setSize(28, 28, false);

    return () => {
      disposed = true;
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
        sx={{ width: 36, height: 36, borderRadius: 1, overflow: "hidden" }}
      >
        <Box ref={hostRef} sx={{ width: 28, height: 28, backgroundImage: `url("${publicAssetUrl("containerlab.svg")}")`, backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center" }} />
      </IconButton>
    </Tooltip>
  );
}
