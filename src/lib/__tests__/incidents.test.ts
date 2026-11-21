import { describe, expect, it } from "vitest";
import { advanceCounters, deriveStatus, downtimeSeconds, INCIDENT_POLICY } from "../stats";

describe("Incident State Machine & Status Derivation", () => {
  it("advances counters on failures until failureThreshold is met", () => {
    let state = { consecutiveFailures: 0, consecutiveSuccesses: 0, hasOpenIncident: false };

    // Failure 1
    let step = advanceCounters(state, false);
    expect(step.consecutiveFailures).toBe(1);
    expect(step.consecutiveSuccesses).toBe(0);
    expect(step.action).toBe("none");

    // Failure 2
    state = { ...state, consecutiveFailures: step.consecutiveFailures, consecutiveSuccesses: step.consecutiveSuccesses };
    step = advanceCounters(state, false);
    expect(step.consecutiveFailures).toBe(2);
    expect(step.action).toBe("none");

    // Failure 3 (Threshold met -> trigger incident open)
    state = { ...state, consecutiveFailures: step.consecutiveFailures, consecutiveSuccesses: step.consecutiveSuccesses };
    step = advanceCounters(state, false);
    expect(step.consecutiveFailures).toBe(3);
    expect(step.action).toBe("open");
  });

  it("does not re-trigger 'open' if incident is already open", () => {
    const state = { consecutiveFailures: 3, consecutiveSuccesses: 0, hasOpenIncident: true };
    const step = advanceCounters(state, false);
    expect(step.consecutiveFailures).toBe(4);
    expect(step.action).toBe("none");
  });

  it("resets failure streak on a transient success without resolving if under recoveryThreshold", () => {
    const state = { consecutiveFailures: 5, consecutiveSuccesses: 0, hasOpenIncident: true };

    // First recovery check
    const step1 = advanceCounters(state, true);
    expect(step1.consecutiveFailures).toBe(0);
    expect(step1.consecutiveSuccesses).toBe(1);
    expect(step1.action).toBe("none");

    // If it fails again immediately, streak breaks
    const stateAfterStep1 = { ...state, consecutiveFailures: step1.consecutiveFailures, consecutiveSuccesses: step1.consecutiveSuccesses };
    const step2 = advanceCounters(stateAfterStep1, false);
    expect(step2.consecutiveFailures).toBe(1);
    expect(step2.consecutiveSuccesses).toBe(0);
    expect(step2.action).toBe("none");
  });

  it("auto-resolves open incident when recoveryThreshold is satisfied", () => {
    let state = { consecutiveFailures: 4, consecutiveSuccesses: 0, hasOpenIncident: true };

    // Success 1
    let step = advanceCounters(state, true);
    expect(step.consecutiveSuccesses).toBe(1);
    expect(step.action).toBe("none");

    // Success 2 (Threshold met -> trigger incident resolve)
    state = { ...state, consecutiveFailures: step.consecutiveFailures, consecutiveSuccesses: step.consecutiveSuccesses };
    step = advanceCounters(state, true);
    expect(step.consecutiveSuccesses).toBe(2);
    expect(step.action).toBe("resolve");
  });

  it("derives monitor operational status correctly across states", () => {
    // Healthy check under latency threshold
    expect(
      deriveStatus({
        ok: true,
        latencyMs: 120,
        degradedThresholdMs: 500,
        consecutiveFailures: 0,
        hasOpenIncident: false,
      }),
    ).toBe("OPERATIONAL");

    // Healthy check above latency threshold -> DEGRADED
    expect(
      deriveStatus({
        ok: true,
        latencyMs: 650,
        degradedThresholdMs: 500,
        consecutiveFailures: 0,
        hasOpenIncident: false,
      }),
    ).toBe("DEGRADED");

    // Single failure before threshold -> DEGRADED (flapping/warning)
    expect(
      deriveStatus({
        ok: false,
        latencyMs: 10000,
        degradedThresholdMs: 500,
        consecutiveFailures: 1,
        hasOpenIncident: false,
      }),
    ).toBe("DEGRADED");

    // Failures reached threshold -> DOWN
    expect(
      deriveStatus({
        ok: false,
        latencyMs: 10000,
        degradedThresholdMs: 500,
        consecutiveFailures: INCIDENT_POLICY.failureThreshold,
        hasOpenIncident: false,
      }),
    ).toBe("DOWN");

    // Open incident with failure -> DOWN
    expect(
      deriveStatus({
        ok: false,
        latencyMs: 10000,
        degradedThresholdMs: 500,
        consecutiveFailures: 5,
        hasOpenIncident: true,
      }),
    ).toBe("DOWN");

    // Open incident but current check succeeded (recovering) -> DEGRADED
    expect(
      deriveStatus({
        ok: true,
        latencyMs: 150,
        degradedThresholdMs: 500,
        consecutiveFailures: 0,
        hasOpenIncident: true,
      }),
    ).toBe("DEGRADED");

    // Paused monitor is always PAUSED
    expect(
      deriveStatus({
        ok: false,
        latencyMs: 10000,
        degradedThresholdMs: 500,
        consecutiveFailures: 5,
        hasOpenIncident: false,
        isPaused: true,
      }),
    ).toBe("PAUSED");
  });

  it("calculates downtime seconds accurately", () => {
    const start = new Date("2026-01-01T12:00:00Z");
    const end = new Date("2026-01-01T12:05:30Z");
    expect(downtimeSeconds(start, end)).toBe(330);
  });
});
