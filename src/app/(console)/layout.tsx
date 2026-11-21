import { AppShell } from "@/components/shell/AppShell";

/** Operator console: top bar, rail navigation, live telemetry engine and simulator dock. */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
