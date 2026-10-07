/**
 * Deus Ex Mode Component
 *
 * Silent easter egg with 3D rotating containerlab logo.
 * Inspired by the iconic Deus Ex main menu logo animation.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";

import containerlabLogo from "../../assets/images/containerlab.svg";
import { lerpColor, useNodeGlow } from "../shared";
import type { RGBColor, BaseModeProps } from "../shared";

/** Deus Ex color palette with neon accents */
const COLORS: Record<string, RGBColor> = {
  silver: { r: 192, g: 192, b: 192 },
  chrome: { r: 220, g: 220, b: 225 },
  steel: { r: 113, g: 121, b: 126 },
  dark: { r: 15, g: 18, b: 22 },
  highlight: { r: 255, g: 255, b: 255 },
  cyan: { r: 0, g: 255, b: 255 },
  magenta: { r: 255, g: 0, b: 255 }
};

/** Width over height of the containerlab logo (its viewBox) */
const LOGO_ASPECT_RATIO = 1017 / 1196;

/**
 * Deus Ex Canvas - 3D rotating logo
 */
const DeusExCanvas: React.FC<{
  isActive: boolean;
  getRotationAngle: () => number;
}> = ({ isActive, getRotationAngle }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const logoRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!isActive) return undefined;

    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    // Load logo image
    const logo = new window.Image();
    logo.src = containerlabLogo;
    logoRef.current = logo;

    const dpr = window.devicePixelRatio || 1;

    const updateSize = (): void => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    updateSize();
    window.addEventListener("resize", updateSize);

    const animate = (): void => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const rotationAngle = getRotationAngle();

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const colorT = (Math.sin(rotationAngle * 0.5) + 1) / 2;
      const glowColor = lerpColor(COLORS.cyan, COLORS.magenta, colorT);

      drawRotatingLogo(ctx, width, height, rotationAngle, logoRef.current);
      drawLogoGlow(ctx, width, height, rotationAngle, glowColor);

      animationRef.current = window.requestAnimationFrame(animate);
    };

    logo.onload = () => {
      animationRef.current = window.requestAnimationFrame(animate);
    };

    logo.onerror = () => {
      animationRef.current = window.requestAnimationFrame(animate);
    };

    return () => {
      window.removeEventListener("resize", updateSize);
      window.cancelAnimationFrame(animationRef.current);
    };
  }, [isActive, getRotationAngle]);

  if (!isActive) return null;

  return (
    <Box
      component="canvas"
      ref={canvasRef}
      sx={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 99998,
        width: "100%",
        height: "100%"
      }}
    />
  );
};

function drawRotatingLogo(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  angle: number,
  logo: HTMLImageElement | null
): void {
  if (!logo || !logo.complete) return;

  const centerX = width / 2;
  const centerY = height * 0.35;

  const baseSize = Math.min(width, height) * 0.22;
  const logoWidth = baseSize * LOGO_ASPECT_RATIO;
  const logoHeight = baseSize;

  const scaleX = Math.cos(angle);
  const absScaleX = Math.abs(scaleX);
  const sinAngle = Math.sin(angle);

  const extrusionDepth = 15;
  const numLayers = 15;

  ctx.save();
  ctx.translate(centerX, centerY);

  const isBackFace = scaleX < 0;

  for (let i = numLayers - 1; i >= 0; i--) {
    const t = i / numLayers;
    const xOffset = sinAngle * extrusionDepth * t;

    ctx.save();
    ctx.translate(xOffset, 0);
    ctx.scale(scaleX, 1);

    const brightness = 0.3 + (1 - t) * 0.7;
    const alpha = (0.2 + (1 - t) * 0.2) * absScaleX + 0.05;

    ctx.globalAlpha = alpha;

    if (isBackFace) {
      ctx.filter = `brightness(${brightness * 0.6})`;
    } else {
      ctx.filter = `brightness(${brightness})`;
    }

    ctx.drawImage(logo, -logoWidth / 2, -logoHeight / 2, logoWidth, logoHeight);
    ctx.restore();
  }

  ctx.restore();
}

function drawLogoGlow(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  angle: number,
  color: RGBColor
): void {
  const centerX = width / 2;
  const centerY = height * 0.35;
  const glowSize = Math.min(width, height) * 0.25;

  const intensity = 0.15 + Math.abs(Math.sin(angle)) * 0.1;

  const gradient = ctx.createRadialGradient(
    centerX,
    centerY,
    glowSize * 0.2,
    centerX,
    centerY,
    glowSize * 1.2
  );

  gradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${intensity})`);
  gradient.addColorStop(0.4, `rgba(${color.r}, ${color.g}, ${color.b}, ${intensity * 0.5})`);
  gradient.addColorStop(1, "transparent");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

export const DeusExMode: React.FC<BaseModeProps> = ({
  isActive,
  onClose,
  onSwitchMode,
  modeName
}) => {
  const [visible, setVisible] = useState(false);
  const timeRef = useRef<number>(0);
  const animationRef = useRef<number>(0);

  const getRotationAngle = useCallback((): number => {
    return timeRef.current * 0.5;
  }, []);

  const getColor = useCallback((): RGBColor => {
    const angle = getRotationAngle();
    const colorT = (Math.sin(angle * 0.5) + 1) / 2;
    return lerpColor(COLORS.cyan, COLORS.magenta, colorT);
  }, [getRotationAngle]);

  const getIntensity = useCallback((): number => {
    const angle = getRotationAngle();
    return 0.3 + Math.abs(Math.sin(angle)) * 0.5;
  }, [getRotationAngle]);

  useNodeGlow(isActive, getColor, getIntensity);

  useEffect(() => {
    if (isActive) {
      setVisible(true);
      timeRef.current = 0;

      const animate = (): void => {
        timeRef.current += 0.016;
        animationRef.current = window.requestAnimationFrame(animate);
      };

      animationRef.current = window.requestAnimationFrame(animate);

      return () => {
        window.cancelAnimationFrame(animationRef.current);
      };
    } else {
      setVisible(false);
      return undefined;
    }
  }, [isActive]);

  const handleClose = (): void => {
    onClose?.();
  };

  const handleSwitch = (): void => {
    onSwitchMode?.();
  };

  if (!isActive) return null;

  return (
    <>
      <DeusExCanvas isActive={isActive} getRotationAngle={getRotationAngle} />

      <Box
        sx={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 99999,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          pb: 4,
          gap: 2
        }}
      >
        <Box
          component="button"
          onClick={handleSwitch}
          sx={{
            px: 3,
            py: 1.25,
            borderRadius: "9999px",
            pointerEvents: "auto",
            transition: "all 0.5s",
            ...(visible
              ? { opacity: 1, transform: "translateY(0)" }
              : { opacity: 0, transform: "translateY(16px)" }),
            background:
              "linear-gradient(135deg, rgba(113, 121, 126, 0.4) 0%, rgba(70, 75, 80, 0.4) 100%)",
            border: "2px solid rgba(192, 192, 192, 0.5)",
            color: "#c0c0c0",
            cursor: "pointer",
            backdropFilter: "blur(10px)",
            fontSize: "14px",
            fontWeight: 600,
            textShadow: "0 0 10px rgba(220, 220, 225, 0.8)",
            boxShadow: "0 0 20px rgba(113, 121, 126, 0.3), inset 0 0 20px rgba(192, 192, 192, 0.1)"
          }}
          title={`Current: ${modeName}`}
        >
          Switch
        </Box>
        <Box
          component="button"
          onClick={handleClose}
          sx={{
            px: 3,
            py: 1.25,
            borderRadius: "9999px",
            pointerEvents: "auto",
            transition: "all 0.5s",
            ...(visible
              ? { opacity: 1, transform: "translateY(0)" }
              : { opacity: 0, transform: "translateY(16px)" }),
            background:
              "linear-gradient(135deg, rgba(192, 192, 192, 0.7) 0%, rgba(113, 121, 126, 0.7) 100%)",
            border: "2px solid rgba(220, 220, 225, 0.5)",
            color: "#dcdce1",
            cursor: "pointer",
            backdropFilter: "blur(10px)",
            fontSize: "14px",
            fontWeight: 600,
            textShadow: "0 0 10px rgba(255, 255, 255, 0.8)",
            boxShadow: "0 0 20px rgba(192, 192, 192, 0.5), inset 0 0 20px rgba(220, 220, 225, 0.1)"
          }}
        >
          Shutdown
        </Box>
      </Box>
    </>
  );
};
