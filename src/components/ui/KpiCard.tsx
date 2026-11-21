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
  const { titleReveal, cardLift } = useMotionPreset();

  return (
    <motion.div
      variants={titleReveal}
      whileHover={cardLift}
      transition={{ duration: 0.2 }}
      className={cn(
        "group panel reticle panel-interactive flex min-h-[132px] flex-col justify-between overflow-hidden p-5 transition-all duration-200",
        className,
      )}
    >
      {/* Ambient gradient spotlight on hover */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-px opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-[radial-gradient(circle_at_top_right,rgba(232,116,59,0.08),transparent_70%)]"
      />
      <div className="relative z-10 flex items-center justify-between gap-3">
        <p className="label group-hover:text-ink/90 transition-colors">{label}</p>
        {indicator}
      </div>
      <div className="relative z-10 mt-4 flex items-baseline gap-1.5">
        <span className="num text-[34px] font-medium leading-none tracking-tight text-ink drop-shadow-[0_2px_8px_rgba(3,6,14,0.4)]">
          {value}
        </span>
        {unit && <span className="num text-[13px] text-silver/80">{unit}</span>}
      </div>
      {footnote && <p className="relative z-10 mt-3 text-[12px] text-silver/80 group-hover:text-silver transition-colors">{footnote}</p>}
    </motion.div>
  );
}
