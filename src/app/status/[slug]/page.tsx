import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { UptimeBarStrip } from "@/components/charts/UptimeBarStrip";
import { getStatusPage, type OverallState, type StatusPageData } from "@/lib/status";
import { formatDuration } from "@/lib/utils";
import { PrintButton } from "./PrintButton";

/** Public page: regenerate at most every 30s so traffic spikes never hammer the database. */
export const revalidate = 30;

type Props = { params: Promise<{ slug: string }> };

/** No slugs at build time (the database may not be reachable then); each is rendered on first request, then cached. */
export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = await getStatusPage(slug);
  if (!page) return { title: "Status page not found" };
  return {
    title: { absolute: `${page.title} — Status` },
    description: page.description ?? `Live availability and incident history for ${page.title}.`,
  };
}

// Status pages speak UTC: one unambiguous clock for every reader.
const utc = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts });
const fmtDayLong = utc({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtTime = utc({ hour: "2-digit", minute: "2-digit", hour12: false });
const fmtDayShort = utc({ day: "numeric", month: "short" });

const OVERALL: Record<OverallState, { label: string; tone: string; rgb: string; note: string }> = {
  OPERATIONAL: { label: "All systems operational", tone: "text-viridian", rgb: "20 108 83", note: "Every component is responding normally within target SLAs." },
  DEGRADED: { label: "Degraded performance", tone: "text-ochre", rgb: "212 138 23", note: "Some endpoints are exhibiting elevated response latencies." },
  PARTIAL_OUTAGE: { label: "Partial outage", tone: "text-vermilion", rgb: "223 62 38", note: "One or more monitored services are failing synthetic health checks." },
  MAJOR_OUTAGE: { label: "Major outage", tone: "text-vermilion", rgb: "223 62 38", note: "Critical services are unreachable or returning non-2xx codes." },
};

const COMPONENT_STATE: Record<string, { label: string; tone: string }> = {
  OPERATIONAL: { label: "Operational", tone: "text-viridian" },
  DEGRADED: { label: "Degraded", tone: "text-ochre" },
  DOWN: { label: "Outage", tone: "text-vermilion" },
  PAUSED: { label: "Maintenance", tone: "text-silver" },
  PENDING: { label: "Pending", tone: "text-silver" },
};

const UPDATE_TONE: Record<string, string> = {
  INVESTIGATING: "text-vermilion",
  IDENTIFIED: "text-ochre",
  RESOLVED: "text-viridian",
};

function groupByDay(incidents: StatusPageData["incidents"]) {
  const groups = new Map<string, StatusPageData["incidents"]>();
  for (const i of incidents) {
    const key = i.startedAt.slice(0, 10);
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  return [...groups];
}

export default async function StatusPage({ params }: Props) {
  const { slug } = await params;
  const page = await getStatusPage(slug);
  if (!page) notFound();

  const overall = OVERALL[page.overall];
  const generated = new Date(page.generatedAt);
  const active = page.incidents.filter((i) => i.status !== "RESOLVED");
  const days = groupByDay(page.incidents.filter((i) => i.status === "RESOLVED"));

  return (
    <div className="mx-auto max-w-[880px] px-4 pb-24 sm:px-8">
      {/* Masthead */}
      <header className="pt-10 sm:pt-14">
        <div className="flex items-center justify-between text-[12px] text-silver">
          <span className="num">{fmtDayLong.format(generated)}</span>
          <PrintButton />
        </div>
        <div className="mt-3 h-[3px] border-y border-hairline-strong" aria-hidden />
        <div className="py-7 text-center">
          <p className="label">Service status</p>
          <h1 className="mt-3 text-[40px] leading-[1.02] sm:text-[56px]">
            {page.title} <em className="italic text-silver">status</em>
          </h1>
          {page.description && <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-body/85">{page.description}</p>}
        </div>
        <div className="h-px bg-rule" aria-hidden />
      </header>

      {/* Overall */}
      <section
        className="mt-10 rounded-[2px] border border-hairline bg-surface p-6 sm:p-8 shadow-placard"
        aria-live="polite"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="relative inline-flex h-3.5 w-3.5">
              <span className="absolute inset-0 rounded-full opacity-60 animate-ping" style={{ backgroundColor: `rgb(${overall.rgb})` }} />
              <span className="relative h-3.5 w-3.5 rounded-full" style={{ backgroundColor: `rgb(${overall.rgb})` }} />
            </span>
            <div>
              <h2 className={`font-display text-[28px] font-normal leading-tight ${overall.tone}`}>{overall.label}</h2>
              <p className="mt-1 text-[13px] text-body">{overall.note}</p>
            </div>
          </div>
          <p className="num font-mono text-[11px] text-silver">Updated {fmtTime.format(generated)} UTC</p>
        </div>
      </section>

      {/* Active incidents */}
      {active.length > 0 && (
        <section className="mt-10" aria-label="Active incidents">
          <p className="label">Active incidents</p>
          <div className="mt-4 flex flex-col gap-4">
            {active.map((i) => (
              <article key={i.id} className="border-l-2 border-crit/80 pl-5">
                <h3 className="text-[22px] leading-snug">{i.title}</h3>
                <p className="mt-1 text-[12px] text-silver">
                  {i.component} · since {fmtDayShort.format(new Date(i.startedAt))} {fmtTime.format(new Date(i.startedAt))} UTC
                </p>
                <ol className="mt-4 flex flex-col gap-3">
                  {i.updates.map((u) => (
                    <li key={u.id} className="text-[14px] leading-relaxed">
                      <span className={`mr-2 font-sans text-[12px] font-medium ${UPDATE_TONE[u.status] ?? "text-silver"}`}>{u.status.charAt(0) + u.status.slice(1).toLowerCase()}</span>
                      <span className="text-body">{u.message}</span>
                      <span className="num ml-2 whitespace-nowrap text-[12px] text-silver">{fmtTime.format(new Date(u.createdAt))} UTC</span>
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Components */}
      <section className="mt-12" aria-label="Components">
        <div className="flex items-baseline justify-between border-b border-hairline pb-3">
          <h2 className="text-[22px]">Components</h2>
          <p className="label">Uptime · last 30 days</p>
        </div>
        <ul className="divide-y divide-hairline">
          {page.components.map((c) => {
            const state = COMPONENT_STATE[c.status] ?? COMPONENT_STATE.PENDING!;
            return (
              <li key={c.id} className="py-6">
                <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 className="font-sans text-[15px] font-medium text-ink">{c.name}</h3>
                  <p className="flex items-baseline gap-4">
                    <span className="num text-[13px] text-silver">{c.uptime30d == null ? "—" : `${c.uptime30d.toFixed(2)}%`}</span>
                    <span className={`text-[12px] font-medium ${state.tone}`}>{state.label}</span>
                  </p>
                </div>
                <UptimeBarStrip days={c.days} height={30} />
              </li>
            );
          })}
        </ul>
        <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-silver/80">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 bg-ok" /> ≥ 99.95%</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 bg-ok/60" /> ≥ 99%</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 bg-warn" /> ≥ 95%</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 bg-crit" /> below 95%</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 bg-silver/15" /> no data</span>
        </p>
      </section>

      {/* Dispatches */}
      <section className="mt-14" aria-label="Past incidents">
        <div className="border-b border-hairline pb-3">
          <h2 className="text-[22px]">Past incidents</h2>
        </div>
        {days.length === 0 && <p className="py-10 text-center text-[13px] text-silver">No incidents in the last 30 days</p>}
        {days.map(([day, items]) => (
          <div key={day} className="grid gap-x-8 border-b border-hairline py-7 sm:grid-cols-[150px_minmax(0,1fr)]">
            <p className="label pt-1.5">{fmtDayLong.format(new Date(`${day}T12:00:00Z`)).replace(/ \d{4}$/, "")}</p>
            <div className="mt-3 flex flex-col gap-7 sm:mt-0">
              {items.map((i) => (
                <article key={i.id}>
                  <h3 className="text-[22px] leading-snug">{i.title}</h3>
                  <p className="num mt-1 text-[12px] text-silver">
                    {i.component} · {fmtTime.format(new Date(i.startedAt))}–{i.resolvedAt ? fmtTime.format(new Date(i.resolvedAt)) : "…"} UTC
                    {i.downtimeSec != null && ` · ${formatDuration(i.downtimeSec)} of downtime`}
                  </p>
                  <ol className="mt-3 flex flex-col gap-2.5">
                    {i.updates.map((u) => (
                      <li key={u.id} className="text-[14px] leading-relaxed">
                        <span className={`mr-2 font-sans text-[12px] font-medium ${UPDATE_TONE[u.status] ?? "text-silver"}`}>{u.status.charAt(0) + u.status.slice(1).toLowerCase()}</span>
                        <span className="text-body">{u.message}</span>
                        <span className="num ml-2 whitespace-nowrap text-[12px] text-silver">{fmtTime.format(new Date(u.createdAt))}</span>
                      </li>
                    ))}
                  </ol>
                </article>
              ))}
            </div>
          </div>
        ))}
      </section>

      <footer className="mt-12 flex flex-wrap items-center justify-between gap-4 text-[12px] text-silver">
        <p>
          Monitored by <span className="text-ink">Vigil</span> · probes run continuously; this page refreshes every 30 seconds.
        </p>
        <Link href="/" className="no-print transition-colors hover:text-ink">
          Operator console →
        </Link>
      </footer>
    </div>
  );
}
