import { cn } from "@/lib/utils";
import { TONE_RGB, toneForStatus, type Tone } from "./HeartbeatRipple";

const LABELS: Record<string, string> = {
  OPERATIONAL: "Operational",
  DEGRADED: "Degraded",
  DOWN: "Outage",
  PAUSED: "Paused",
  PENDING: "Pending",
  INVESTIGATING: "Investigating",
  IDENTIFIED: "Identified",
  RESOLVED: "Resolved",
  VALID: "HMAC valid",
  INVALID: "HMAC invalid",
  MISSING: "Signature missing",
  UNCHECKED: "Unsigned",
  MAJOR_OUTAGE: "Major outage",
  PARTIAL_OUTAGE: "Partial outage",
  MINOR: "Minor",
  MAJOR: "Major",
  CRITICAL: "Critical",
  HEALTHY: "Healthy",
  LATENCY: "Latency spike",
  OUTAGE: "Outage",
};

const EXTRA_TONES: Record<string, Tone> = {
  MINOR: "idle",
  MAJOR: "warn",
  CRITICAL: "crit",
  HEALTHY: "ok",
  LATENCY: "warn",
  OUTAGE: "crit",
};

export function statusLabel(status: string): string {
  return LABELS[status] ?? status.charAt(0) + status.slice(1).toLowerCase();
}

/** Status as a tone dot with subtle ambient glow and a sentence-case label. */
export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  const tone = EXTRA_TONES[status] ?? toneForStatus(status);
  const rgb = TONE_RGB[tone];
  const isAlert = tone === "crit" || tone === "warn";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-2 whitespace-nowrap font-sans text-[13px]",
        className,
      )}
      style={{ color: `rgb(${rgb})` }}
    >
      <span className="relative flex h-2 w-2 shrink-0 items-center justify-center" aria-hidden>
        {isAlert && (
          <span
            className="absolute inline-flex h-full w-full rounded-full opacity-70 animate-ping"
            style={{ backgroundColor: `rgb(${rgb})` }}
          />
        )}
        <span
          className="relative inline-flex h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: `rgb(${rgb})`, boxShadow: `0 0 6px rgb(${rgb} / 0.7)` }}
        />
      </span>
      {label ?? statusLabel(status)}
    </span>
  );
}
