import type { Metadata } from "next";
import { getMonitorSummaries } from "@/lib/metrics";
import { serialize } from "@/lib/serialize";
import { MonitorsView } from "./MonitorsView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Monitors" };

export default async function MonitorsPage() {
  const monitors = await getMonitorSummaries();
  return <MonitorsView initial={serialize({ monitors })} />;
}
