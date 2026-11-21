import type { Metadata, Viewport } from "next";
import { fontVariables } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Vigil — Uptime, Webhooks & Incident Telemetry",
    template: "%s · Vigil",
  },
  description:
    "Synthetic endpoint monitoring, webhook capture & replay, and a live incident state machine — in one Next.js app.",
  applicationName: "Vigil",
};

export const viewport: Viewport = {
  themeColor: "#0A0F1E",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <div className="relative z-[1]">{children}</div>
      </body>
    </html>
  );
}
