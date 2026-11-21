"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import type { MonitorSummary, ProbeResult, SweepResponse } from "@/lib/client/types";

/**
 * Live telemetry engine.
 *
 * While any dashboard tab is visible it calls POST /api/probe/sweep {scope:"due"}
 * on a fixed cadence. The server leases due monitors atomically, so N open tabs
 * still probe each monitor once per interval — no extra infrastructure needed.
 *
 * Exposes:
 *   version   — bumps whenever data changed; components refetch on change
 *   pulses    — per-monitor beat counters that drive heartbeat ripples
 *   fleet     — monitor status counts for the top status strip
 */

const POLL_MS = 8_000;
const LIVE_KEY = "vigil:live";

type Fleet = { OPERATIONAL: number; DEGRADED: number; DOWN: number; PAUSED: number; PENDING: number; total: number };
export type SystemState = "OPERATIONAL" | "DEGRADED" | "MAJOR_OUTAGE" | "UNKNOWN";

interface TelemetryValue {
  live: boolean;
  setLive: (v: boolean) => void;
  version: number;
  bump: () => void;
  pulses: Readonly<Record<string, number>>;
  globalBeat: number;
  lastSweepAt: number | null;
  sweeping: boolean;
  fleet: Fleet;
  systemState: SystemState;
  /** Record results from any probe (manual, sweep) so ripples fire and views refresh. */
  registerResults: (results: ProbeResult[]) => void;
  runFullSweep: () => Promise<SweepResponse>;
}

const TelemetryContext = createContext<TelemetryValue | null>(null);

const EMPTY_FLEET: Fleet = { OPERATIONAL: 0, DEGRADED: 0, DOWN: 0, PAUSED: 0, PENDING: 0, total: 0 };

function readLivePref(): boolean {
  try {
    return window.localStorage.getItem(LIVE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function TelemetryProvider({ children }: { children: React.ReactNode }) {
  const [live, setLiveState] = useState(true);
  const [version, setVersion] = useState(0);
  const [pulses, setPulses] = useState<Record<string, number>>({});
  const [globalBeat, setGlobalBeat] = useState(0);
  const [lastSweepAt, setLastSweepAt] = useState<number | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [fleet, setFleet] = useState<Fleet>(EMPTY_FLEET);
  const inFlight = useRef(false);
  const backoffUntil = useRef(0);

  useEffect(() => setLiveState(readLivePref()), []);

  const setLive = useCallback((v: boolean) => {
    setLiveState(v);
    try {
      window.localStorage.setItem(LIVE_KEY, v ? "on" : "off");
    } catch {
      /* storage unavailable — preference lasts for this session only */
    }
  }, []);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const registerResults = useCallback((results: ProbeResult[]) => {
    if (results.length === 0) return;
    setPulses((prev) => {
      const next = { ...prev };
      for (const r of results) next[r.monitorId] = (next[r.monitorId] ?? 0) + 1;
      return next;
    });
    setGlobalBeat((b) => b + 1);
    setVersion((v) => v + 1);
  }, []);

  const sweep = useCallback(
    async (scope: "due" | "all"): Promise<SweepResponse> => {
      inFlight.current = true;
      setSweeping(true);
      try {
        const res = await apiFetch<SweepResponse>("/api/probe/sweep", { method: "POST", json: { scope } });
        registerResults(res.results);
        setLastSweepAt(Date.now());
        return res;
      } catch (err) {
        if (err instanceof ApiClientError && (err.status === 429 || err.status === 401 || err.status === 503)) {
          backoffUntil.current = Date.now() + 30_000;
        }
        throw err;
      } finally {
        inFlight.current = false;
        setSweeping(false);
      }
    },
    [registerResults],
  );

  const runFullSweep = useCallback(() => sweep("all"), [sweep]);

  // Live polling loop
  useEffect(() => {
    if (!live) return;
    const tick = () => {
      if (document.hidden || inFlight.current || Date.now() < backoffUntil.current) return;
      sweep("due").catch(() => {});
    };
    tick();
    const id = window.setInterval(tick, POLL_MS);
    const onVisible = () => !document.hidden && tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [live, sweep]);

  // Fleet status for the top strip — refreshed whenever data changes.
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ monitors: MonitorSummary[] }>("/api/monitors")
      .then(({ monitors }) => {
        if (cancelled) return;
        const f: Fleet = { ...EMPTY_FLEET, total: monitors.length };
        for (const m of monitors) f[m.status]++;
        setFleet(f);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [version]);

  const systemState: SystemState =
    fleet.total === 0 ? "UNKNOWN" : fleet.DOWN > 0 ? "MAJOR_OUTAGE" : fleet.DEGRADED > 0 ? "DEGRADED" : "OPERATIONAL";

  const value = useMemo<TelemetryValue>(
    () => ({
      live,
      setLive,
      version,
      bump,
      pulses,
      globalBeat,
      lastSweepAt,
      sweeping,
      fleet,
      systemState,
      registerResults,
      runFullSweep,
    }),
    [live, setLive, version, bump, pulses, globalBeat, lastSweepAt, sweeping, fleet, systemState, registerResults, runFullSweep],
  );

  return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>;
}

export function useTelemetry(): TelemetryValue {
  const ctx = useContext(TelemetryContext);
  if (!ctx) throw new Error("useTelemetry must be used inside <TelemetryProvider>");
  return ctx;
}

/**
 * Fetch JSON and refetch whenever telemetry `version` (or deps) change. Keeps stale
 * data while refreshing. When `initial` is supplied (server-rendered props), the
 * first client fetch is skipped so hydration doesn't immediately re-request it.
 */
export function useLiveResource<T>(path: string | null, deps: readonly unknown[] = [], initial: T | null = null) {
  const { version } = useTelemetry();
  const [data, setData] = useState<T | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path) && initial == null);
  const [nonce, setNonce] = useState(0);
  const skipFirst = useRef(initial != null);

  useEffect(() => {
    if (!path) return;
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiFetch<T>(path)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, version, nonce, ...deps]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, refresh, setData };
}
