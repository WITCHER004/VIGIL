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

/** Status as a tone dot and a sentence-case label — no box, so tables stay quiet. */
export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  const tone = EXTRA_TONES[status] ?? toneForStatus(status);
  const rgb = TONE_RGB[tone];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-2 whitespace-nowrap font-sans text-[13px]",
        className,
      )}
      style={{ color: `rgb(${rgb})` }}
    >
      <span className="dot" style={{ backgroundColor: `rgb(${rgb})` }} />
      {label ?? statusLabel(status)}
    </span>
  );
}
