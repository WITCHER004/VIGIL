"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { useMotionPreset } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface AnimatedMetricProps {
  value: number | null | undefined;
  format?: (v: number) => string;
  placeholder?: string;
  /** Reserve at least this many character cells so growth never nudges neighbours. */
  minChars?: number;
  className?: string;
}

/**
 * Tabular number that rolls each changed glyph vertically (up when the value
 * rises, down when it falls). Glyphs are keyed from the right so units and
 * the least-significant digits stay anchored when the string length changes;
 * JetBrains Mono + tabular-nums guarantee constant glyph width.
 */
export function AnimatedMetric({ value, format = String, placeholder = "—", minChars, className }: AnimatedMetricProps) {
  const { digitRoll } = useMotionPreset();

  // Derived-state pattern: remember the previous value without mutating refs during render.
  const [track, setTrack] = useState<{ current: typeof value; previous: typeof value }>({ current: value, previous: value });
  if (track.current !== value) setTrack({ current: value, previous: track.current });
  const direction: 1 | -1 = value != null && track.previous != null && value < track.previous ? -1 : 1;

  const text = value == null || !Number.isFinite(value) ? placeholder : format(value);
  const chars = text.split("");

  return (
    <span className={cn("num inline-flex whitespace-pre", className)} style={minChars ? { minWidth: `${minChars}ch` } : undefined}>
      <span className="sr-only">{text}</span>
      {chars.map((ch, i) => (
        <span key={chars.length - i} aria-hidden className="relative inline-block overflow-hidden align-baseline">
          <AnimatePresence mode="popLayout" initial={false} custom={direction}>
            <motion.span key={ch} custom={direction} variants={digitRoll} initial="enter" animate="center" exit="exit" className="inline-block">
              {ch}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </span>
  );
}
