"use client";

import { motion } from "framer-motion";
import { EASE_ATELIER, useMotionPreset } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Outcome of the verification stage for the latest request. */
export type PipelineVerdict = "VALID" | "UNSIGNED" | "INVALID" | "THROTTLED";

const VERDICT: Record<PipelineVerdict, { label: string; stroke: string; fill: string }> = {
  VALID: { label: "HMAC verified", stroke: "stroke-ok", fill: "fill-ok" },
  UNSIGNED: { label: "Unsigned", stroke: "stroke-warn", fill: "fill-warn" },
  INVALID: { label: "Signature invalid", stroke: "stroke-crit", fill: "fill-crit" },
  THROTTLED: { label: "Throttled (429)", stroke: "stroke-crit", fill: "fill-crit" },
};

/** Map a stored signature status to the pipeline verdict. */
export function verdictFromSignature(status: string | null | undefined): PipelineVerdict | null {
  if (!status) return null;
  if (status === "VALID") return "VALID";
  if (status === "INVALID") return "INVALID";
  return "UNSIGNED"; // MISSING, UNCHECKED
}

const W = 640;
const H = 84;
const NODES = [
  { x: 70, title: "Incoming payload" },
  { x: 320, title: "Rate limit & HMAC" },
  { x: 570, title: "Vault & replay" },
] as const;

interface WebhookPipelineProps {
  /** Increments when a webhook is captured or a replay fires. */
  pulse: number;
  verdict: PipelineVerdict | null;
  className?: string;
}

/**
 * Compact schematic of the ingest path. A brass pulse travels the wire on each
 * new request and the verification node lights in the verdict's pigment.
 */
export function WebhookPipeline({ pulse, verdict, className }: WebhookPipelineProps) {
  const { reduce } = useMotionPreset();
  const v = verdict ? VERDICT[verdict] : null;
  const y = 26;

  return (
    <figure className={cn("panel px-4 py-3", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[84px] w-full max-w-[720px] mx-auto block" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Webhook pipeline${v ? `: ${v.label}` : ""}`}>
        <line x1={NODES[0].x} y1={y} x2={NODES[2].x} y2={y} className="stroke-hairline-strong" strokeWidth={1} />
        {[NODES[1].x, NODES[2].x].map((nodeX) => {
          const tip = nodeX - 26;
          return <path key={nodeX} d={`M ${tip - 6} ${y - 4} L ${tip} ${y} L ${tip - 6} ${y + 4}`} fill="none" className="stroke-steel" strokeWidth={1} />;
        })}

        {NODES.map((n, i) => {
          const isVerify = i === 1;
          return (
            <g key={n.title}>
              <rect x={n.x - 20} y={y - 14} width={40} height={28} rx={6} className={cn("fill-surface", isVerify && v ? v.stroke : "stroke-hairline-strong")} strokeWidth={isVerify && v ? 1.5 : 1} />
              <circle cx={n.x} cy={y} r={3} className={isVerify && v ? cn(v.stroke, "fill-surface") : "fill-steel"} strokeWidth={1.5} />
              <text x={n.x} y={y + 32} textAnchor="middle" className="fill-body font-sans text-[12px]">
                {n.title}
              </text>
              {isVerify && v && (
                <motion.text key={`${pulse}-${verdict}`} x={n.x} y={y + 50} textAnchor="middle" className={cn("font-sans text-[11px] font-medium", v.fill)} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }}>
                  {v.label}
                </motion.text>
              )}
            </g>
          );
        })}

        {/* Pulse: remounts on every new request so the animation replays */}
        {pulse > 0 && !reduce && (
          <motion.circle
            key={pulse}
            cy={y}
            r={3.5}
            className="fill-brass"
            initial={{ cx: NODES[0].x, opacity: 0 }}
            animate={{ cx: [NODES[0].x, NODES[1].x, NODES[2].x], opacity: [0, 1, 1, 0] }}
            transition={{ duration: 1.4, ease: EASE_ATELIER, times: [0, 0.45, 1] }}
          />
        )}
      </svg>
    </figure>
  );
}
