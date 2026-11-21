import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { fontVariables } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Vigil — Kinetic Gallery Telemetry",
    template: "%s · Vigil",
  },
  description:
    "API uptime monitor, webhook inspector & live incident telemetry designed with Swiss International Typographic rigor and kinetic modern art.",
  applicationName: "Vigil",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F1EA" },
    { media: "(prefers-color-scheme: dark)", color: "#111214" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={fontVariables} data-theme="light" suppressHydrationWarning>
      <body className="min-h-dvh antialiased selection:bg-vermilion/20 selection:text-ink">
        <ThemeProvider>
          {/* Fixed Archival Paper Tooth Overlay */}
          <div className="paper-grain" aria-hidden />
          <div className="relative z-[1]">{children}</div>
        </ThemeProvider>
      </body>
    </html>
  );
}
