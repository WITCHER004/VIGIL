"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { transitionClassic } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface CopyFieldProps {
  value: string;
  /** Rendered text; defaults to `value`. */
  display?: string;
  label?: string;
  className?: string;
}

/** Mono value in a recessed well with a copy button and an animated copper "COPIED" micro-badge. */
export function CopyField({ value, display, label, className }: CopyFieldProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API unavailable (insecure context) — fall back to a hidden textarea.
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className={cn("relative", className)}>
      {label && <p className="label mb-1.5">{label}</p>}
      <div className="well flex items-center gap-2 py-1.5 pl-3 pr-1.5">
        <code className="min-w-0 flex-1 truncate text-[12px] text-ink" title={value}>
          {display ?? value}
        </code>
        <div className="relative flex items-center">
          <AnimatePresence>
            {copied && (
              <motion.span
                key="copied"
                initial={{ opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0, transition: transitionClassic(0.3) }}
                exit={{ opacity: 0, transition: transitionClassic(0.25) }}
                className="absolute right-full mr-2 whitespace-nowrap font-sans text-[12px] text-body"
                role="status"
              >
                Copied
              </motion.span>
            )}
          </AnimatePresence>
          <button
            type="button"
            onClick={copy}
            className="grid h-7 w-7 place-items-center rounded-sm text-silver transition-colors hover:bg-raised hover:text-ink"
            aria-label={`Copy ${label ?? "value"}`}
          >
            {copied ? <Check size={14} strokeWidth={1.5} className="text-ok" /> : <Copy size={14} strokeWidth={1.5} />}
          </button>
        </div>
      </div>
    </div>
  );
}
