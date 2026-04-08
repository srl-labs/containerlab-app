/**
 * AttractorEmptyState — Animated empty state for containerlab-web.
 *
 * Loads the real 3D containerlab logo (model.gltf) via Three.js with
 * enhanced lighting, reflections, and floating particles that orbit
 * and interact with the spinning flask.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface AttractorEmptyStateProps {
  occlusionLeft?: number;
  occlusionRight?: number;
}

export function AttractorEmptyState({
  occlusionLeft = 0,
  occlusionRight = 0
}: AttractorEmptyStateProps) {
  const threeContainerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const container = threeContainerRef.current;
    if (!container) return;

    // =====================================================================
    // Scene setup
    // =====================================================================
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
    camera.position.set(0, 0, 5);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);

    // =====================================================================
    // Lighting — dramatic setup for reflections
    // =====================================================================
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    // Key light — warm white from front-right
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
    keyLight.position.set(3, 3, 5);
    scene.add(keyLight);

    // Fill light — soft from left
    const fillLight = new THREE.DirectionalLight(0x8ec8e8, 0.4);
    fillLight.position.set(-4, 1, 2);
    scene.add(fillLight);

    // Rim/back light — cyan accent for edge glow
    const rimLight = new THREE.DirectionalLight(0x00c9ff, 0.8);
    rimLight.position.set(-2, -1, -4);
    scene.add(rimLight);

    // Inner glow — point light that pulses
    const glowLight = new THREE.PointLight(0x00c9ff, 1.0, 8);
    glowLight.position.set(0, -0.2, 0.8);
    scene.add(glowLight);

    // Bottom bounce light for under-glow
    const bounceLight = new THREE.PointLight(0x00c9ff, 0.3, 6);
    bounceLight.position.set(0, -2, 1);
    scene.add(bounceLight);


    // =====================================================================
    // Model loading
    // =====================================================================
    let model: THREE.Object3D | null = null;
    interface BubbleAnim {
      mesh: THREE.Mesh;
      originX: number;
      originY: number;
      originZ: number;
      speed: number;
      phase: number;
      range: number;
      endOpacity: number;
    }
    let bubbleMeshes: BubbleAnim[] = [];

    // Container material — slightly reflective metallic grey
    const containerMaterial = new THREE.MeshStandardMaterial({
      color: 0x889099,
      metalness: 0.5,
      roughness: 0.35
    });

    const cyanMaterial = new THREE.MeshStandardMaterial({
      color: 0x00c9ff,
      metalness: 0.15,
      roughness: 0.3,
      transparent: true,
      opacity: 0.9,
      emissive: 0x003344,
      emissiveIntensity: 0.3
    });

    const bubbleMaterial = new THREE.MeshStandardMaterial({
      color: 0x00c9ff,
      metalness: 0.05,
      roughness: 0.2,
      transparent: true,
      opacity: 0.85,
      emissive: 0x002233,
      emissiveIntensity: 0.2
    });

    const loader = new GLTFLoader();
    loader.load("/model.gltf", (gltf) => {
      model = gltf.scene;

      let meshIndex = 0;
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          if (meshIndex === 0) {
            mesh.material = cyanMaterial;
          } else if (meshIndex === 1) {
            mesh.material = containerMaterial;
          } else if (meshIndex >= 2 && meshIndex <= 4) {
            const mat = bubbleMaterial.clone();
            mesh.material = mat;
            const bi = meshIndex - 2;
            const configs: [number, number, number][] = [
              [1.0, 15, 0.68], // small
              [0.8, 12, 0.6],  // mid
              [0.6,  5, 0.06]  // big
            ];
            const [speed, range, endOp] = configs[bi];
            bubbleMeshes.push({
              mesh,
              originX: mesh.position.x,
              originY: mesh.position.y,
              originZ: mesh.position.z,
              speed,
              phase: bi * 1.8,
              range,
              endOpacity: endOp
            });
          }
          meshIndex++;
        }
      });

      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      model.position.sub(center);
      const maxDim = Math.max(size.x, size.y, size.z);
      model.scale.setScalar(2.2 / maxDim);

      scene.add(model);
    });

    // =====================================================================
    // Resize
    // =====================================================================
    const resize = () => {
      const rect = container.getBoundingClientRect();
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
      renderer.setSize(rect.width, rect.height);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    // =====================================================================
    // Animation loop
    // =====================================================================
    let animId = 0;
    const clock = new THREE.Clock();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();

      // Spin the model
      if (model) {
        model.rotation.y = elapsed * 0.5;
      }

      // Bubble animation
      for (const b of bubbleMeshes) {
        const cycle = 3 / b.speed;
        const t = ((elapsed * b.speed + b.phase) % cycle) / cycle;
        b.mesh.position.y = b.originY - t * b.range;
        b.mesh.position.x = b.originX;
        b.mesh.position.z = b.originZ;
        b.mesh.scale.setScalar(1);
        const mat = b.mesh.material as THREE.MeshStandardMaterial;
        mat.opacity = 1 + (b.endOpacity - 1) * t;
      }

      // Pulse lights
      const pulse = Math.sin(elapsed * 1.5);
      glowLight.intensity = 0.7 + 0.5 * pulse;
      bounceLight.intensity = 0.2 + 0.15 * pulse;
      const rimHue = 0.52 + 0.02 * Math.sin(elapsed * 0.7);
      rimLight.color.setHSL(rimHue, 0.8, 0.6);


      renderer.render(scene, camera);
    };
    animate();

    cleanupRef.current = () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };

    return () => {
      cleanupRef.current?.();
    };
  }, []);

  return (
    <div
      data-testid="standalone-empty-lab-state"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "var(--vscode-editor-background, #1e1e1e)",
        color: "var(--vscode-editor-foreground, #d4d4d4)",
        textAlign: "center" as const,
        paddingLeft: occlusionLeft,
        paddingRight: occlusionRight,
        overflow: "hidden"
      }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          maxWidth: 460,
          padding: "20px 24px"
        }}
      >
        {/* Three.js canvas */}
        <div
          ref={threeContainerRef}
          style={{ width: 320, height: 320, pointerEvents: "none" }}
        />
        <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>No lab is open</div>
        <div style={{ fontSize: 13, opacity: 0.82, lineHeight: 1.4 }}>
          Open a lab from the explorer, or create a new <code>*.clab.yml</code> file to start.
        </div>
      </div>
    </div>
  );
}
