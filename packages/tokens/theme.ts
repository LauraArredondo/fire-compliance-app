// Generated from tokens.json — FireGrid theme for React Native / Expo
export const light = {
  "bg": {
    "canvas": "#FCFBF9",
    "subtle": "#F7F5F2"
  },
  "surface": {
    "default": "#FFFFFF",
    "elevated": "#FFFFFF",
    "overlay": "#FFFFFF",
    "sunken": "#EFECE8",
    "glass": "rgba(255,255,255,0.72)",
    "hover": "#F7F5F2",
    "inverse": "#151413"
  },
  "border": {
    "default": "#E2DED8",
    "subtle": "#EFECE8",
    "strong": "#CBC5BD",
    "glass": "rgba(0,0,0,0.06)"
  },
  "text": {
    "primary": "#151413",
    "secondary": "#5B554F",
    "muted": "#7A736B",
    "inverse": "#FFFFFF",
    "onBrand": "#FFFFFF",
    "link": "#C22508"
  },
  "brand": {
    "primary": "#C22508",
    "primaryHover": "#9E220E",
    "primaryPressed": "#822112",
    "secondary": "#F59E0B",
    "subtle": "#FFF4F0",
    "subtleBorder": "#FFCDBD",
    "glow": "rgba(232,50,11,0.18)"
  },
  "gradient": {
    "fireStart": "#DA1432",
    "fireMid": "#FB4D24",
    "fireEnd": "#FBBF24"
  },
  "focus": {
    "ring": "#F97316"
  },
  "status": {
    "successFg": "#047857",
    "successBg": "#ECFDF5",
    "successBorder": "#A7F3D0",
    "warningFg": "#92400E",
    "warningBg": "#FFFBEB",
    "warningBorder": "#FDE68A",
    "dangerFg": "#B70D29",
    "dangerBg": "#FFF1F2",
    "dangerBorder": "#FFC7CD",
    "infoFg": "#1D4ED8",
    "infoBg": "#EFF6FF",
    "infoBorder": "#BFDBFE",
    "neutralFg": "#423E3A",
    "neutralBg": "#EFECE8",
    "neutralBorder": "#E2DED8",
    "successSolid": "#059669",
    "warningSolid": "#F59E0B",
    "dangerSolid": "#DA1432",
    "infoSolid": "#2563EB"
  }
} as const;

export const dark = {
  "bg": {
    "canvas": "#000000",
    "subtle": "#090808"
  },
  "surface": {
    "default": "#0E0D0C",
    "elevated": "#151413",
    "overlay": "#1E1C1A",
    "sunken": "#000000",
    "glass": "rgba(255,255,255,0.05)",
    "hover": "#1E1C1A",
    "inverse": "#F7F5F2"
  },
  "border": {
    "default": "#2A2725",
    "subtle": "#1E1C1A",
    "strong": "#423E3A",
    "glass": "rgba(255,255,255,0.1)"
  },
  "text": {
    "primary": "#F7F5F2",
    "secondary": "#CBC5BD",
    "muted": "#A29B92",
    "inverse": "#151413",
    "onBrand": "#000000",
    "link": "#FB923C"
  },
  "brand": {
    "primary": "#F97316",
    "primaryHover": "#FB923C",
    "primaryPressed": "#EA580C",
    "secondary": "#FBBF24",
    "subtle": "rgba(249,115,22,0.12)",
    "subtleBorder": "rgba(249,115,22,0.32)",
    "glow": "rgba(249,115,22,0.45)"
  },
  "gradient": {
    "fireStart": "#F2304A",
    "fireMid": "#FB4D24",
    "fireEnd": "#FBBF24"
  },
  "focus": {
    "ring": "#FB923C"
  },
  "status": {
    "successFg": "#34D399",
    "successBg": "rgba(16,185,129,0.14)",
    "successBorder": "rgba(16,185,129,0.35)",
    "warningFg": "#FCD34D",
    "warningBg": "rgba(251,191,36,0.14)",
    "warningBorder": "rgba(251,191,36,0.35)",
    "dangerFg": "#FF9CA7",
    "dangerBg": "rgba(242,48,74,0.16)",
    "dangerBorder": "rgba(242,48,74,0.4)",
    "infoFg": "#93C5FD",
    "infoBg": "rgba(59,130,246,0.14)",
    "infoBorder": "rgba(59,130,246,0.35)",
    "neutralFg": "#CBC5BD",
    "neutralBg": "#1E1C1A",
    "neutralBorder": "#423E3A",
    "successSolid": "#10B981",
    "warningSolid": "#FBBF24",
    "dangerSolid": "#F2304A",
    "infoSolid": "#3B82F6"
  }
} as const;

export const spacing = {
  "0": 0,
  "0.5": 2,
  "1": 4,
  "1.5": 6,
  "2": 8,
  "3": 12,
  "4": 16,
  "5": 20,
  "6": 24,
  "8": 32,
  "10": 40,
  "12": 48,
  "16": 64,
  "20": 80,
  "24": 96
} as const;

export const radius = {
  "none": 0,
  "xs": 4,
  "sm": 8,
  "md": 12,
  "lg": 16,
  "xl": 20,
  "2xl": 28,
  "3xl": 36,
  "full": 999
} as const;

export const duration = {
  "instant": 80,
  "fast": 140,
  "base": 220,
  "slow": 360,
  "slower": 560
} as const;

export const easing = {
  "standard": [
    0.2,
    0.0,
    0.0,
    1.0
  ],
  "emphasized": [
    0.3,
    0.0,
    0.0,
    1.0
  ],
  "decelerate": [
    0.0,
    0.0,
    0.0,
    1.0
  ],
  "spring": [
    0.34,
    1.56,
    0.64,
    1.0
  ]
} as const;

export const font = {
  "family": {
    "sans": [
      "Geist",
      "Inter",
      "system-ui",
      "sans-serif"
    ],
    "mono": [
      "Geist Mono",
      "JetBrains Mono",
      "ui-monospace",
      "monospace"
    ]
  }
} as const;

export type Theme = typeof light;
export const themes = { light, dark };
