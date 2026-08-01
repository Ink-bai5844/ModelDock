import { type CSSProperties, useEffect, useMemo, useRef } from "react";
import { effectOpacity, type EffectSettings } from "./effects";

interface Dot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  phase: number;
  anchor: boolean;
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return "121, 184, 255";
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ].join(", ");
}

export function ParticleField({
  settings,
  accentRgb,
  isLight,
}: {
  settings: EffectSettings;
  accentRgb: string;
  isLight: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particleRgb = settings.colorMode === "custom" ? hexToRgb(settings.customColor) : accentRgb;
  const effectStyle = useMemo(() => {
    const orbitSpeed = Math.max(settings.orbits.speed, 1) / 100;
    const scanSpeed = Math.max(settings.scan.speed, 1) / 100;
    const style = {
      "--effect-intensity": settings.intensity / 100,
      "--grid-opacity": effectOpacity(settings.grid.opacity),
      "--grid-size": `${settings.grid.size}px`,
      "--grid-minor": `${Math.max(8, Math.round(settings.grid.size / 4))}px`,
      "--grid-line-width": `${settings.grid.lineWidth}px`,
      "--orbit-opacity": effectOpacity(settings.orbits.opacity),
      "--orbit-speed-a": `${34 / orbitSpeed}s`,
      "--orbit-speed-b": `${42 / orbitSpeed}s`,
      "--haze-opacity": effectOpacity(settings.haze.opacity),
      "--scan-opacity": effectOpacity(settings.scan.opacity),
      "--scan-speed": `${13 / scanSpeed}s`,
    } as CSSProperties;

    if (settings.colorMode === "custom") {
      Object.assign(style, {
        "--accent": settings.customColor,
        "--accent-rgb": hexToRgb(settings.customColor),
      });
    }
    return style;
  }, [settings]);

  useEffect(() => {
    if (!settings.enabled || !settings.particles.enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    let width = 0;
    let height = 0;
    let dots: Dot[] = [];
    const pointer = { x: width / 2, y: height / 2, active: false };
    const visualPointer = { x: width / 2, y: height / 2 };

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      pointer.x = width / 2;
      pointer.y = height / 2;
      visualPointer.x = pointer.x;
      visualPointer.y = pointer.y;
      const baseCount = Math.min(76, Math.max(28, Math.floor((width * height) / 18000)));
      const count = Math.min(
        120,
        Math.max(12, Math.round(baseCount * (settings.particles.density / 100))),
      );
      dots = Array.from({ length: count }, (_, index) => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.16,
        vy: (Math.random() - 0.5) * 0.16,
        r: Math.random() * 1.35 + 0.45,
        phase: Math.random() * Math.PI * 2,
        anchor: index % 11 === 0,
      }));
    };

    const onPointer = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = true;
    };

    const onPointerLeave = () => {
      pointer.active = false;
      pointer.x = width * 0.68;
      pointer.y = height * 0.32;
    };

    const draw = () => {
      const now = performance.now() / 1000;
      ctx.clearRect(0, 0, width, height);
      visualPointer.x += (pointer.x - visualPointer.x) * 0.14;
      visualPointer.y += (pointer.y - visualPointer.y) * 0.14;

      dots.forEach((dot, index) => {
        if (!reduceMotion) {
          const dx = dot.x - visualPointer.x;
          const dy = dot.y - visualPointer.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (
            settings.pointer.enabled &&
            pointer.active &&
            distance < settings.pointer.radius &&
            distance > 0
          ) {
            const proximity = (settings.pointer.radius - distance) / settings.pointer.radius;
            const force = proximity * proximity * (settings.pointer.strength / 1000);
            dot.vx += (dx / distance) * force;
            dot.vy += (dy / distance) * force;
          }
          dot.vx *= 0.982;
          dot.vy *= 0.982;
          const speed = Math.hypot(dot.vx, dot.vy);
          if (speed > 1.55) {
            dot.vx = (dot.vx / speed) * 1.55;
            dot.vy = (dot.vy / speed) * 1.55;
          }
          dot.x += dot.vx;
          dot.y += dot.vy;
          if (dot.x < -10) dot.x = width + 10;
          if (dot.x > width + 10) dot.x = -10;
          if (dot.y < -10) dot.y = height + 10;
          if (dot.y > height + 10) dot.y = -10;
        }

        const pulse = 0.72 + Math.sin(now * 1.35 + dot.phase) * 0.28;
        ctx.beginPath();
        const particleOpacity = settings.particles.opacity / 100;
        ctx.fillStyle = `rgba(${particleRgb}, ${(isLight ? 0.15 : 0.25) * pulse * particleOpacity})`;
        ctx.arc(dot.x, dot.y, dot.r * (0.9 + pulse * 0.18), 0, Math.PI * 2);
        ctx.fill();

        if (dot.anchor) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(${particleRgb}, ${(isLight ? 0.055 : 0.10) * pulse * particleOpacity})`;
          ctx.lineWidth = 0.65;
          ctx.arc(dot.x, dot.y, 4.5 + pulse * 3.5, 0, Math.PI * 2);
          ctx.stroke();
        }

        for (let j = index + 1; j < dots.length; j += 1) {
          const other = dots[j];
          const distance = Math.hypot(dot.x - other.x, dot.y - other.y);
          if (settings.connections.enabled && distance < settings.connections.distance) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(${particleRgb}, ${
              (isLight ? 0.038 : 0.072) *
              (1 - distance / settings.connections.distance) *
              (settings.connections.opacity / 100)
            })`;
            ctx.lineWidth = 0.6;
            ctx.moveTo(dot.x, dot.y);
            ctx.lineTo(other.x, other.y);
            ctx.stroke();
          }
        }

        const pointerDistance = Math.hypot(dot.x - visualPointer.x, dot.y - visualPointer.y);
        if (
          settings.pointer.enabled &&
          settings.pointer.links &&
          pointer.active &&
          pointerDistance < settings.pointer.linkDistance
        ) {
          ctx.beginPath();
          const connectionStrength = 1 - pointerDistance / settings.pointer.linkDistance;
          ctx.strokeStyle = `rgba(${particleRgb}, ${
            (isLight ? 0.28 : 0.55) *
            connectionStrength *
            (settings.pointer.linkOpacity / 100)
          })`;
          ctx.lineWidth = 0.95 + connectionStrength * 0.75;
          ctx.moveTo(dot.x, dot.y);
          ctx.lineTo(visualPointer.x, visualPointer.y);
          ctx.stroke();
        }
      });
      if (!reduceMotion) frame = requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointer, { passive: true });
    document.documentElement.addEventListener("mouseleave", onPointerLeave);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointer);
      document.documentElement.removeEventListener("mouseleave", onPointerLeave);
    };
  }, [isLight, particleRgb, settings]);

  if (!settings.enabled) return null;
  return (
    <div className="ambient-backdrop" style={effectStyle} aria-hidden="true">
      {settings.grid.enabled && <div className="ambient-grid" />}
      {settings.orbits.enabled && (
        <>
          <div className="ambient-orbit ambient-orbit-a">
            <i />
            <i />
          </div>
          <div className="ambient-orbit ambient-orbit-b">
            <i />
          </div>
        </>
      )}
      {settings.haze.enabled && (
        <>
          <div className="ambient-haze ambient-haze-a" />
          <div className="ambient-haze ambient-haze-b" />
        </>
      )}
      {settings.scan.enabled && <div className="ambient-scan" />}
      {settings.particles.enabled && (
        <canvas
          ref={canvasRef}
          className="particle-field"
          data-particle-rgb={particleRgb}
        />
      )}
      <div className="ambient-vignette" />
    </div>
  );
}
