import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: "#FAFAF9", elev: "#FFFFFF", panel: "#FFFFFF", border: "#E7E5E4" },
        ink: { DEFAULT: "#1C1917", mute: "#57534E", dim: "#A8A29E", inv: "#FAFAF9" },
        brand: { DEFAULT: "#0F766E", hover: "#0D5F58", soft: "#CCFBF1" },
        accent: { DEFAULT: "#F59E0B", hover: "#D97706" },
        ok: "#16A34A",
        warn: "#EAB308",
        err: "#DC2626"
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"]
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)"
      }
    }
  },
  plugins: []
};

export default config;
