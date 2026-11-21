import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getMonitorDetail } from "@/lib/metrics";
import { serialize } from "@/lib/serialize";
import { MonitorDetailView } from "./MonitorDetailView";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const m = await db.monitor.findUnique({ where: { id }, select: { name: true } });
  return { title: m?.name ?? "Monitor" };
}

export default async function MonitorPage({ params }: Props) {
  const { id } = await params;
  const detail = await getMonitorDetail(id, "24H");
  if (!detail) notFound();
  return <MonitorDetailView id={id} initial={serialize(detail)} />;
}
