import type { Metadata } from "next";
import { getOverview } from "@/lib/metrics";
import { serialize } from "@/lib/serialize";
import { OverviewView } from "./OverviewView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Overview" };

/** Overview — server-rendered with live data, then kept current by the telemetry engine. */
export default async function OverviewPage() {
  const overview = await getOverview("24H");
  return <OverviewView initial={serialize(overview)} />;
}
