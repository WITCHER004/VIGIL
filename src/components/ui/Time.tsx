"use client";

import { useEffect, useState } from "react";
import { formatDateTime, formatRelative } from "@/lib/utils";

interface TimeProps {
  value: string | number | Date;
  mode?: "relative" | "datetime";
  className?: string;
  /** Re-render cadence for relative times. */
  tickMs?: number;
}

/**
 * Hydration-safe timestamp. The server renders in its own clock/time zone;
 * the client accepts that markup without a mismatch error, then immediately
 * re-renders in the viewer's local zone and keeps relative times ticking.
 */
export function Time({ value, mode = "relative", className, tickMs = 15_000 }: TimeProps) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    if (mode !== "relative") return;
    const id = window.setInterval(() => setNow(Date.now()), tickMs);
    return () => window.clearInterval(id);
  }, [mode, tickMs]);

  const date = new Date(value);
  const text = mode === "relative" ? formatRelative(date, now ?? Date.now()) : formatDateTime(date);
  return (
    <time dateTime={date.toISOString()} className={className} title={mode === "relative" ? formatDateTime(date) : undefined} suppressHydrationWarning>
      {text}
    </time>
  );
}
