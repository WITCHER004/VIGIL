"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => ReactNode;
}

/** Label + control + hint/error, wired for accessibility. */
export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId();
  const describedBy = error || hint ? `${id}-desc` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": describedBy })}
      {(error || hint) && (
        <p id={describedBy} className={cn("text-[12px] leading-snug", error ? "text-crit" : "text-silver/80")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

/** Hairline toggle switch. */
export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group flex w-full items-start justify-between gap-4 text-left"
    >
      <span>
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-[12px] text-silver">{description}</span>}
      </span>
      <span
        className={cn(
          "relative mt-0.5 h-[18px] w-8 shrink-0 rounded-full border transition-colors duration-300 ease-classic",
          checked ? "border-copper bg-copper-wash" : "border-hairline-strong bg-well",
        )}
      >
        <span
          className={cn(
            "absolute left-[2px] top-[2px] h-3 w-3 rounded-full transition-[transform,background-color] duration-200 ease-classic",
            checked ? "translate-x-[14px] bg-copper" : "translate-x-0 bg-silver/60",
          )}
        />
      </span>
    </button>
  );
}

/** Inline error banner for API failures. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="border border-crit/35 bg-crit/[0.07] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#E88A80]">
      {message}
    </div>
  );
}
