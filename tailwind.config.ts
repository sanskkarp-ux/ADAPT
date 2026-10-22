import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        abyss: "#071422",
        panel: "#0c1c2e",
        raised: "#123049",
        line: "#23465f",
        ink: "#e8f1f8",
        mute: "#9eb4c6",
        cyan: "#7fd3e8",
        cyandim: "#123848",
        sand: "#e4d2b8",
        sandink: "#2c241c",
        amber: "#f0c48a",
        amberdim: "#3a2c18",
        ok: "#8fd4ae",
        okdim: "#143228",
        bad: "#f0b0aa",
        baddim: "#3a2224",
      },
      fontFamily: {
        sans: ["var(--font-outfit)", "Avenir Next", "Segoe UI", "sans-serif"],
        display: ["var(--font-fraunces)", "Palatino Linotype", "Palatino", "serif"],
      },
      boxShadow: {
        panel: "0 24px 60px rgba(0, 0, 0, 0.28)",
      },
    },
  },
  plugins: [],
};

export default config;
