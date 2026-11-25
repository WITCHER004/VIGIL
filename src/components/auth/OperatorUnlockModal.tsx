"use client";

import { AnimatePresence, motion } from "framer-motion";
import { KeyRound, Lock, X } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client/api";
import { EASE_ATELIER } from "@/lib/motion";

interface OperatorUnlockModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  /** "required" = opened because an action returned 401; "manual" = opened from the header. */
  reason?: "required" | "manual";
  /** Full-page sign-in (/unlock): cannot be dismissed. */
  standalone?: boolean;
}

export function OperatorUnlockModal({ open, onClose, onSuccess, reason = "manual", standalone = false }: OperatorUnlockModalProps) {
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (standalone) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, standalone]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secret.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await apiFetch("/api/auth/operator", { method: "POST", json: { secret } });
      setSecret("");
      onSuccess?.();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid operator secret.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={standalone ? undefined : onClose}
            className="fixed inset-0 bg-[var(--backdrop)]"
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="operator-unlock-title"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.25, ease: EASE_ATELIER }}
            className="relative z-10 w-full max-w-[420px] rounded-md border border-hairline-strong bg-surface p-6 shadow-placard"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="grid h-8 w-8 place-items-center rounded-md border border-brass/30 bg-brass/10">
                  <Lock size={15} strokeWidth={1.75} className="text-brass" />
                </div>
                <div>
                  <p className="label">Operator session</p>
                  <h3 id="operator-unlock-title" className="text-[20px] leading-tight">
                    {standalone ? "Sign in to Vigil" : "Unlock operator controls"}
                  </h3>
                </div>
              </div>
              {!standalone && (
                <button type="button" onClick={onClose} className="btn-subtle !h-8 !w-8 !p-0" aria-label="Close">
                  <X size={16} strokeWidth={1.75} />
                </button>
              )}
            </div>

            {reason === "required" && (
              <p className="mb-3 rounded-md border border-brass/30 bg-brass/10 px-3 py-2 text-[13px] text-ink">
                Your operator session has expired. Unlock, then run that action again.
              </p>
            )}
            <p className="mb-4 text-[13px] text-body">
              Enter the <code className="rounded-sm bg-well px-1 py-0.5 font-mono text-[12px] text-ink">VIGIL_OPERATOR_SECRET</code>{" "}
              {standalone ? "to open the console." : "to keep using the console."}
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label mb-1.5 block" htmlFor="operator-secret-input">
                  Secret key
                </label>
                <div className="relative">
                  <KeyRound size={15} strokeWidth={1.75} className="pointer-events-none absolute left-3 top-2.5 text-silver" />
                  <input
                    id="operator-secret-input"
                    type="password"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder="Operator secret"
                    autoFocus
                    required
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? "operator-secret-error" : undefined}
                    className="h-9 w-full rounded-md border border-hairline bg-well pl-9 pr-3 font-mono text-[13px] text-ink placeholder:text-silver focus:border-brass focus:outline-none"
                  />
                </div>
                {error && (
                  <p id="operator-secret-error" className="mt-1.5 text-[12px] text-crit">
                    {error}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-end gap-2.5 pt-2">
                {!standalone && (
                  <button type="button" onClick={onClose} className="btn-ghost">
                    Cancel
                  </button>
                )}
                <button type="submit" disabled={loading} className="btn-primary">
                  {loading ? "Unlocking…" : "Unlock session"}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
