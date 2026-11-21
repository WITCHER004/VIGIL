"use client";

import { AnimatePresence, motion } from "framer-motion";
import { KeyRound, Lock, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { apiFetch } from "@/lib/client/api";

interface OperatorUnlockModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function OperatorUnlockModal({ open, onClose, onSuccess }: OperatorUnlockModalProps) {
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secret.trim()) return;
    setLoading(true);
    setError(null);

    try {
      await apiFetch("/api/auth/operator", {
        method: "POST",
        json: { secret },
      });
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
            onClick={onClose}
            className="fixed inset-0 bg-ink/40 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ duration: 0.2, ease: [0.19, 1, 0.22, 1] }}
            className="relative z-10 w-full max-w-[420px] rounded-[2px] border border-hairline-strong bg-surface p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-hairline pb-4 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 border border-hairline bg-well rounded-[2px]">
                  <Lock size={16} className="text-vermilion" />
                </div>
                <div>
                  <h3 className="font-display text-[18px] text-ink leading-none">Operator Privileges</h3>
                  <p className="font-mono text-[11px] text-silver uppercase tracking-wider mt-0.5">
                    Authentication Gate
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded p-1 text-silver hover:bg-well hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-[13px] text-body mb-4">
              Enter your <code className="font-mono text-[12px] bg-well px-1 py-0.5 rounded text-ink">VIGIL_OPERATOR_SECRET</code> to unlock live sweep triggers, chaos simulator mutation, and recovery runbooks.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label block mb-1.5" htmlFor="operator-secret-input">
                  Secret Key
                </label>
                <div className="relative">
                  <KeyRound size={15} className="absolute left-3 top-2.5 text-silver pointer-events-none" />
                  <input
                    id="operator-secret-input"
                    type="password"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder="Enter operator secret…"
                    autoFocus
                    required
                    className="w-full h-9 bg-well border border-hairline rounded-[2px] pl-9 pr-3 text-[13px] font-mono text-ink placeholder:text-silver focus:outline-none focus:border-vermilion"
                  />
                </div>
                {error && <p className="text-[12px] text-vermilion mt-1.5">{error}</p>}
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button type="button" onClick={onClose} className="btn-ghost">
                  Cancel
                </button>
                <button type="submit" disabled={loading} className="btn-primary">
                  {loading ? "Authenticating…" : "Unlock Session"}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
