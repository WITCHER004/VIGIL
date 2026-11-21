"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { useMotionPreset } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: ReactNode;
  unit?: ReactNode;
  footnote?: ReactNode;
  indicator?: ReactNode;
  className?: string;
}

/** Stat card: a label, one tabular figure and what it compares to. */
export function KpiCard({ label, value, unit, footnote, indicator, className }: KpiCardProps) {
  const { titleReveal } = useMotionPreset();

  return (
    <motion.div
      variants={titleReveal}
      className={cn("panel flex min-h-[128px] flex-col justify-between p-5", className)}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="label">{label}</p>
        {indicator}
      </div>
      <div className="mt-4 flex items-baseline gap-1.5">
        <span className="num text-[32px] font-medium leading-none tracking-tight text-ink">{value}</span>
        {unit && <span className="num text-[13px] text-silver">{unit}</span>}
      </div>
      {footnote && <p className="mt-3 text-[12px] text-silver">{footnote}</p>}
    </motion.div>
  );
}
