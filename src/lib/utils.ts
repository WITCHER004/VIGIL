import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** localStorage key for the theme; shared by ThemeProvider and the pre-paint boot script in the root layout. */
export const THEME_STORAGE_KEY = "vigil-gallery-theme";

/** Merge conditional class names, resolving Tailwind conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Resolve the public origin of this deployment (used for internal /api/sim/* monitors).
 *
 * Configured origins win over the request URL on purpose: the request origin is derived
 * from the Host header, and trusting it would let a spoofed Host turn the internal
 * `/api/sim/*` SSRF allowance into a bypass. The request URL is only a last resort.
 */
export function getAppOrigin(requestUrl?: string): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (requestUrl) {
    try {
      return new URL(requestUrl).origin;
    } catch {
      /* fall through */
    }
  }
  return "http://localhost:3000";
}

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${nf0.format(Math.round(ms))}ms`;
}

export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** "3h 12m", "42m 05s", "18s" — compact, monospace-friendly durations. */
export function formatDuration(totalSec: number | null | undefined): string {
  if (totalSec == null || !Number.isFinite(totalSec) || totalSec < 0) return "—";
  const s = Math.floor(totalSec);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });

export function formatRelative(date: Date | string | number, now: number = Date.now()): string {
  const t = new Date(date).getTime();
  const diff = Math.round((t - now) / 1000);
  const abs = Math.abs(diff);
  if (abs < 5) return "just now";
  if (abs < 60) return rtf.format(diff, "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86_400), "day");
}

/** ISO-like UTC stamp: "2026-11-21 14:03:22Z" */
export function formatTimestamp(date: Date | string | number): string {
  return new Date(date).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "Z");
}

const dtf = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { hour12: false, ...opts });
const fmtHM = dtf({ hour: "2-digit", minute: "2-digit" });
const fmtDay = dtf({ month: "short", day: "numeric" });
const fmtDayHour = dtf({ month: "short", day: "numeric", hour: "2-digit" });
const fmtFull = dtf({ month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fmtWeekday = dtf({ weekday: "short", month: "short", day: "numeric" });

/** Axis tick label appropriate to a time range. */
export function formatAxisTime(t: number, range: "1H" | "24H" | "7D" | "30D"): string {
  if (range === "1H" || range === "24H") return fmtHM.format(t);
  if (range === "7D") return fmtDayHour.format(t).replace(",", "") + "h";
  return fmtDay.format(t);
}

/** "Nov 21, 14:03:22" (local) */
export function formatDateTime(date: Date | string | number): string {
  return fmtFull.format(new Date(date));
}

/** "Thu, Nov 20" from a UTC day key (YYYY-MM-DD). */
export function formatDayKey(key: string): string {
  return fmtWeekday.format(new Date(`${key}T12:00:00Z`));
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
