"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  Flame,
  Gauge,
  Moon,
  Radar,
  Search,
  Sun,
  TriangleAlert,
  Webhook,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useTelemetry } from "@/components/providers/TelemetryProvider";
import { useTheme } from "@/components/providers/ThemeProvider";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const { toggleTheme, theme } = useTheme();
  const { runFullSweep } = useTelemetry();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const actions = useMemo(
    () => [
      {
        id: "nav-overview",
        label: "Go to Overview",
        category: "Navigation",
        icon: Gauge,
        run: () => router.push("/"),
      },
      {
        id: "nav-monitors",
        label: "Go to Monitors Registry",
        category: "Navigation",
        icon: Activity,
        run: () => router.push("/monitors"),
      },
      {
        id: "nav-webhooks",
        label: "Go to Webhook Atelier",
        category: "Navigation",
        icon: Webhook,
        run: () => router.push("/webhooks"),
      },
      {
        id: "nav-incidents",
        label: "Go to Incidents Log",
        category: "Navigation",
        icon: TriangleAlert,
        run: () => router.push("/incidents"),
      },
      {
        id: "nav-status",
        label: "Open Public Status Page",
        category: "Navigation",
        icon: ArrowRight,
        run: () => router.push("/status/vigil"),
      },
      {
        id: "action-sweep",
        label: "Trigger Global Probe Sweep",
        category: "Actions",
        icon: Radar,
        run: async () => {
          await runFullSweep().catch(() => {});
        },
      },
      {
        id: "action-theme",
        label: `Switch to ${theme === "light" ? "Evening Vault (Dark)" : "Daylight Gallery (Light)"}`,
        category: "Appearance",
        icon: theme === "light" ? Moon : Sun,
        run: () => toggleTheme(),
      },
    ],
    [router, theme, toggleTheme, runFullSweep],
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return actions;
    const q = query.toLowerCase();
    return actions.filter(
      (a) => a.label.toLowerCase().includes(q) || a.category.toLowerCase().includes(q),
    );
  }, [actions, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % Math.max(1, filtered.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + filtered.length) % Math.max(1, filtered.length));
      } else if (e.key === "Enter" && filtered[selectedIndex]) {
        e.preventDefault();
        filtered[selectedIndex]!.run();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose, filtered, selectedIndex]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            className="fixed inset-0 bg-ink/40 backdrop-blur-sm"
          />

          {/* Palette Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -6 }}
            transition={{ duration: 0.2, ease: [0.19, 1, 0.22, 1] }}
            className="relative z-10 w-full max-w-[560px] overflow-hidden rounded-[2px] border border-hairline-strong bg-surface shadow-2xl"
          >
            {/* Search Input Bar */}
            <div className="flex items-center gap-3 border-b border-hairline px-4 py-3">
              <Search size={16} className="text-body shrink-0" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type a command or jump to page..."
                autoFocus
                className="w-full bg-transparent text-[14px] text-ink placeholder:text-silver focus:outline-none"
              />
              <button
                type="button"
                onClick={onClose}
                className="rounded p-1 text-silver hover:bg-well hover:text-ink"
              >
                <X size={15} />
              </button>
            </div>

            {/* Results List */}
            <div className="max-h-[320px] overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <div className="py-8 text-center text-[13px] text-silver">
                  No matching commands found.
                </div>
              ) : (
                filtered.map((item, index) => {
                  const isSelected = index === selectedIndex;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        item.run();
                        onClose();
                      }}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-[2px] text-left transition-colors text-[13px] ${
                        isSelected ? "bg-well text-ink font-medium" : "text-body hover:text-ink"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Icon size={15} className={isSelected ? "text-vermilion" : "text-silver"} />
                        <span>{item.label}</span>
                      </div>
                      <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-silver">
                        {item.category}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {/* Bottom Keyboard Hint Bar */}
            <div className="flex items-center justify-between border-t border-hairline bg-canvas px-4 py-2 text-[11px] text-silver font-sans">
              <span>Use ↑ ↓ to navigate, Enter to select</span>
              <kbd className="font-mono text-[10px] px-1.5 py-0.5 border border-hairline bg-surface rounded">
                ESC to close
              </kbd>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
