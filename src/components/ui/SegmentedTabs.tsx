"use client";

import { LayoutGroup, motion } from "framer-motion";
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { NAV_INDICATOR_ID, useMotionPreset } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  count?: number | null;
}

interface SegmentedTabsProps<T extends string> {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: "sm" | "md";
  mono?: boolean;
  className?: string;
}

/**
 * Tab row with a 2px copper underline that glides between options via a shared
 * `layoutId`. Each instance gets its own LayoutGroup so separate tab rows never
 * steal each other's indicator. Arrow keys move selection (roving tabindex).
 */
export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  size = "md",
  mono = false,
  className,
}: SegmentedTabsProps<T>) {
  const group = useId();
  const { indicatorTransition } = useMotionPreset();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (index + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    refs.current[next]?.focus();
    onChange(items[next]!.value);
  };

  return (
    <LayoutGroup id={group}>
      <div role="tablist" aria-label={ariaLabel} className={cn("relative flex items-stretch border-b border-hairline", className)}>
        {items.map((item, i) => {
          const active = item.value === value;
          return (
            <button
              key={item.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              role="tab"
              type="button"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(item.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                "relative flex items-center gap-2 transition-colors duration-200 ease-classic focus-visible:outline-offset-[-2px]",
                size === "sm" ? "h-8 px-2.5 text-[12px]" : "h-10 px-3.5 text-[13px]",
                mono ? "num tracking-wide" : "font-medium",
                active ? "text-ink" : "text-silver hover:text-body",
              )}
            >
              {item.label}
              {item.count != null && (
                <span className={cn("num text-[12px]", active ? "text-body" : "text-silver/70")}>{item.count}</span>
              )}
              {active && (
                <motion.span
                  layoutId={NAV_INDICATOR_ID}
                  transition={indicatorTransition}
                  className="absolute inset-x-2 -bottom-px h-[2px] bg-copper"
                />
              )}
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
