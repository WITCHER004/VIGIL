"use client";

import { LayoutGroup, motion } from "framer-motion";
import { Activity, ArrowUpRight, Command, Gauge, KeyRound, Moon, Sun, TriangleAlert, Webhook, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { OperatorUnlockModal } from "@/components/auth/OperatorUnlockModal";
import { TelemetryProvider, useTelemetry, type SystemState } from "@/components/providers/TelemetryProvider";
import { useTheme } from "@/components/providers/ThemeProvider";
import { HeartbeatRipple, type Tone } from "@/components/ui/HeartbeatRipple";
import { NAV_INDICATOR_ID, useMotionPreset } from "@/lib/motion";
import { cn, formatRelative } from "@/lib/utils";
import { CommandPalette } from "./CommandPalette";
import { SimulatorDock } from "./SimulatorDock";

const NAV: { href: string; room: string; label: string; icon: LucideIcon }[] = [
  { href: "/", room: "01", label: "Overview", icon: Gauge },
  { href: "/monitors", room: "02", label: "Monitors", icon: Activity },
  { href: "/webhooks", room: "03", label: "Webhooks", icon: Webhook },
  { href: "/incidents", room: "04", label: "Incidents", icon: TriangleAlert },
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

function useTicker(ms: number) {
  const [, setT] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setT((t) => t + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

function Wordmark() {
  return (
    <Link href="/" className="group flex items-center gap-3" aria-label="Vigil — kinetic gallery telemetry">
      <div className="relative flex h-8 w-8 items-center justify-center rounded-[2px] border border-vermilion/50 bg-well transition-all duration-300 group-hover:border-vermilion group-hover:bg-surface">
        <div className="absolute inset-1 rounded-full border border-vermilion/30 border-dashed animate-radar-sweep" />
        <div className="h-1.5 w-1.5 rounded-full bg-vermilion shadow-sm" />
      </div>
      <div className="flex flex-col">
        <span className="font-display text-[24px] font-normal leading-none tracking-tight text-ink">Vigil</span>
        <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-silver">Kinetic Telemetry</span>
      </div>
    </Link>
  );
}

function StatusStrip() {
  const { systemState, globalBeat, lastSweepAt, live, setLive, fleet, sweeping } = useTelemetry();
  useTicker(5_000);
  const copy = SYSTEM_COPY[systemState];

  return (
    <div className="flex items-center gap-3">
      <div className="hidden items-center gap-2.5 rounded-[2px] border border-hairline bg-surface px-3 py-1.5 shadow-sm md:flex" aria-live="polite">
        <HeartbeatRipple beat={globalBeat} tone={copy.tone} size={7} />
        <span className="text-[12px] font-medium text-ink">{copy.label}</span>
        {fleet.total > 0 && (
          <span className="num ml-1 rounded-[1px] bg-well px-1.5 py-0.5 text-[11px] text-body border border-hairline">
            {fleet.OPERATIONAL}/{Math.max(1, fleet.total - fleet.PAUSED)}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={() => setLive(!live)}
        aria-pressed={live}
        className={cn(
          "group flex items-center gap-2 rounded-[2px] border px-2.5 py-1 text-[12px] transition-all duration-150 active:scale-95",
          live
            ? "border-vermilion/40 bg-vermilion/10 text-vermilion hover:border-vermilion"
            : "border-hairline bg-surface text-silver hover:border-hairline-strong hover:text-body",
        )}
        title={live ? "Continuous live probing active — click to pause" : "Continuous probing paused — click to resume"}
      >
        <span className="relative flex h-2 w-2 items-center justify-center">
          {live && <span className="absolute inline-flex h-full w-full rounded-full bg-vermilion opacity-75 animate-ping" />}
          <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", live ? "bg-vermilion" : "bg-silver/40")} />
        </span>
        <span className="font-sans font-medium">{live ? "Live" : "Paused"}</span>
        <span className="num hidden text-[11px] opacity-75 sm:inline">
          {sweeping ? "probing…" : lastSweepAt ? `swept ${formatRelative(lastSweepAt)}` : "—"}
        </span>
      </button>
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme, mounted } = useTheme();
  if (!mounted) {
    return <div className="h-8 w-8 rounded-[2px] border border-hairline bg-surface" />;
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="btn-ghost !h-8 !w-8 !p-0"
      title={theme === "dark" ? "Switch to Daylight Gallery" : "Switch to Evening Vault"}
      aria-label="Toggle theme mode"
    >
      {theme === "dark" ? <Sun size={14} className="text-ochre" /> : <Moon size={14} className="text-body" />}
    </button>
  );
}

function RailNav() {
  const pathname = usePathname();
  const { indicatorTransition } = useMotionPreset();
  const { fleet } = useTelemetry();

  return (
    <aside className="sticky top-[var(--topbar-h)] hidden h-[calc(100dvh-var(--topbar-h))] w-[var(--rail-w)] shrink-0 flex-col border-r border-hairline bg-canvas lg:flex">
      <LayoutGroup id="rail">
        <nav aria-label="Primary" className="flex flex-col gap-1 px-3 pt-6">
          <p className="label mb-2 px-3">Exhibition Rooms</p>
          {NAV.map(({ href, room, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-9 items-center gap-2.5 rounded-[2px] px-3 text-[13px] transition-colors duration-150",
                  active ? "bg-surface text-ink font-medium shadow-sm border border-hairline" : "text-body hover:bg-surface/50 hover:text-ink",
                )}
              >
                {active && (
                  <motion.span
                    layoutId={NAV_INDICATOR_ID}
                    transition={indicatorTransition}
                    className="absolute inset-y-1 left-0 w-[2.5px] rounded-r-[1px] bg-vermilion"
                  />
                )}
                <span className="font-mono text-[10px] text-silver">{room}</span>
                <Icon size={15} strokeWidth={1.5} className={active ? "text-vermilion" : "text-silver"} />
                <span>{label}</span>
                {href === "/incidents" && fleet.DOWN > 0 && (
                  <span className="num ml-auto rounded-[2px] bg-vermilion px-1.5 py-0.2 text-[11px] font-semibold text-white">
                    {fleet.DOWN}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </LayoutGroup>

      <div className="mt-auto border-t border-hairline p-5">
        <p className="label mb-3">Telemetry Ledger</p>
        <dl className="tabular-nums grid grid-cols-2 gap-y-1.5 text-[12px]">
          <dt className="text-silver">Operational</dt>
          <dd className="text-right font-medium text-viridian">{fleet.OPERATIONAL}</dd>
          <dt className="text-silver">Degraded</dt>
          <dd className="text-right font-medium text-ochre">{fleet.DEGRADED}</dd>
          <dt className="text-silver">Outage</dt>
          <dd className="text-right font-medium text-vermilion">{fleet.DOWN}</dd>
          <dt className="text-silver">Paused</dt>
          <dd className="text-right font-medium text-silver">{fleet.PAUSED}</dd>
        </dl>
        <Link
          href="/status/vigil"
          className="mt-4 flex items-center justify-between rounded-[2px] border border-hairline bg-surface p-2 text-[12px] text-body transition-colors hover:border-hairline-strong hover:text-ink"
        >
          <span>Public Exhibition</span>
          <ArrowUpRight size={13} strokeWidth={1.5} />
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
        {NAV.map(({ href, room, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn("relative flex h-11 shrink-0 items-center gap-2 px-4 text-[13px]", active ? "font-medium text-ink" : "text-body")}
            >
              <span className="font-mono text-[10px] text-silver">{room}</span>
              <Icon size={14} strokeWidth={1.5} className={active ? "text-vermilion" : "text-silver"} />
              <span>{label}</span>
              {active && (
                <motion.span
                  layoutId={NAV_INDICATOR_ID}
                  transition={indicatorTransition}
                  className="absolute inset-x-2 -bottom-px h-[2px] bg-vermilion"
                />
              )}
            </Link>
          );
        })}
      </nav>
    </LayoutGroup>
  );
}

/** Architectural top exhibition header + left rail + simulator dock + command palette. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [operatorModalOpen, setOperatorModalOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <TelemetryProvider>
      <a href="#main" className="sr-only z-[60] bg-vermilion px-3 py-2 text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>

      <header className="sticky top-0 z-30 h-[var(--topbar-h)] border-b border-hairline bg-canvas/90 backdrop-blur-md">
        <div className="flex h-full items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Wordmark />
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            <StatusStrip />

            {/* Command Palette Trigger */}
            <button
              type="button"
              onClick={() => setCommandOpen(true)}
              className="btn-ghost hidden !h-8 !px-2.5 text-[12px] sm:inline-flex"
              title="Open Command Palette (⌘K)"
            >
              <Command size={13} className="text-silver" />
              <span className="text-body">Search</span>
              <kbd className="ml-1 rounded-[2px] border border-hairline bg-well px-1 text-[10px] text-silver">⌘K</kbd>
            </button>

            {/* Operator Key Unlock */}
            <button
              type="button"
              onClick={() => setOperatorModalOpen(true)}
              className="btn-ghost !h-8 !w-8 !p-0"
              title="Unlock Operator Controls"
              aria-label="Unlock Operator Controls"
            >
              <KeyRound size={14} className="text-body" />
            </button>

            {/* Theme Toggle */}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <MobileNav />

      <div className="flex">
        <RailNav />
        <main id="main" className="min-w-0 flex-1 px-4 py-8 sm:px-8 xl:px-12">
          {children}
        </main>
      </div>

      <SimulatorDock />
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />
      <OperatorUnlockModal open={operatorModalOpen} onClose={() => setOperatorModalOpen(false)} />
    </TelemetryProvider>
  );
}
