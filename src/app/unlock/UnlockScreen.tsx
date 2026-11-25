"use client";

import { OperatorUnlockModal } from "@/components/auth/OperatorUnlockModal";

export function UnlockScreen({ next }: { next: string }) {
  // Full navigation so the server re-renders the console with the new cookie.
  return <main className="min-h-dvh bg-canvas"><OperatorUnlockModal open standalone onClose={() => {}} onSuccess={() => window.location.assign(next)} /></main>;
}
