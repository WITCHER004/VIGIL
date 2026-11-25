"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { useMotionPreset } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  /** Ordinal shown before the label, e.g. 1 → "01". */
  index?: number;
  label: string;
  value: ReactNode;
  footnote?: ReactNode;
  /** Small trailing element in the label row (e.g. a status dot). */
  indicator?: ReactNode;
  className?: string;
}

/** Stat card: numbered label, one tabular figure, and what it compares to. */
export function KpiCard({ index, label, value, footnote, indicator, className }: KpiCardProps) {
  const { titleReveal } = useMotionPreset();
  return (
    <motion.div variants={titleReveal} className={cn("panel flex min-h-[132px] flex-col justify-between p-5", className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="label">
          {index != null && <span className="num mr-2 text-silver">{String(index).padStart(2, "0")}</span>}
          {label}
        </p>
        {indicator}
      </div>
      <div className="num mt-3 font-mono text-[30px] font-medium leading-none tracking-tight text-ink">{value}</div>
      {footnote && <div className="mt-3 text-[12px] text-body">{footnote}</div>}
    </motion.div>
  );
}
