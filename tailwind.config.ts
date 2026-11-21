import type { Config } from "tailwindcss";

/**
 * Vigil design tokens. Every colour resolves to a CSS variable defined in
 * src/app/globals.css so the palette has exactly one source of truth.
 * Channel-form variables (`--c-*`) allow Tailwind opacity modifiers: `bg-copper/10`.
 */
const withAlpha = (channel: string) => `rgb(var(${channel}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        canvas: withAlpha("--c-canvas"), // #0A0F1E — page backdrop
        surface: withAlpha("--c-surface"), // #0F1629 — cards / panels
        raised: withAlpha("--c-raised"), // #151E36 — drawers / hover
        well: withAlpha("--c-well"), // #070B16 — recessed code wells
        silver: withAlpha("--c-silver"), // #8FA3C7 — structural ink
        steel: withAlpha("--c-steel"), // #5F7396 — muted steel (p95)
        copper: withAlpha("--c-copper"), // #E8743B — primary accent
        ink: withAlpha("--c-ink"), // #EEF2F8 — headlines & values
        body: withAlpha("--c-body"), // #B7C5DE — body copy
        ok: withAlpha("--c-ok"), // #4FA88B — operational
        warn: withAlpha("--c-warn"), // #D4A24C — degraded
        crit: withAlpha("--c-crit"), // #D65246 — outage
        hairline: "var(--hairline)",
        "hairline-strong": "var(--hairline-strong)",
        rule: "var(--rule)",
        "copper-wash": "var(--copper-wash)",
      },
      borderColor: {
        DEFAULT: "var(--hairline)",
      },
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
        DEFAULT: "3px",
        md: "4px",
      },
      transitionTimingFunction: {
        classic: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      boxShadow: {
        drawer: "-1px 0 0 0 var(--hairline-strong), -24px 0 48px -24px rgb(3 6 14 / 0.6)",
        focus: "0 0 0 1px rgb(var(--c-copper)), 0 0 0 4px var(--copper-wash)",
      },
      backgroundImage: {
        sheen: "radial-gradient(ellipse 80% 50% at 50% -10%, rgb(143 163 199 / 0.07), transparent 70%)",
      },
    },
  },
  plugins: [],
};

export default config;
