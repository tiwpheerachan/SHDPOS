import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--c-bg) / <alpha-value>)",
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        surface2: "rgb(var(--c-surface-2) / <alpha-value>)",
        line: "rgb(var(--c-line) / <alpha-value>)",
        ink: "rgb(var(--c-ink) / <alpha-value>)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
        brand: "rgb(var(--c-brand) / <alpha-value>)",
        brandHover: "rgb(var(--c-brand-hover) / <alpha-value>)",
        brandInk: "rgb(var(--c-brand-ink) / <alpha-value>)",
        ok: "rgb(var(--c-ok) / <alpha-value>)",
        warn: "rgb(var(--c-warn) / <alpha-value>)",
        danger: "rgb(var(--c-danger) / <alpha-value>)",
        info: "rgb(var(--c-info) / <alpha-value>)",
        coral: "rgb(var(--c-coral) / <alpha-value>)",
        lime: "rgb(var(--c-lime) / <alpha-value>)",
        lavender: "rgb(var(--c-lavender) / <alpha-value>)",
        mint: "rgb(var(--c-mint) / <alpha-value>)",
        aqua: "rgb(var(--c-aqua) / <alpha-value>)",
        yellow: "rgb(var(--c-yellow) / <alpha-value>)",
        peach: "rgb(var(--c-peach) / <alpha-value>)",
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
        "3xl": "1.5rem",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgb(17 17 17 / 0.03), 0 8px 28px -14px rgb(17 17 17 / 0.12)",
        pop: "0 16px 48px -12px rgb(17 17 17 / 0.22)",
      },
      keyframes: {
        pop: { "0%": { transform: "scale(.96)", opacity: "0" }, "100%": { transform: "scale(1)", opacity: "1" } },
        slideUp: { "0%": { transform: "translateY(8px)", opacity: "0" }, "100%": { transform: "translateY(0)", opacity: "1" } },
      },
      animation: {
        pop: "pop .14s ease-out",
        slideUp: "slideUp .18s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
