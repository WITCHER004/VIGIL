"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { RollingNumber } from "@/components/ui/RollingNumber";
import { useMotionPreset } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  index?: string | number; // e.g. "01", "02"
  label: string;
  value: ReactNode;
  unit?: ReactNode;
  footnote?: ReactNode;
  indicator?: ReactNode;
  statusColor?: "viridian" | "ochre" | "vermilion" | "ultramarine" | "carbon";
  className?: string;
}

const COLOR_BAR = {
  viridian: "bg-viridian",
  ochre: "bg-ochre",
  vermilion: "bg-vermilion",
  ultramarine: "bg-ultramarine",
  carbon: "bg-ink",
};

/**
 * Exhibition Placard KPI Strip Item:
 * Numbered gallery placard with 3px top pigment bar, monumental typography,
 * and architectural hairline dividing rules.
 */
export function KpiCard({
  index,
  label,
  value,
  unit,
  footnote,
  indicator,
  statusColor = "carbon",
  className,
}: KpiCardProps) {
  const { titleReveal, cardLift } = useMotionPreset();

  return (
    <motion.div
      variants={titleReveal}
      whileHover={cardLift}
      transition={{ duration: 0.2 }}
      className={cn(
        "group relative panel flex min-h-[140px] flex-col justify-between overflow-hidden p-5 bg-surface transition-all duration-200 border border-hairline shadow-sm",
        className,
      )}
    >
      {/* 3px Top Minimalist Color-Blocked Pigment Bar */}
      <div
        className={cn("absolute inset-x-0 top-0 h-[3px]", COLOR_BAR[statusColor] ?? "bg-ink")}
        aria-hidden
      />

      {/* Top Header Row with Placard Index + Label */}
      <div className="relative z-10 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {index && (
            <span className="font-mono text-[10px] tracking-wider text-silver uppercase font-semibold">
              {String(index).padStart(2, "0")} —
            </span>
          )}
          <p className="label text-silver group-hover:text-ink transition-colors">{label}</p>
        </div>
        {indicator}
      </div>

      {/* Monumental Figures */}
      <div className="relative z-10 mt-3 flex items-baseline gap-1.5">
        <span className="font-display text-[36px] font-normal leading-none tracking-tight text-ink tabular-nums">
          {typeof value === "string" || typeof value === "number" ? (
            <RollingNumber value={value} />
          ) : (
            value
          )}
        </span>
        {unit && <span className="font-mono text-[13px] text-body">{unit}</span>}
      </div>

      {/* Footnote Caption */}
      {footnote && (
        <div className="relative z-10 mt-2 text-[12px] text-body group-hover:text-ink transition-colors font-sans">
          {footnote}
        </div>
      )}
    </motion.div>
  );
}
