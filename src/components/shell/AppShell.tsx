"use client";

import { LayoutGroup, motion } from "framer-motion";
import { Activity, ArrowUpRight, Gauge, TriangleAlert, Webhook, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { TelemetryProvider, useTelemetry, type SystemState } from "@/components/providers/TelemetryProvider";
import { HeartbeatRipple, type Tone } from "@/components/ui/HeartbeatRipple";
import { NAV_INDICATOR_ID, useMotionPreset } from "@/lib/motion";
import { cn, formatRelative } from "@/lib/utils";
import { SimulatorDock } from "./SimulatorDock";

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Overview", icon: Gauge },
  { href: "/monitors", label: "Monitors", icon: Activity },
  { href: "/webhooks", label: "Webhooks", icon: Webhook },
  { href: "/incidents", label: "Incidents", icon: TriangleAlert },
];

const SYSTEM_COPY: Record<SystemState, { label: string; tone: Tone }> = {
  OPERATIONAL: { label: "All systems operational", tone: "ok" },
  DEGRADED: { label: "Degraded performance", tone: "warn" },
  MAJOR_OUTAGE: { label: "Active outage", tone: "crit" },
  UNKNOWN: { label: "Connecting…", tone: "idle" },
};

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Re-renders periodically so "swept 4s ago" stays accurate. */
function useTicker(ms: number) {
  const [, setT] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setT((t) => t + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

function Wordmark() {
  return (
    <Link href="/" className="group flex items-center gap-2.5" aria-label="Vigil — overview">
      <div className="relative flex h-7 w-7 items-center justify-center rounded border border-copper/40 bg-well/80 shadow-[0_0_12px_rgb(232_116_59/0.2)] transition-all duration-300 group-hover:border-copper group-hover:shadow-[0_0_18px_rgb(232_116_59/0.4)]">
        {/* Animated radar aperture */}
        <div className="absolute inset-1 rounded-full border border-copper/30 border-dashed animate-radar-sweep" />
        <div className="h-1.5 w-1.5 rounded-full bg-copper shadow-[0_0_6px_rgb(232_116_59)]" />
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[22px] font-medium leading-none text-ink tracking-tight">Vigil</span>
        <span className="label hidden sm:inline text-silver/70">Telemetry</span>
      </div>
    </Link>
  );
}

function StatusStrip() {
  const { systemState, globalBeat, lastSweepAt, live, setLive, fleet, sweeping } = useTelemetry();
  useTicker(5_000);
  const copy = SYSTEM_COPY[systemState];
  return (
    <div className="flex items-center gap-3 sm:gap-4">
      <div className="hidden items-center gap-2.5 rounded-full border border-hairline/80 bg-surface/60 px-3 py-1 backdrop-blur-md md:flex shadow-sm" aria-live="polite">
        <HeartbeatRipple beat={globalBeat} tone={copy.tone} size={7} />
        <span className="text-[12.5px] font-medium text-ink">{copy.label}</span>
        {fleet.total > 0 && (
          <span className="num ml-1 rounded bg-raised/80 px-1.5 py-0.5 text-[11px] text-silver border border-hairline/60">
            {fleet.OPERATIONAL}/{Math.max(1, fleet.total - fleet.PAUSED)} up
          </span>
        )}
      </div>
      <span className="hidden h-4 w-px bg-hairline md:block" aria-hidden />
      <button
        type="button"
        onClick={() => setLive(!live)}
        aria-pressed={live}
        className={cn(
          "group flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] transition-all duration-200 active:scale-95",
          live
            ? "border-copper/40 bg-copper/10 text-copper shadow-[0_0_12px_rgb(232_116_59/0.15)] hover:border-copper"
            : "border-hairline bg-raised/40 text-silver hover:border-hairline-strong hover:text-body",
        )}
        title={live ? "Live probing on — click to pause" : "Live probing paused — click to resume"}
      >
        <span className="relative flex h-2 w-2 items-center justify-center">
          {live && (
            <span className="absolute inline-flex h-full w-full rounded-full bg-copper opacity-75 animate-ping" />
          )}
          <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", live ? "bg-copper shadow-[0_0_6px_rgb(232_116_59)]" : "bg-silver/40")} />
        </span>
        <span className="font-sans font-medium">{live ? "Live" : "Paused"}</span>
        <span className="num hidden text-[11px] opacity-80 sm:inline">
          {sweeping ? "probing…" : lastSweepAt ? `swept ${formatRelative(lastSweepAt)}` : "—"}
        </span>
      </button>
    </div>
  );
}

function RailNav() {
  const pathname = usePathname();
  const { indicatorTransition } = useMotionPreset();
  const { fleet } = useTelemetry();
  return (
    <aside className="sticky top-[var(--topbar-h)] hidden h-[calc(100dvh-var(--topbar-h))] w-[var(--rail-w)] shrink-0 flex-col border-r border-hairline lg:flex">
      <LayoutGroup id="rail">
        <nav aria-label="Primary" className="flex flex-col gap-0.5 px-3 pt-6">
          <p className="label mb-2 px-3">Console</p>
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-9 items-center gap-2.5 px-3 text-[14px] transition-colors duration-200",
                  active ? "bg-raised/60 text-ink" : "text-silver hover:bg-raised/35 hover:text-body",
                )}
              >
                {active && <motion.span layoutId={NAV_INDICATOR_ID} transition={indicatorTransition} className="absolute inset-y-1.5 left-0 w-[2px] bg-copper" />}
                <Icon size={16} strokeWidth={1.5} className={active ? "text-ink" : ""} />
                {label}
                {href === "/incidents" && fleet.DOWN > 0 && <span className="num ml-auto text-[12px] text-crit">{fleet.DOWN}</span>}
              </Link>
            );
          })}
        </nav>
      </LayoutGroup>

      <div className="mt-auto border-t border-hairline px-6 py-5">
        <p className="label mb-3">Fleet</p>
        <dl className="num grid grid-cols-2 gap-y-1.5 text-[12px]">
          <dt className="text-silver">Operational</dt>
          <dd className="text-right text-ok">{fleet.OPERATIONAL}</dd>
          <dt className="text-silver">Degraded</dt>
          <dd className="text-right text-warn">{fleet.DEGRADED}</dd>
          <dt className="text-silver">Down</dt>
          <dd className="text-right text-crit">{fleet.DOWN}</dd>
          <dt className="text-silver">Paused</dt>
          <dd className="text-right text-silver">{fleet.PAUSED}</dd>
        </dl>
        <Link href="/status/vigil" className="mt-5 flex items-center gap-1.5 text-[12px] text-silver transition-colors hover:text-ink">
          Public status page <ArrowUpRight size={13} strokeWidth={1.5} />
        </Link>
      </div>
    </aside>
  );
}

function MobileNav() {
  const pathname = usePathname();
  const { indicatorTransition } = useMotionPreset();
  return (
    <LayoutGroup id="mobile-nav">
      <nav aria-label="Primary" className="sticky top-[var(--topbar-h)] z-20 flex overflow-x-auto border-b border-hairline bg-canvas lg:hidden">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn("relative flex h-11 shrink-0 items-center gap-2 px-4 text-[13px]", active ? "text-ink" : "text-silver")}
            >
              <Icon size={15} strokeWidth={1.5} className={active ? "text-ink" : ""} />
              {label}
              {active && <motion.span layoutId={NAV_INDICATOR_ID} transition={indicatorTransition} className="absolute inset-x-3 -bottom-px h-[2px] bg-copper" />}
            </Link>
          );
        })}
      </nav>
    </LayoutGroup>
  );
}

/** Architectural top bar + left rail (collapsing to a tab strip on mobile) + simulator dock. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <TelemetryProvider>
      <a href="#main" className="sr-only z-[60] bg-copper px-3 py-2 text-canvas focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 h-[var(--topbar-h)] border-b border-hairline/80 bg-canvas/80 backdrop-blur-lg">
        <div className="flex h-full items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Wordmark />
          </div>
          <div className="flex items-center gap-5">
            <StatusStrip />
            <Link href="/status/vigil" className="hidden items-center gap-1 text-[12px] text-silver transition-colors hover:text-ink sm:flex lg:hidden">
              Status <ArrowUpRight size={13} strokeWidth={1.5} />
            </Link>
          </div>
        </div>
      </header>
      <MobileNav />
      <div className="flex">
        <RailNav />
        <main id="main" className="min-w-0 flex-1 px-4 pb-28 sm:px-8 xl:px-12">
          {children}
        </main>
      </div>
      <SimulatorDock />
    </TelemetryProvider>
  );
}
