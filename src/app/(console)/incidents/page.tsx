import type { Metadata } from "next";
import { listIncidents } from "@/lib/incidents";
import { serialize } from "@/lib/serialize";
import { IncidentsView } from "./IncidentsView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Incidents" };

export default async function IncidentsPage() {
  const list = await listIncidents({ status: "all" });
  return <IncidentsView initial={serialize(list)} />;
}
