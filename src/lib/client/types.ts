/**
 * Wire types for client components. Server read models are imported as
 * types only (erased at compile time, so no server code reaches the bundle)
 * and run through `Serialized<>` to reflect JSON's Date → string conversion.
 */
import type { IncidentStatus, SignatureStatus, SimMode, WebhookEvent, WebhookReplay } from "@prisma/client";
import type { IncidentWithTimeline } from "../incidents";
import type { MonitorDetail, MonitorSummary, Overview } from "../metrics";
import type { ProbeResult } from "../probe";
import type { StatusPageData } from "../status";
import type { EventSummary, SerializedEndpoint } from "../webhooks";

export type Serialized<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Serialized<U>[]
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T;

export type { MonitorSummary, ProbeResult, StatusPageData, SerializedEndpoint };
export type OverviewDTO = Serialized<Overview>;
export type MonitorDetailDTO = Serialized<MonitorDetail>;
export type IncidentDTO = Serialized<IncidentWithTimeline>;

export type EventSummaryDTO = Serialized<Omit<EventSummary, "_count">> & { replayCount: number };
export type ReplayDTO = Serialized<WebhookReplay>;
export type EventDetailDTO = {
  event: Serialized<WebhookEvent> & { replays: ReplayDTO[] };
  endpoint: SerializedEndpoint;
  replayDefaults: { method: string; headers: Record<string, string> };
};

export interface EndpointDetailDTO {
  endpoint: SerializedEndpoint;
  rateLimit: { limit: number; remaining: number; refillPerSec: number; resetSec: number; backend: "upstash" | "memory" };
  signatures24h: Partial<Record<SignatureStatus, number>>;
}

export interface SweepResponse {
  scope: "due" | "all";
  probed: number;
  durationMs: number;
  results: ProbeResult[];
  errors: { monitorId: string; error: string }[];
}

export interface SimServiceDTO {
  id: string;
  label: string;
  path: string;
  mode: SimMode;
  modeLabel: string;
  baseLatencyMs: number;
  spikeLatencyMs: number;
  updatedAt: string | null;
  monitors: { id: string; name: string; url: string; status: MonitorSummary["status"] }[];
}

export interface EvidenceItemDTO {
  id: string;
  label: string;
  detail: string;
  severity: "info" | "warn" | "crit";
}

export interface InstantFixDTO {
  id: string;
  title: string;
  summary: string;
  riskLevel: "SAFE" | "GUARDED";
  actionType: "RUNBOOK_WEBHOOK" | "SMART_REPLAY" | "COPY_SNIPPET" | "ADAPTIVE_BACKOFF";
  targetUrl?: string;
  serviceId?: string;
  snippetCode?: string;
  snippetLanguage?: string;
  snippetExplanation?: string;
  diffBefore?: string;
  diffAfter?: string;
  suggestedIntervalSec?: number;
  payloadPatch?: Record<string, unknown>;
  repairedHeaders?: Record<string, string>;
}

export interface DiagnosticReportDTO {
  rootCauseTitle: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  category: "AVAILABILITY" | "LATENCY" | "SECURITY" | "PAYLOAD" | "RATE_LIMIT" | "ASSERTION";
  summary: string;
  evidenceChain: EvidenceItemDTO[];
  instantFixes: InstantFixDTO[];
  analyzedAt: string;
}

export interface HistoricalPrecedentDTO {
  incidentId: string;
  monitorName: string;
  title: string;
  resolutionNote: string;
  downtimeSec: number;
  timeToRecoverFormatted: string;
  resolvedAt: string;
  similarityReason: string;
}

export interface RemediationLogDTO {
  id: string;
  incidentId?: string | null;
  webhookEventId?: string | null;
  actionType: "RUNBOOK_WEBHOOK" | "SMART_REPLAY" | "COPY_SNIPPET" | "ADAPTIVE_BACKOFF";
  title: string;
  status: "EXECUTED" | "VERIFIED" | "FAILED";
  executedBy: string;
  responseCode?: number | null;
  outputPreview?: string | null;
  createdAt: string;
}

export type { IncidentStatus, SignatureStatus, SimMode };
