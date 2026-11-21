// Note: intentionally no "use client" — constants here are importable from server
// components too. `useMotionPreset` is a hook and must only be called in client components.
import { useReducedMotion, type Transition, type Variants } from "framer-motion";
import { useMemo } from "react";

/**
 * Vigil motion language — weighted, deliberate, architectural.
 * Like a calibrated dial settling into place: no bounce, no overshoot gimmicks.
 */

/** Signature editorial easing. */
export const EASE_CLASSIC = [0.22, 1, 0.36, 1] as const;

/** Subtle, well-damped spring for layout glides (nav indicator, drawers). */
export const SPRING_SUBTLE = { type: "spring", stiffness: 320, damping: 32, mass: 0.9 } as const satisfies Transition;

export const DURATION = {
  instant: 0.12,
  quick: 0.2,
  base: 0.35,
  rule: 0.65,
  settle: 1.2,
} as const;

export const STAGGER = 0.06;

export const transitionClassic = (duration: number = DURATION.base, delay = 0): Transition => ({
  duration,
  delay,
  ease: EASE_CLASSIC,
});

// ─── 1. Architectural rule unfurl ─────────────────────────────────────────────

export const ruleUnfurl: Variants = {
  hidden: { scaleX: 0, originX: 0 },
  visible: (delay: number = 0) => ({
    scaleX: 1,
    originX: 0,
    transition: transitionClassic(DURATION.rule, delay),
  }),
};

/** Container that staggers editorial children after the rules have drawn. */
export const staggerContainer = (delayChildren = 0.35, stagger = STAGGER): Variants => ({
  hidden: {},
  visible: { transition: { delayChildren, staggerChildren: stagger } },
});

export const titleReveal: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: transitionClassic(0.55) },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: transitionClassic(DURATION.base) },
};

// ─── 2. Tabular number morph ──────────────────────────────────────────────────

export const digitRoll: Variants = {
  enter: (direction: 1 | -1) => ({ y: direction * 8, opacity: 0 }),
  center: { y: 0, opacity: 1, transition: transitionClassic(0.42) },
  exit: (direction: 1 | -1) => ({ y: direction * -8, opacity: 0, transition: transitionClassic(0.28) }),
};

// ─── 3. Gliding copper indicator ──────────────────────────────────────────────

export const NAV_INDICATOR_ID = "active-nav-indicator";
export const indicatorTransition: Transition = transitionClassic(0.35);

// ─── 4. Heartbeat ripple ──────────────────────────────────────────────────────

export const heartbeatRipple: Variants = {
  initial: { scale: 1, opacity: 0.55 },
  animate: { scale: 2.2, opacity: 0, transition: { duration: 1.4, ease: EASE_CLASSIC } },
};

// ─── 5. Live feed entry ───────────────────────────────────────────────────────

export const feedItem: Variants = {
  initial: { opacity: 0, y: -8, borderLeftColor: "rgb(232 116 59 / 1)" },
  animate: {
    opacity: 1,
    y: 0,
    borderLeftColor: ["rgb(232 116 59 / 1)", "rgb(232 116 59 / 1)", "rgb(143 163 199 / 0.16)"],
    transition: {
      opacity: transitionClassic(0.35),
      y: transitionClassic(0.45),
      borderLeftColor: { duration: DURATION.settle, times: [0, 0.35, 1], ease: EASE_CLASSIC },
    },
  },
  exit: { opacity: 0, transition: transitionClassic(0.2) },
};

// ─── 6. Slide-over drawers ────────────────────────────────────────────────────

export const drawerPanel: Variants = {
  hidden: { x: "100%" },
  visible: { x: 0, transition: transitionClassic(0.5) },
  exit: { x: "100%", transition: transitionClassic(0.36) },
};

export const backdrop: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: transitionClassic(0.35) },
  exit: { opacity: 0, transition: transitionClassic(0.3) },
};

// ─── 7. Chart / bar hover ─────────────────────────────────────────────────────

export const barLift = { y: -2, transition: transitionClassic(DURATION.quick) } as const;
export const cardLift = { y: -2.5, transition: transitionClassic(DURATION.quick) } as const;

// ─── Reduced-motion aware access ──────────────────────────────────────────────

const STILL: Variants = {
  hidden: { opacity: 1 },
  visible: { opacity: 1 },
  initial: { opacity: 1 },
  animate: { opacity: 1 },
  exit: { opacity: 0, transition: { duration: 0.01 } },
  enter: { opacity: 1 },
  center: { opacity: 1 },
};

/**
 * Returns the motion presets, collapsed to static equivalents when the user
 * has requested reduced motion. Layout glides become instant.
 */
export function useMotionPreset() {
  const reduce = useReducedMotion() ?? false;
  return useMemo(
    () => ({
      reduce,
      ruleUnfurl: reduce ? STILL : ruleUnfurl,
      titleReveal: reduce ? STILL : titleReveal,
      staggerContainer: (delayChildren?: number, stagger?: number) =>
        reduce ? STILL : staggerContainer(delayChildren, stagger),
      fadeIn: reduce ? STILL : fadeIn,
      digitRoll: reduce ? STILL : digitRoll,
      heartbeatRipple: reduce ? STILL : heartbeatRipple,
      feedItem: reduce ? STILL : feedItem,
      drawerPanel: reduce ? STILL : drawerPanel,
      backdrop,
      indicatorTransition: reduce ? ({ duration: 0 } as Transition) : indicatorTransition,
      barLift: reduce ? {} : barLift,
      cardLift: reduce ? {} : cardLift,
    }),
    [reduce],
  );
}
