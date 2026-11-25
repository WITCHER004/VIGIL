import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { fontVariables } from "@/lib/fonts";
import { THEME_STORAGE_KEY } from "@/lib/utils";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Vigil — Uptime, Webhooks & Incidents",
    template: "%s · Vigil",
  },
  description: "API uptime monitoring, webhook inspection and replay, and live incident telemetry.",
  applicationName: "Vigil",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F5F0" },
    { media: "(prefers-color-scheme: dark)", color: "#111110" },
  ],
  colorScheme: "light dark",
};

// Runs before first paint so a saved Nocturne preference never flashes ivory.
const themeBootScript = `try{if(localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})==="dark"){var d=document.documentElement;d.dataset.theme="dark";d.classList.add("dark")}}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={fontVariables} data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        <ThemeProvider>
          <div className="paper-grain" aria-hidden />
          <div className="relative z-[1]">{children}</div>
        </ThemeProvider>
      </body>
    </html>
  );
}
