import { useReducedMotion, type Transition, type Variants } from "framer-motion";
import { useMemo } from "react";

/**
 * Vigil Kinetic Gallery Motion System
 * Combining Alexander Calder kinetic balance with Swiss typographic precision.
 * Respects prefers-reduced-motion everywhere.
 */

export const EASE_GALLERY = [0.19, 1, 0.22, 1] as const;
export const EASE_CLASSIC = [0.22, 1, 0.36, 1] as const;

export const SPRING_MOBILE = {
  type: "spring",
  stiffness: 260,
  damping: 28,
  mass: 0.9,
} as const satisfies Transition;

export const SPRING_SUBTLE = {
  type: "spring",
  stiffness: 320,
  damping: 32,
  mass: 0.9,
} as const satisfies Transition;

export const DURATION = {
  instant: 0.12,
  quick: 0.2,
  base: 0.35,
  rule: 0.55,
  settle: 1.0,
} as const;

export const STAGGER = 0.05;

export const transitionGallery = (duration: number = DURATION.base, delay = 0): Transition => ({
  duration,
  delay,
  ease: EASE_GALLERY,
});

export const transitionClassic = (duration: number = DURATION.base, delay = 0): Transition => ({
  duration,
  delay,
  ease: EASE_CLASSIC,
});

// ─── 1. Architectural Grid Drawing ──────────────────────────────────────────

export const ruleUnfurl: Variants = {
  hidden: { scaleX: 0, originX: 0 },
  visible: (delay: number = 0) => ({
    scaleX: 1,
    originX: 0,
    transition: transitionGallery(DURATION.rule, delay),
  }),
};

export const verticalRuleUnfurl: Variants = {
  hidden: { scaleY: 0, originY: 0 },
  visible: (delay: number = 0) => ({
    scaleY: 1,
    originY: 0,
    transition: transitionGallery(DURATION.rule, delay),
  }),
};

// ─── 2. Masked Editorial Title Reveal ────────────────────────────────────────

export const maskedTitleReveal: Variants = {
  hidden: { y: "100%", opacity: 0 },
  visible: {
    y: "0%",
    opacity: 1,
    transition: transitionGallery(0.55),
  },
};

export const titleReveal: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: transitionGallery(DURATION.base) },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: transitionGallery(DURATION.base) },
};

// ─── 3. Staggered Gallery Placards ──────────────────────────────────────────

export const staggerContainer = (delayChildren = 0.1, stagger = STAGGER): Variants => ({
  hidden: {},
  visible: { transition: { delayChildren, staggerChildren: stagger } },
});

export const placardItem: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: transitionGallery(0.3) },
};

// ─── 4. Live Feed Edge Flash ────────────────────────────────────────────────

export const feedFlash: Variants = {
  initial: { opacity: 0, x: -6 },
  animate: { opacity: 1, x: 0, transition: transitionGallery(0.25) },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

// ─── 5. Tactile Drawer & Modal ──────────────────────────────────────────────

export const drawerSlide: Variants = {
  hidden: { x: "100%" },
  visible: { x: 0, transition: transitionGallery(0.4) },
  exit: { x: "100%", transition: { duration: 0.25, ease: EASE_GALLERY } },
};

// ─── 6. Micro-Tactility ─────────────────────────────────────────────────────

export const microTap = { scale: 0.985 };

export const NAV_INDICATOR_ID = "gallery-nav-indicator";
export const TAB_INDICATOR_ID = "gallery-tab-indicator";

/**
 * Hook providing motion presets with automatic reduced-motion fallback.
 */
export function useMotionPreset() {
  const reduce = useReducedMotion();

  return useMemo(() => {
    if (reduce) {
      return {
        reduce: true,
        indicatorTransition: { duration: 0 },
        ruleVariants: { hidden: { opacity: 1 }, visible: { opacity: 1 } },
        ruleUnfurl: { hidden: { opacity: 1 }, visible: { opacity: 1 } },
        titleReveal: { hidden: { opacity: 1 }, visible: { opacity: 1 } },
        fadeIn: { hidden: { opacity: 1 }, visible: { opacity: 1 } },
        backdrop: { hidden: { opacity: 1 }, visible: { opacity: 1 } },
        drawerPanel: { hidden: { opacity: 1 }, visible: { opacity: 1 } },
        feedItem: { initial: { opacity: 1 }, animate: { opacity: 1 }, exit: { opacity: 1 } },
        digitRoll: { hidden: { opacity: 1 }, visible: { opacity: 1 } },
        stagger: { hidden: {}, visible: {} },
        staggerContainer: (_delay = 0, _stagger = 0) => ({ hidden: {}, visible: {} }),
        cardLift: undefined,
        barLift: undefined,
        microTap: undefined,
        transition: { duration: 0 },
      };
    }

    return {
      reduce: false,
      indicatorTransition: SPRING_MOBILE,
      ruleVariants: ruleUnfurl,
      ruleUnfurl,
      titleReveal,
      fadeIn,
      backdrop: fadeIn,
      drawerPanel: drawerSlide,
      feedItem: feedFlash,
      digitRoll: { hidden: { opacity: 0, y: 4 }, visible: { opacity: 1, y: 0, transition: transitionGallery(0.2) } },
      stagger: staggerContainer(),
      staggerContainer,
      cardLift: { y: -2 },
      barLift: { y: -3 },
      microTap,
      transition: transitionGallery(),
    };
  }, [reduce]);
}
