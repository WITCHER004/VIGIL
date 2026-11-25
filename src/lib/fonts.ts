import { JetBrains_Mono, Newsreader, Plus_Jakarta_Sans } from "next/font/google";

/**
 * - Newsreader: editorial display headings, with subtle italic emphasis
 * - Plus Jakarta Sans: interface, navigation, body copy and micro-kickers
 * - JetBrains Mono: telemetry, latency, timestamps, status codes and JSON
 * All three are variable fonts, so no weight list is needed.
 */

export const fontDisplay = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
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
