"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

interface RollingNumberProps {
  value: string | number | null | undefined;
  format?: (v: number) => string;
  className?: string;
}

/**
 * Modern Art Rolling Number:
 * Animates digits vertically with smooth cross-fade and zero layout shift,
 * enforcing tabular numbers across all values.
 */
export function RollingNumber({ value, format, className = "" }: RollingNumberProps) {
  const num = typeof value === "number" ? value : Number(value);
  const formatted =
    value == null
      ? "—"
      : format && !isNaN(num)
        ? format(num)
        : String(value);

  const [displayValue, setDisplayValue] = useState(formatted);

  useEffect(() => {
    setDisplayValue(formatted);
  }, [formatted]);

  const chars = displayValue.split("");

  return (
    <span className={`inline-flex items-baseline tabular-nums select-none ${className}`}>
      {chars.map((char, index) => {
        // Only animate numerical digits; symbols/commas stay stable
        if (!/\d/.test(char)) {
          return (
            <span key={`static-${index}`} className="inline-block">
              {char}
            </span>
          );
        }

        return (
          <span
            key={`col-${index}`}
            className="relative inline-block overflow-hidden"
            style={{ width: "1ch", height: "1em", verticalAlign: "-0.1em" }}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={`${index}-${char}`}
                initial={{ y: "80%", opacity: 0 }}
                animate={{ y: "0%", opacity: 1 }}
                exit={{ y: "-80%", opacity: 0 }}
                transition={{ duration: 0.28, ease: [0.19, 1, 0.22, 1] }}
                className="absolute inset-0 flex items-center justify-center"
              >
                {char}
              </motion.span>
            </AnimatePresence>
          </span>
        );
      })}
    </span>
  );
}
