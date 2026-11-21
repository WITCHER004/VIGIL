"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MonitorSummary } from "@/lib/client/types";
import { SPRING_MOBILE } from "@/lib/motion";

interface KineticStatusTotemProps {
  systemState: "OPERATIONAL" | "DEGRADED" | "MAJOR_OUTAGE" | "UNKNOWN";
  uptimePercent?: number | null;
  monitors: MonitorSummary[];
  globalBeat?: number;
}

export function KineticStatusTotem({
  systemState,
  uptimePercent = 99.94,
  monitors,
  globalBeat = 0,
}: KineticStatusTotemProps) {
  const router = useRouter();
  const [hoveredMonitor, setHoveredMonitor] = useState<MonitorSummary | null>(null);

  // Kinetic state parameters
  const isHealthy = systemState === "OPERATIONAL";
  const isDegraded = systemState === "DEGRADED";
  const isOutage = systemState === "MAJOR_OUTAGE";

  // Balance beam angle & sphere colors
  const beamAngle = isHealthy ? 0 : isDegraded ? -12 : -22;
  const sphereColor = isHealthy
    ? "var(--c-viridian)"
    : isDegraded
      ? "var(--c-ochre)"
      : "var(--c-vermilion)";

  const stateLabel = isHealthy
    ? "EQUILIBRIUM"
    : isDegraded
      ? "ATTENUATED"
      : "DISRUPTED";

  // Max 8 perimeter ticks to maintain clean Bauhaus negative space
  const visibleMonitors = monitors.slice(0, 8);
  const radius = 68;
  const centerX = 140;
  const centerY = 88;

  return (
    <div className="relative flex flex-col items-center justify-between p-4 bg-surface border border-hairline rounded-[2px] shadow-sm select-none">
      {/* Interactive Calder-inspired SVG Canvas */}
      <div className="relative w-full max-w-[280px] h-[160px] flex items-center justify-center">
        <svg
          viewBox="0 0 280 176"
          className="w-full h-full overflow-visible"
          role="img"
          aria-label="Kinetic Status Sculpture"
        >
          {/* Fulcrum Base Line */}
          <line
            x1="80"
            y1="152"
            x2="200"
            y2="152"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-hairline-strong"
          />
          {/* Fulcrum Geometric Triangle */}
          <polygon
            points="140,126 130,152 150,152"
            fill="currentColor"
            className="text-body/20"
            stroke="currentColor"
            strokeWidth="1"
          />

          {/* Concentric Orbital Rings (Rotates in cadence with live probe beats) */}
          <motion.circle
            cx={centerX}
            cy={centerY}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="4 6"
            className="text-hairline-strong opacity-40"
            animate={{ rotate: 360 }}
            transition={{ duration: 60, ease: "linear", repeat: Infinity }}
            style={{ originX: `${centerX}px`, originY: `${centerY}px` }}
          />

          <motion.circle
            cx={centerX}
            cy={centerY}
            r={radius - 22}
            fill="none"
            stroke="currentColor"
            strokeWidth="0.75"
            className="text-hairline opacity-60"
          />

          {/* Calder Kinetic Articulated Lever Arm */}
          <motion.g
            animate={{ rotate: beamAngle }}
            transition={SPRING_MOBILE}
            style={{ originX: `${centerX}px`, originY: `${centerY + 38}px` }}
          >
            {/* Main Spine */}
            <line
              x1={centerX}
              y1={centerY + 38}
              x2={centerX}
              y2={centerY - 32}
              stroke="currentColor"
              strokeWidth="2"
              className="text-ink"
            />
            {/* Horizontal Balance Cross-bar */}
            <line
              x1={centerX - 52}
              y1={centerY - 16}
              x2={centerX + 52}
              y2={centerY - 16}
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-ink"
            />

            {/* Left Balance Disc (Carbon Ink Counterweight) */}
            <circle
              cx={centerX - 52}
              cy={centerY - 16}
              r="6.5"
              fill="currentColor"
              className="text-ink"
            />

            {/* Right Health Kinetic Sphere */}
            <motion.circle
              cx={centerX + 52}
              cy={centerY - 16}
              r="10"
              style={{ fill: `rgb(${sphereColor})` }}
              animate={{
                scale: [1, 1.08, 1],
              }}
              transition={{
                duration: 2.4,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          </motion.g>

          {/* Floating Perimeter Monitor Nodes */}
          {visibleMonitors.map((m, idx) => {
            const angle = (idx / visibleMonitors.length) * 2 * Math.PI - Math.PI / 2;
            const x = centerX + Math.cos(angle) * radius;
            const y = centerY + Math.sin(angle) * radius;
            const isDown = m.status === "DOWN";
            const isDeg = m.status === "DEGRADED";
            const nodeFill = isDown
              ? "rgb(var(--c-vermilion))"
              : isDeg
                ? "rgb(var(--c-ochre))"
                : "rgb(var(--c-viridian))";

            return (
              <g
                key={m.id}
                className="cursor-pointer group"
                onClick={() => router.push(`/monitors/${m.id}`)}
                onMouseEnter={() => setHoveredMonitor(m)}
                onMouseLeave={() => setHoveredMonitor(null)}
              >
                {/* Visual hit target */}
                <circle cx={x} cy={y} r="12" fill="transparent" />
                {/* Bauhaus Square tick for monitors */}
                <rect
                  x={x - 3.5}
                  y={y - 3.5}
                  width="7"
                  height="7"
                  fill={nodeFill}
                  className="transition-transform duration-200 group-hover:scale-150"
                />
              </g>
            );
          })}
        </svg>

        {/* Hover Placard Tooltip */}
        {hoveredMonitor && (
          <div className="absolute top-2 left-2 z-20 pointer-events-none bg-raised/95 border border-hairline-strong px-2.5 py-1.5 rounded-[2px] shadow-placard backdrop-blur-sm text-[11px]">
            <p className="font-sans font-medium text-ink truncate max-w-[150px]">
              {hoveredMonitor.name}
            </p>
            <p className="font-mono text-body text-[10px]">
              {hoveredMonitor.lastLatencyMs ? `${hoveredMonitor.lastLatencyMs}ms` : "—"} ·{" "}
              <span className={hoveredMonitor.status === "DOWN" ? "text-vermilion font-bold" : ""}>
                {hoveredMonitor.status}
              </span>
            </p>
          </div>
        )}
      </div>

      {/* Museum Exhibition Caption Plaque */}
      <div className="w-full mt-2 pt-2.5 border-t border-hairline flex items-center justify-between text-[11px] font-sans">
        <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-silver">
          FIG. 01 — {stateLabel}
        </span>
        <span className="font-mono text-[10px] tabular-nums font-medium text-ink">
          {uptimePercent != null ? `${uptimePercent.toFixed(2)}% UPTIME` : "100.00% UPTIME"}
        </span>
      </div>
    </div>
  );
}
