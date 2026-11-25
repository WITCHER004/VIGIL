"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { useMotionPreset } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** A 1px hairline that draws left → right on mount. */
export function Rule({ delay = 0, className }: { delay?: number; className?: string }) {
  const { ruleUnfurl } = useMotionPreset();
  return (
    <motion.div
      aria-hidden
      variants={ruleUnfurl}
      custom={delay}
      initial="hidden"
      animate="visible"
      className={cn("h-px w-full origin-left bg-rule", className)}
    />
  );
}

interface PageHeaderProps {
  eyebrow: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}

/**
 * Editorial page entrance: the hairlines draw across, then eyebrow, title,
 * description and actions settle in with a short stagger.
 */
export function PageHeader({ eyebrow, title, description, actions, meta, className }: PageHeaderProps) {
  const { titleReveal, staggerContainer } = useMotionPreset();
  return (
    <header className={cn("pt-2", className)}>
      <Rule />
      <motion.div
        variants={staggerContainer(0.32)}
        initial="hidden"
        animate="visible"
        className="flex flex-col gap-6 py-7 lg:flex-row lg:items-end lg:justify-between"
      >
        <div className="max-w-3xl">
          <motion.p variants={titleReveal} className="label">
            {eyebrow}
          </motion.p>
          <motion.h1 variants={titleReveal} className="mt-3 text-[32px] leading-[1.1] sm:text-[40px]">
            {title}
          </motion.h1>
          {description && (
            <motion.p variants={titleReveal} className="mt-3 max-w-2xl text-[15px] leading-relaxed text-body">
              {description}
            </motion.p>
          )}
          {meta && (
            <motion.div variants={titleReveal} className="mt-4">
              {meta}
            </motion.div>
          )}
        </div>
        {actions && (
          <motion.div variants={titleReveal} className="flex shrink-0 flex-wrap items-center gap-2.5">
            {actions}
          </motion.div>
        )}
      </motion.div>
      <Rule delay={0.12} />
    </header>
  );
}

/** Section heading: serif title with an optional muted caption beneath, and a trailing slot. */
export function SectionHeading({ label, title, trailing, className }: { label?: string; title: ReactNode; trailing?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div>
        <h2 className="text-[22px] leading-tight">{title}</h2>
        {label && <p className="mt-1 text-[13px] text-silver">{label}</p>}
      </div>
      {trailing}
    </div>
  );
}
