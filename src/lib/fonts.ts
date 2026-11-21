import { Instrument_Serif, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";

/**
 * Modern Art Typography Architecture
 * - Instrument Serif: Expressive exhibition display headlines & italic accents (MoMA / editorial style)
 * - Plus Jakarta Sans: Swiss International Typographic Style for UI controls, navigation & micro-labels
 * - JetBrains Mono: Tabular telemetry, timestamps, latency figures, HTTP codes & JSON viewers
 */

export const fontDisplay = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
  display: "swap",
});

export const fontSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const fontVariables = `${fontDisplay.variable} ${fontSans.variable} ${fontMono.variable}`;
