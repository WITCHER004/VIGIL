"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="no-print inline-flex items-center gap-1.5 text-[12px] text-silver transition-colors hover:text-ink">
      <Printer size={13} strokeWidth={1.5} /> Print
    </button>
  );
}
