import {
  ArrowCounterClockwise,
  CirclesThreePlus,
  CursorClick,
  GridFour,
  Palette,
  SlidersHorizontal,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import { type CSSProperties, useEffect, useRef } from "react";
import {
  DEFAULT_EFFECT_SETTINGS,
  effectOpacity,
  type EffectColorMode,
  type EffectSettings,
} from "./effects";

interface AppearanceDrawerProps {
  open: boolean;
  settings: EffectSettings;
  onChange: (settings: EffectSettings) => void;
  onClose: () => void;
}

interface RangeControlProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
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

function Toggle({
  checked,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  label: string;
  description?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="effect-toggle-row">
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i aria-hidden="true" />
    </label>
  );
}

function RangeControl({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  disabled,
  onChange,
}: RangeControlProps) {
  const progress = ((value - min) / (max - min)) * 100;

  return (
    <label className={`effect-range ${disabled ? "is-disabled" : ""}`} htmlFor={id}>
      <span>
        <strong>{label}</strong>
        <output htmlFor={id}>
          {value}
          {unit}
        </output>
      </span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ "--range-progress": `${progress}%` } as React.CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function AppearanceDrawer({
  open,
  settings,
  onChange,
  onClose,
}: AppearanceDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;

  const update = <K extends keyof EffectSettings>(key: K, value: EffectSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  const updateGroup = <
    K extends "particles" | "connections" | "pointer" | "grid" | "orbits" | "haze" | "scan",
  >(
    key: K,
    value: Partial<EffectSettings[K]>,
  ) => {
    onChange({ ...settings, [key]: { ...settings[key], ...value } });
  };

  const selectColorMode = (mode: EffectColorMode) => update("colorMode", mode);
  const previewParticleCount = settings.particles.enabled
    ? Math.max(4, Math.min(24, Math.round(settings.particles.density / 9)))
    : 0;
  const previewStyle = {
    "--preview-intensity": settings.enabled ? settings.intensity / 100 : 0.14,
    "--preview-grid-opacity": effectOpacity(settings.grid.opacity),
    "--preview-grid-size": `${Math.max(8, Math.min(56, settings.grid.size / 3))}px`,
    "--preview-grid-line-width": `${settings.grid.lineWidth}px`,
    "--preview-orbit-opacity": effectOpacity(settings.orbits.opacity),
    "--preview-orbit-speed": `${12 / Math.max(settings.orbits.speed / 100, 0.1)}s`,
    "--preview-haze-opacity": effectOpacity(settings.haze.opacity),
    "--preview-scan-opacity": effectOpacity(settings.scan.opacity),
    "--preview-scan-speed": `${5 / Math.max(settings.scan.speed / 100, 0.1)}s`,
    "--preview-particle-opacity": effectOpacity(settings.particles.opacity),
    "--preview-connection-opacity": effectOpacity(settings.connections.opacity),
    "--preview-connection-scale": Math.max(
      0.55,
      Math.min(1.8, settings.connections.distance / 122),
    ),
    "--preview-pointer-opacity": effectOpacity(settings.pointer.linkOpacity),
    "--preview-pointer-scale": Math.max(
      0.55,
      Math.min(1.75, settings.pointer.linkDistance / 300),
    ),
    "--preview-pointer-size": `${Math.max(22, Math.min(58, settings.pointer.radius / 6))}px`,
    "--preview-pointer-force": 1 + settings.pointer.strength / 180,
    ...(settings.colorMode === "custom"
      ? {
          "--accent": settings.customColor,
          "--accent-rgb": hexToRgb(settings.customColor),
        }
      : {}),
  } as CSSProperties;

  return (
    <div className="appearance-layer">
      <button
        className="appearance-scrim"
        aria-label="关闭高级外观设置"
        onClick={onClose}
      />
      <aside
        ref={drawerRef}
        className="appearance-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="appearance-title"
      >
        <header className="appearance-header">
          <div>
            <span className="appearance-kicker">
              <SlidersHorizontal size={14} />
              APPEARANCE LAB
            </span>
            <h2 id="appearance-title">高级外观设置</h2>
            <p>细调背景动效，所有修改都会即时预览并自动保存。</p>
          </div>
          <button
            ref={closeButtonRef}
            className="icon-button appearance-close"
            aria-label="关闭高级外观设置"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>

        <div
          className={`appearance-preview ${settings.enabled ? "" : "is-off"}`}
          style={previewStyle}
          aria-hidden="true"
        >
          <div className="preview-scene">
            {settings.haze.enabled && <div className="preview-haze" />}
            {settings.grid.enabled && <div className="preview-grid" />}
            {settings.orbits.enabled && <div className="preview-orbit" />}
            {settings.connections.enabled && settings.particles.enabled && (
              <div className="preview-connections">
                <i />
                <i />
                <i />
              </div>
            )}
            {settings.particles.enabled && (
              <div className="preview-particles">
                {Array.from({ length: previewParticleCount }, (_, index) => (
                  <i
                    key={index}
                    style={
                      {
                        "--particle-x": `${8 + ((index * 37) % 86)}%`,
                        "--particle-y": `${10 + ((index * 53) % 76)}%`,
                        "--particle-delay": `${-(index % 7) * 0.42}s`,
                        "--particle-size": `${2 + (index % 3)}px`,
                      } as CSSProperties
                    }
                  />
                ))}
              </div>
            )}
            {settings.pointer.enabled && (
              <div className="preview-pointer">
                {settings.pointer.links && (
                  <>
                    <i />
                    <i />
                    <i />
                  </>
                )}
              </div>
            )}
            {settings.scan.enabled && <div className="preview-scan" />}
          </div>
          <span className="appearance-preview-label">
            <Sparkle size={14} weight="fill" />
            {settings.enabled ? "实时预览" : "特效已关闭"}
          </span>
        </div>

        <div className="appearance-scroll">
          <section className="effect-section">
            <div className="effect-section-title">
              <span><Palette size={17} /></span>
              <div>
                <h3>全局与颜色</h3>
                <p>控制全部背景效果的基准表现。</p>
              </div>
            </div>
            <Toggle
              checked={settings.enabled}
              label="启用背景特效"
              description="关闭后保留纯净的界面背景"
              onChange={(enabled) => update("enabled", enabled)}
            />
            <RangeControl
              id="effect-intensity"
              label="全局强度"
              value={settings.intensity}
              min={20}
              max={100}
              unit="%"
              disabled={!settings.enabled}
              onChange={(intensity) => update("intensity", intensity)}
            />
            <div className={`effect-color-control ${!settings.enabled ? "is-disabled" : ""}`}>
              <span className="effect-control-label">特效颜色</span>
              <div className="effect-segmented" role="group" aria-label="特效颜色来源">
                <button
                  className={settings.colorMode === "theme" ? "selected" : ""}
                  disabled={!settings.enabled}
                  aria-pressed={settings.colorMode === "theme"}
                  onClick={() => selectColorMode("theme")}
                >
                  跟随主题
                </button>
                <button
                  className={settings.colorMode === "custom" ? "selected" : ""}
                  disabled={!settings.enabled}
                  aria-pressed={settings.colorMode === "custom"}
                  onClick={() => selectColorMode("custom")}
                >
                  自定义
                </button>
              </div>
              {settings.colorMode === "custom" && (
                <label className="effect-color-picker">
                  <input
                    type="color"
                    value={settings.customColor}
                    disabled={!settings.enabled}
                    onChange={(event) => update("customColor", event.target.value)}
                  />
                  <span>{settings.customColor.toUpperCase()}</span>
                  <small>点击色块选择颜色</small>
                </label>
              )}
            </div>
          </section>

          <section className="effect-section">
            <div className="effect-section-title">
              <span><CirclesThreePlus size={17} /></span>
              <div>
                <h3>粒子与连线</h3>
                <p>调整空间密度与粒子之间的连接关系。</p>
              </div>
            </div>
            <Toggle
              checked={settings.particles.enabled}
              label="漂浮粒子"
              onChange={(enabled) => updateGroup("particles", { enabled })}
            />
            <RangeControl
              id="particle-density"
              label="粒子密度"
              value={settings.particles.density}
              min={30}
              max={180}
              unit="%"
              disabled={!settings.enabled || !settings.particles.enabled}
              onChange={(density) => updateGroup("particles", { density })}
            />
            <RangeControl
              id="particle-opacity"
              label="粒子不透明度"
              value={settings.particles.opacity}
              min={10}
              max={300}
              unit="%"
              disabled={!settings.enabled || !settings.particles.enabled}
              onChange={(opacity) => updateGroup("particles", { opacity })}
            />
            <Toggle
              checked={settings.connections.enabled}
              label="粒子自动连线"
              onChange={(enabled) => updateGroup("connections", { enabled })}
            />
            <RangeControl
              id="connection-distance"
              label="连接距离"
              value={settings.connections.distance}
              min={70}
              max={220}
              unit="px"
              disabled={!settings.enabled || !settings.connections.enabled}
              onChange={(distance) => updateGroup("connections", { distance })}
            />
            <RangeControl
              id="connection-opacity"
              label="连线不透明度"
              value={settings.connections.opacity}
              min={10}
              max={300}
              unit="%"
              disabled={!settings.enabled || !settings.connections.enabled}
              onChange={(opacity) => updateGroup("connections", { opacity })}
            />
          </section>

          <section className="effect-section">
            <div className="effect-section-title">
              <span><CursorClick size={17} /></span>
              <div>
                <h3>鼠标交互</h3>
                <p>加强粒子避让和靠近光标时的连接反馈。</p>
              </div>
            </div>
            <Toggle
              checked={settings.pointer.enabled}
              label="粒子避让"
              onChange={(enabled) => updateGroup("pointer", { enabled })}
            />
            <RangeControl
              id="pointer-radius"
              label="避让范围"
              value={settings.pointer.radius}
              min={100}
              max={420}
              unit="px"
              disabled={!settings.enabled || !settings.pointer.enabled}
              onChange={(radius) => updateGroup("pointer", { radius })}
            />
            <RangeControl
              id="pointer-strength"
              label="避让强度"
              value={settings.pointer.strength}
              min={8}
              max={100}
              unit="%"
              disabled={!settings.enabled || !settings.pointer.enabled}
              onChange={(strength) => updateGroup("pointer", { strength })}
            />
            <Toggle
              checked={settings.pointer.links}
              label="光标自动连线"
              onChange={(links) => updateGroup("pointer", { links })}
            />
            <RangeControl
              id="pointer-link-distance"
              label="光标连接距离"
              value={settings.pointer.linkDistance}
              min={120}
              max={480}
              unit="px"
              disabled={!settings.enabled || !settings.pointer.enabled || !settings.pointer.links}
              onChange={(linkDistance) => updateGroup("pointer", { linkDistance })}
            />
            <RangeControl
              id="pointer-link-opacity"
              label="光标连线不透明度"
              value={settings.pointer.linkOpacity}
              min={10}
              max={300}
              unit="%"
              disabled={!settings.enabled || !settings.pointer.enabled || !settings.pointer.links}
              onChange={(linkOpacity) => updateGroup("pointer", { linkOpacity })}
            />
          </section>

          <section className="effect-section">
            <div className="effect-section-title">
              <span><GridFour size={17} /></span>
              <div>
                <h3>环境图层</h3>
                <p>分别控制网格、轨道、雾光和扫描线。</p>
              </div>
            </div>
            <Toggle
              checked={settings.grid.enabled}
              label="透视网格"
              onChange={(enabled) => updateGroup("grid", { enabled })}
            />
            <RangeControl
              id="grid-opacity"
              label="网格不透明度"
              value={settings.grid.opacity}
              min={10}
              max={300}
              unit="%"
              disabled={!settings.enabled || !settings.grid.enabled}
              onChange={(opacity) => updateGroup("grid", { opacity })}
            />
            <RangeControl
              id="grid-size"
              label="网格尺寸"
              value={settings.grid.size}
              min={36}
              max={480}
              unit="px"
              disabled={!settings.enabled || !settings.grid.enabled}
              onChange={(size) => updateGroup("grid", { size })}
            />
            <RangeControl
              id="grid-line-width"
              label="网格线宽"
              value={settings.grid.lineWidth}
              min={0.5}
              max={4}
              step={0.1}
              unit="px"
              disabled={!settings.enabled || !settings.grid.enabled}
              onChange={(lineWidth) => updateGroup("grid", { lineWidth })}
            />
            <Toggle
              checked={settings.orbits.enabled}
              label="几何轨道"
              onChange={(enabled) => updateGroup("orbits", { enabled })}
            />
            <RangeControl
              id="orbit-opacity"
              label="轨道不透明度"
              value={settings.orbits.opacity}
              min={10}
              max={300}
              unit="%"
              disabled={!settings.enabled || !settings.orbits.enabled}
              onChange={(opacity) => updateGroup("orbits", { opacity })}
            />
            <RangeControl
              id="orbit-speed"
              label="轨道速度"
              value={settings.orbits.speed}
              min={20}
              max={200}
              unit="%"
              disabled={!settings.enabled || !settings.orbits.enabled}
              onChange={(speed) => updateGroup("orbits", { speed })}
            />
            <Toggle
              checked={settings.haze.enabled}
              label="环境雾光"
              onChange={(enabled) => updateGroup("haze", { enabled })}
            />
            <RangeControl
              id="haze-opacity"
              label="雾光不透明度"
              value={settings.haze.opacity}
              min={10}
              max={300}
              unit="%"
              disabled={!settings.enabled || !settings.haze.enabled}
              onChange={(opacity) => updateGroup("haze", { opacity })}
            />
            <Toggle
              checked={settings.scan.enabled}
              label="扫描光线"
              onChange={(enabled) => updateGroup("scan", { enabled })}
            />
            <RangeControl
              id="scan-opacity"
              label="扫描线不透明度"
              value={settings.scan.opacity}
              min={10}
              max={300}
              unit="%"
              disabled={!settings.enabled || !settings.scan.enabled}
              onChange={(opacity) => updateGroup("scan", { opacity })}
            />
            <RangeControl
              id="scan-speed"
              label="扫描速度"
              value={settings.scan.speed}
              min={30}
              max={200}
              unit="%"
              disabled={!settings.enabled || !settings.scan.enabled}
              onChange={(speed) => updateGroup("scan", { speed })}
            />
          </section>
        </div>

        <footer className="appearance-footer">
          <span>更改已自动保存</span>
          <button onClick={() => onChange(DEFAULT_EFFECT_SETTINGS)}>
            <ArrowCounterClockwise size={15} />
            恢复默认
          </button>
        </footer>
      </aside>
    </div>
  );
}
