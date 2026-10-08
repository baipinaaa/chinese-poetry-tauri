import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "var(--color-primary)",
        secondary: "var(--color-secondary)",
        cta: "var(--color-cta)",
        background: "var(--color-background)",
        text: "var(--color-text)",
      },
      fontFamily: {
        serif: ["Noto Serif SC", "Noto Serif JP", "serif"],
        sans: ["Noto Sans SC", "Noto Sans JP", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
