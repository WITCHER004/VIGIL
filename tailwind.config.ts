import type { Config } from "tailwindcss";

const withAlpha = (channel: string) => `rgb(var(${channel}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Modern Art Canvas & Surfaces
        canvas: withAlpha("--c-canvas"),
        surface: withAlpha("--c-surface"),
        raised: withAlpha("--c-raised"),
        well: withAlpha("--c-well"),

        // Archival Pigment Palette
        viridian: withAlpha("--c-viridian"),
        ochre: withAlpha("--c-ochre"),
        vermilion: withAlpha("--c-vermilion"),
        ultramarine: withAlpha("--c-ultramarine"),

        // Structural Inks
        ink: withAlpha("--c-ink"),
        body: withAlpha("--c-body"),
        silver: withAlpha("--c-silver"),
        steel: withAlpha("--c-steel"),

        // Aliases for semantic backward compatibility
        ok: withAlpha("--c-viridian"),
        warn: withAlpha("--c-ochre"),
        crit: withAlpha("--c-vermilion"),
        copper: withAlpha("--c-vermilion"),

        hairline: "var(--hairline)",
        "hairline-strong": "var(--hairline-strong)",
        rule: "var(--rule)",
        "copper-wash": "var(--copper-wash)",
      },
      borderColor: ({ theme }) => ({
        ...theme("colors"),
        DEFAULT: "var(--hairline)",
      }),
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        micro: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.14em" }],
      },
      letterSpacing: {
        label: "0.14em",
      },
      borderRadius: {
        sm: "2px",
        DEFAULT: "2px",
        md: "3px",
      },
      transitionTimingFunction: {
        gallery: "cubic-bezier(0.19, 1, 0.22, 1)",
      },
      boxShadow: {
        drawer: "-1px 0 0 0 var(--hairline-strong), -24px 0 48px -24px rgba(18, 18, 18, 0.15)",
        placard: "0 1px 3px rgba(18, 18, 18, 0.05), 0 10px 24px -10px rgba(18, 18, 18, 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
