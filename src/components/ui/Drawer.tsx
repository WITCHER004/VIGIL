"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMotionPreset } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  width?: "md" | "lg" | "xl";
  footer?: ReactNode;
  children: ReactNode;
}

const WIDTHS = { md: "sm:max-w-[520px]", lg: "sm:max-w-[680px]", xl: "sm:max-w-[860px]" };
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Right-hand slide-over. Hairline-framed panel over a dimmed backdrop
 * (rgba(7,11,22,0.72)); Esc and backdrop click dismiss; focus is moved into
 * the panel, trapped with Tab, and restored to the trigger on close.
 */
export function Drawer({ open, onClose, title, eyebrow, description, width = "md", footer, children }: DrawerProps) {
  const { drawerPanel, backdrop } = useMotionPreset();
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panelRef.current)?.focus();
    }, 60);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      restoreRef.current?.focus?.();
    };
  }, [open]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50" key="drawer">
          <motion.div
            className="absolute inset-0 bg-[var(--backdrop)]"
            variants={backdrop}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            variants={drawerPanel}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={cn(
              "absolute inset-y-0 right-0 flex w-full flex-col border-l border-hairline bg-surface shadow-placard focus:outline-none",
              WIDTHS[width],
            )}
          >
            <header className="relative shrink-0 border-b border-hairline px-6 pb-5 pt-6">
              {eyebrow && <p className="label mb-2">{eyebrow}</p>}
              <h2 id={titleId} className="pr-10 text-[28px] leading-tight">
                {title}
              </h2>
              {description && <p className="mt-2 text-[13px] text-body">{description}</p>}
              <button
                type="button"
                onClick={onClose}
                className="absolute right-4 top-5 grid h-8 w-8 place-items-center rounded-sm border border-transparent text-silver transition-colors hover:border-hairline hover:bg-raised hover:text-ink"
                aria-label="Close"
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">{children}</div>
            {footer && <footer className="shrink-0 border-t border-hairline bg-surface px-6 py-4">{footer}</footer>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
