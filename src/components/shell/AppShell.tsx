"use client";

import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { Activity, ArrowUpRight, Command, Gauge, KeyRound, Menu, Moon, Plus, Sun, TriangleAlert, Webhook, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { OperatorUnlockModal } from "@/components/auth/OperatorUnlockModal";
import { TelemetryProvider, useTelemetry, type SystemState } from "@/components/providers/TelemetryProvider";
import { useTheme } from "@/components/providers/ThemeProvider";
import { HeartbeatRipple, type Tone } from "@/components/ui/HeartbeatRipple";
import { OPERATOR_REQUIRED_EVENT } from "@/lib/client/api";
import { EASE_ATELIER, NAV_INDICATOR_ID, useMotionPreset } from "@/lib/motion";
import { cn, formatRelative } from "@/lib/utils";
import { CommandPalette } from "./CommandPalette";
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

/** Breadcrumb trail for the header, derived from the route. */
function crumbsFor(pathname: string): { label: string; href?: string }[] {
  const section = NAV.find((n) => n.href !== "/" && isActive(pathname, n.href));
  if (!section) return [{ label: "Overview" }];
  if (pathname === section.href) return [{ label: section.label }];
  return [{ label: section.label, href: section.href }, { label: "Detail" }];
}

/** One primary action per workspace; pages open their create drawer when `?new=1` is present. */
function ctaFor(pathname: string): { label: string; href: string } {
  if (isActive(pathname, "/webhooks")) return { label: "New endpoint", href: "/webhooks?new=1" };
  return { label: "New monitor", href: "/monitors?new=1" };
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
    <Link href="/" className="flex items-center gap-2.5" aria-label="Vigil — overview">
      <span className="grid h-7 w-7 place-items-center rounded-md border border-hairline-strong bg-surface">
        <span className="h-1.5 w-1.5 rounded-full bg-brass" />
      </span>
      <span className="font-display text-[22px] leading-none text-ink">Vigil</span>
    </Link>
  );
}

/** System health + live-probing toggle, in one quiet pill. */
function HealthPill() {
  const { systemState, globalBeat, lastSweepAt, live, setLive, fleet, sweeping } = useTelemetry();
  useTicker(5_000);
  const copy = SYSTEM_COPY[systemState];
  const active = Math.max(0, fleet.total - fleet.PAUSED);

  return (
    <div className="hidden h-8 items-center rounded-md border border-hairline bg-surface md:flex" aria-live="polite">
      <span className="flex items-center gap-2 px-3">
        <HeartbeatRipple beat={globalBeat} tone={copy.tone} size={7} />
        <span className="text-[12px] font-medium text-ink">{copy.label}</span>
        {fleet.total > 0 && (
          <span className="num text-[11px] text-silver">
            {fleet.OPERATIONAL}/{active}
          </span>
        )}
      </span>
      <span className="h-4 w-px bg-hairline" aria-hidden />
      <button
        type="button"
        onClick={() => setLive(!live)}
        aria-pressed={live}
        className="flex h-full items-center gap-1.5 rounded-r-md px-2.5 text-[12px] text-body transition-colors hover:bg-well hover:text-ink"
        title={live ? "Live probing on. Click to pause" : "Live probing paused. Click to resume"}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", live ? "bg-brass" : "bg-silver/50")} />
        {live ? "Live" : "Paused"}
        <span className="num hidden text-[11px] text-silver lg:inline">
          {sweeping ? "probing…" : lastSweepAt ? formatRelative(lastSweepAt) : ""}
        </span>
      </button>
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme, mounted } = useTheme();
  if (!mounted) return <span className="h-8 w-8 rounded-md border border-hairline bg-surface" aria-hidden />;
  const next = theme === "dark" ? "Atelier Ivory" : "Nocturne Obsidian";
  return (
    <button type="button" onClick={toggleTheme} className="btn-ghost !h-8 !w-8 !p-0" title={`Switch to ${next}`} aria-label={`Switch to ${next} theme`}>
      {theme === "dark" ? <Sun size={15} strokeWidth={1.75} className="text-body" /> : <Moon size={15} strokeWidth={1.75} className="text-body" />}
    </button>
  );
}

/** Navigation list + footer links. Rendered in the desktop rail and the mobile drawer. */
function NavContent({ layoutGroup, onNavigate, onOpenPalette, onUnlock }: { layoutGroup: string; onNavigate?: () => void; onOpenPalette: () => void; onUnlock: () => void }) {
  const pathname = usePathname();
  const { indicatorTransition } = useMotionPreset();
  const { fleet } = useTelemetry();

  return (
    <div className="flex h-full flex-col">
      <LayoutGroup id={layoutGroup}>
        <nav aria-label="Primary" className="flex flex-col gap-0.5 px-3 pt-4">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-9 items-center gap-2.5 rounded-md px-3 text-[13px] transition-colors duration-150",
                  active ? "bg-surface font-medium text-ink" : "text-body hover:bg-surface/70 hover:text-ink",
                )}
              >
                {active && (
                  <motion.span layoutId={NAV_INDICATOR_ID} transition={indicatorTransition} className="absolute inset-y-2 left-0 w-[2px] rounded-full bg-brass" />
                )}
                <Icon size={16} strokeWidth={1.75} className={active ? "text-brass" : "text-silver"} />
                <span>{label}</span>
                {href === "/incidents" && fleet.DOWN > 0 && (
                  <span className="num ml-auto rounded-sm bg-crit/10 px-1.5 text-[11px] font-medium text-crit">{fleet.DOWN}</span>
                )}
              </Link>
            );
          })}
        </nav>
      </LayoutGroup>

      <div className="mt-auto flex flex-col gap-0.5 border-t border-hairline px-3 py-3">
        <Link href="/status/vigil" onClick={onNavigate} className="flex h-9 items-center justify-between rounded-md px-3 text-[13px] text-body transition-colors hover:bg-surface/70 hover:text-ink">
          Public status page
          <ArrowUpRight size={14} strokeWidth={1.75} className="text-silver" />
        </Link>
        <button type="button" onClick={onOpenPalette} className="flex h-9 items-center justify-between rounded-md px-3 text-left text-[13px] text-body transition-colors hover:bg-surface/70 hover:text-ink">
          Keyboard shortcuts
          <kbd className="num rounded-sm border border-hairline bg-well px-1.5 text-[11px] text-silver">⌘K</kbd>
        </button>
        <button type="button" onClick={onUnlock} className="flex h-9 items-center justify-between rounded-md px-3 text-left text-[13px] text-body transition-colors hover:bg-surface/70 hover:text-ink">
          Operator session
          <KeyRound size={14} strokeWidth={1.75} className="text-silver" />
        </button>
      </div>
    </div>
  );
}

/** Calm shell: full-height rail, slim breadcrumb header, demo controls, palette and unlock modal. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { reduce } = useMotionPreset();
  const [unlock, setUnlock] = useState<{ open: boolean; reason: "required" | "manual" }>({ open: false, reason: "manual" });
  const [commandOpen, setCommandOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const openPalette = useCallback(() => {
    setDrawerOpen(false);
    setCommandOpen(true);
  }, []);
  const openUnlock = useCallback(() => {
    setDrawerOpen(false);
    setUnlock({ open: true, reason: "manual" });
  }, []);
  const closeUnlock = useCallback(() => setUnlock((u) => ({ ...u, open: false })), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen((prev) => !prev);
      }
      if (e.key === "Escape") setDrawerOpen(false);
    };
    const onOperatorRequired = () => setUnlock({ open: true, reason: "required" });
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPERATOR_REQUIRED_EVENT, onOperatorRequired);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPERATOR_REQUIRED_EVENT, onOperatorRequired);
    };
  }, []);

  useEffect(() => setDrawerOpen(false), [pathname]);

  const crumbs = crumbsFor(pathname);
  const cta = ctaFor(pathname);

  return (
    <TelemetryProvider>
      <a href="#main" className="sr-only z-[60] rounded-md bg-ink px-3 py-2 text-canvas focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>

      <div className="flex min-h-dvh">
        {/* Desktop rail */}
        <aside className="sticky top-0 hidden h-dvh w-[var(--rail-w)] shrink-0 flex-col border-r border-hairline bg-canvas lg:flex">
          <div className="flex h-[var(--topbar-h)] shrink-0 items-center border-b border-hairline px-5">
            <Wordmark />
          </div>
          <NavContent layoutGroup="rail" onOpenPalette={openPalette} onUnlock={openUnlock} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 h-[var(--topbar-h)] shrink-0 border-b border-hairline bg-canvas">
            <div className="flex h-full items-center justify-between gap-3 px-4 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <button type="button" onClick={() => setDrawerOpen(true)} className="btn-ghost !h-8 !w-8 !p-0 lg:hidden" aria-label="Open navigation" aria-expanded={drawerOpen}>
                  <Menu size={16} strokeWidth={1.75} />
                </button>
                <span className="lg:hidden">
                  <Wordmark />
                </span>
                <nav aria-label="Breadcrumb" className="hidden min-w-0 lg:block">
                  <ol className="flex items-center gap-2 text-[13px]">
                    {crumbs.map((c, i) => (
                      <li key={c.label} className="flex min-w-0 items-center gap-2">
                        {i > 0 && <span className="text-silver" aria-hidden>/</span>}
                        {c.href ? (
                          <Link href={c.href} className="text-body transition-colors hover:text-ink">
                            {c.label}
                          </Link>
                        ) : (
                          <span className="truncate font-medium text-ink" aria-current="page">
                            {c.label}
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                </nav>
              </div>

              <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
                <HealthPill />
                <button type="button" onClick={() => setCommandOpen(true)} className="btn-ghost hidden !h-8 !px-2.5 text-[12px] sm:inline-flex" aria-label="Open quick jump">
                  <Command size={14} strokeWidth={1.75} className="text-silver" />
                  <span className="text-body">Jump to</span>
                  <kbd className="num rounded-sm border border-hairline bg-well px-1 text-[11px] text-silver">⌘K</kbd>
                </button>
                <ThemeToggle />
                <Link href={cta.href} className="btn-primary !h-8 !px-3">
                  <Plus size={14} strokeWidth={2} />
                  <span className="hidden sm:inline">{cta.label}</span>
                  <span className="sr-only sm:hidden">{cta.label}</span>
                </Link>
              </div>
            </div>
          </header>

          <main id="main" className="min-w-0 flex-1 px-4 py-8 sm:px-8 xl:px-12">
            {children}
          </main>
        </div>
      </div>

      {/* Mobile navigation drawer */}
      <AnimatePresence>
        {drawerOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDrawerOpen(false)} className="absolute inset-0 bg-[var(--backdrop)]" aria-hidden />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              initial={reduce ? { opacity: 0 } : { x: "-100%" }}
              animate={reduce ? { opacity: 1 } : { x: 0 }}
              exit={reduce ? { opacity: 0 } : { x: "-100%" }}
              transition={{ duration: 0.35, ease: EASE_ATELIER }}
              className="absolute inset-y-0 left-0 flex w-[min(280px,85vw)] flex-col border-r border-hairline bg-canvas"
            >
              <div className="flex h-[var(--topbar-h)] shrink-0 items-center justify-between border-b border-hairline px-4">
                <Wordmark />
                <button type="button" onClick={() => setDrawerOpen(false)} className="btn-subtle !h-8 !w-8 !p-0" aria-label="Close navigation">
                  <X size={16} strokeWidth={1.75} />
                </button>
              </div>
              <NavContent layoutGroup="mobile-rail" onNavigate={() => setDrawerOpen(false)} onOpenPalette={openPalette} onUnlock={openUnlock} />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      <SimulatorDock />
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />
      <OperatorUnlockModal open={unlock.open} reason={unlock.reason} onClose={closeUnlock} />
    </TelemetryProvider>
  );
}
