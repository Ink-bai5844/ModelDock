export type EffectColorMode = "theme" | "custom";

export interface EffectSettings {
  enabled: boolean;
  colorMode: EffectColorMode;
  customColor: string;
  intensity: number;
  particles: {
    enabled: boolean;
    density: number;
    opacity: number;
  };
  connections: {
    enabled: boolean;
    distance: number;
    opacity: number;
  };
  pointer: {
    enabled: boolean;
    radius: number;
    strength: number;
    links: boolean;
    linkDistance: number;
    linkOpacity: number;
  };
  grid: {
    enabled: boolean;
    opacity: number;
    size: number;
    lineWidth: number;
  };
  orbits: {
    enabled: boolean;
    opacity: number;
    speed: number;
  };
  haze: {
    enabled: boolean;
    opacity: number;
  };
  scan: {
    enabled: boolean;
    opacity: number;
    speed: number;
  };
}

export const DEFAULT_EFFECT_SETTINGS: EffectSettings = {
  enabled: true,
  colorMode: "theme",
  customColor: "#79b8ff",
  intensity: 100,
  particles: {
    enabled: true,
    density: 100,
    opacity: 100,
  },
  connections: {
    enabled: true,
    distance: 122,
    opacity: 100,
  },
  pointer: {
    enabled: true,
    radius: 245,
    strength: 52,
    links: true,
    linkDistance: 300,
    linkOpacity: 100,
  },
  grid: {
    enabled: true,
    opacity: 72,
    size: 68,
    lineWidth: 1,
  },
  orbits: {
    enabled: true,
    opacity: 72,
    speed: 100,
  },
  haze: {
    enabled: true,
    opacity: 64,
  },
  scan: {
    enabled: true,
    opacity: 72,
    speed: 100,
  },
};

export function effectOpacity(value: number) {
  return Math.min(1, Math.max(0, 1 - Math.exp(-value / 58)));
}
