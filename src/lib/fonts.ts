import { JetBrains_Mono, Newsreader, Plus_Jakarta_Sans } from "next/font/google";

/** Display & section titles — optical serif with italic accents. */
export const fontDisplay = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-display",
  display: "swap",
});

/** UI controls, navigation and micro-labels. */
export const fontSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

/** Telemetry, URLs, timestamps and JSON. */
export const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const fontVariables = `${fontDisplay.variable} ${fontSans.variable} ${fontMono.variable}`;
