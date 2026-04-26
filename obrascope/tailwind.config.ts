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
        bg: {
          DEFAULT: "#0A0A0A",
          elev: "#111111",
          panel: "#161616",
          border: "#1F1F1F"
        },
        ink: {
          DEFAULT: "#F5F5F5",
          mute: "#A1A1AA",
          dim: "#71717A"
        },
        accent: {
          DEFAULT: "#F59E0B",
          hover: "#FBBF24"
        },
        sema: {
          green: "#10B981",
          yellow: "#EAB308",
          red: "#EF4444"
        }
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"]
      }
    }
  },
  plugins: []
};

export default config;
