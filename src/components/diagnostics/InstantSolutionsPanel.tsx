"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Code2,
  Copy,
  ExternalLink,
  FileText,
  History,
  Layers,
  Play,
  RotateCw,
  ShieldAlert,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch, errorMessage } from "@/lib/client/api";
import type {
  DiagnosticReportDTO,
  HistoricalPrecedentDTO,
  InstantFixDTO,
  RemediationLogDTO,
} from "@/lib/client/types";
import { EASE_CLASSIC, transitionClassic, useMotionPreset } from "@/lib/motion";
import { cn, formatDateTime } from "@/lib/utils";

interface SolutionsResponse {
  report: DiagnosticReportDTO;
  precedent: HistoricalPrecedentDTO | null;
  remediations: RemediationLogDTO[];
}

interface EnhancedAnalysisResponse {
  ok: boolean;
  engine: string;
  architecturalNotes: string;
  recommendations: string[];
}

interface InstantSolutionsPanelProps {
  incidentId?: string;
  webhookId?: string;
  initialReport?: DiagnosticReportDTO;
  initialPrecedent?: HistoricalPrecedentDTO | null;
  initialRemediations?: RemediationLogDTO[];
  webhookContext?: {
    eventId: string;
    onSmartReplayDone?: () => void;
  };
  onRemediated?: (log: RemediationLogDTO) => void;
  className?: string;
}

export function InstantSolutionsPanel({
  incidentId,
  webhookId,
  initialReport,
  initialPrecedent,
  initialRemediations = [],
  webhookContext,
  onRemediated,
  className,
}: InstantSolutionsPanelProps) {
  const { titleReveal, staggerContainer } = useMotionPreset();

  const [report, setReport] = useState<DiagnosticReportDTO | null>(initialReport ?? null);
  const [precedent, setPrecedent] = useState<HistoricalPrecedentDTO | null>(initialPrecedent ?? null);
  const [remediations, setRemediations] = useState<RemediationLogDTO[]>(initialRemediations);
  const [loading, setLoading] = useState<boolean>(!initialReport && Boolean(incidentId || webhookId));
  const [error, setError] = useState<string | null>(null);

  // Guarded execution state per fix ID: null | "CONFIRMING" | "RUNNING" | "DONE"
  const [fixState, setFixState] = useState<Record<string, "CONFIRMING" | "RUNNING" | "DONE">>({});
  const [copiedSnippetId, setCopiedSnippetId] = useState<string | null>(null);
  const [expandedFixId, setExpandedFixId] = useState<string | null>(null);

  // LLM / Deepen Analysis state
  const [enhancing, setEnhancing] = useState<boolean>(false);
  const [enhancedAnalysis, setEnhancedAnalysis] = useState<EnhancedAnalysisResponse | null>(null);

  // Postmortem export state
  const [generatingPostmortem, setGeneratingPostmortem] = useState<boolean>(false);
  const [postmortemSuccess, setPostmortemSuccess] = useState<boolean>(false);

  // Fetch live solutions if incidentId or webhookId provided and no initial report
  useEffect(() => {
    if ((!incidentId && !webhookId) || initialReport) return;
    let cancelled = false;
    setLoading(true);
    const endpoint = incidentId ? `/api/incidents/${incidentId}/solutions` : `/api/webhooks/${webhookId}/solutions`;
    apiFetch<SolutionsResponse>(endpoint)
      .then((res) => {
        if (cancelled) return;
        setReport(res.report);
        setPrecedent(res.precedent ?? null);
        setRemediations(res.remediations ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [incidentId, webhookId, initialReport]);

  // Execute remediation action
  const handleExecuteFix = async (fix: InstantFixDTO) => {
    if (fix.riskLevel === "GUARDED" && fixState[fix.id] !== "CONFIRMING") {
      setFixState((prev) => ({ ...prev, [fix.id]: "CONFIRMING" }));
      return;
    }

    setFixState((prev) => ({ ...prev, [fix.id]: "RUNNING" }));
    try {
      if (webhookContext && fix.actionType === "SMART_REPLAY") {
        const res = await apiFetch<{ ok: boolean; remediation: RemediationLogDTO }>(
          `/api/webhooks/${webhookContext.eventId}/smart-fix-replay`,
          { method: "POST", json: {} },
        );
        setFixState((prev) => ({ ...prev, [fix.id]: "DONE" }));
        if (res.remediation) {
          setRemediations((prev) => [res.remediation, ...prev]);
          onRemediated?.(res.remediation);
        }
        webhookContext.onSmartReplayDone?.();
        return;
      }

      if (incidentId) {
        const res = await apiFetch<{ ok: boolean; remediation: RemediationLogDTO }>(
          `/api/incidents/${incidentId}/remediate`,
          {
            method: "POST",
            json: {
              actionType: fix.actionType,
              title: fix.title,
              targetUrl: fix.targetUrl,
              serviceId: fix.serviceId,
              suggestedIntervalSec: fix.suggestedIntervalSec,
            },
          },
        );

        setFixState((prev) => ({ ...prev, [fix.id]: "DONE" }));
        if (res.remediation) {
          setRemediations((prev) => [res.remediation, ...prev]);
          onRemediated?.(res.remediation);
        }
      }
    } catch (err) {
      setError(errorMessage(err));
      setFixState((prev) => ({ ...prev, [fix.id]: "CONFIRMING" }));
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSnippetId(id);
    setTimeout(() => setCopiedSnippetId(null), 2500);
  };

  const handleDeepenAnalysis = async () => {
    if (!report) return;
    setEnhancing(true);
    try {
      const res = await apiFetch<EnhancedAnalysisResponse>("/api/diagnostics/enhance", {
        method: "POST",
        json: {
          rootCauseTitle: report.rootCauseTitle,
          summary: report.summary,
          evidenceChain: report.evidenceChain,
        },
      });
      setEnhancedAnalysis(res);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setEnhancing(false);
    }
  };

  const handleGeneratePostmortem = async () => {
    if (!incidentId) return;
    setGeneratingPostmortem(true);
    try {
      const res = await apiFetch<{ ok: boolean; markdown: string; filename: string }>(
        `/api/incidents/${incidentId}/postmortem`,
        { method: "POST" },
      );
      // Copy to clipboard
      await navigator.clipboard.writeText(res.markdown);
      setPostmortemSuccess(true);
      setTimeout(() => setPostmortemSuccess(false), 3500);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setGeneratingPostmortem(false);
    }
  };

  if (loading) {
    return (
      <div className={cn("panel border-l-[3px] border-l-vermilion/50 p-5 shadow-placard", className)}>
        <div className="flex items-center gap-3 text-silver">
          <RotateCw size={14} className="animate-spin text-vermilion" />
          <span className="text-[13px] tracking-wide text-body">Evaluating deterministic diagnostic ruleset…</span>
        </div>
      </div>
    );
  }

  if (!report) return null;

  const confidenceBadge =
    report.confidence === "HIGH" ? (
      <span className="rounded-[2px] border border-viridian/30 bg-viridian/10 px-2 py-0.5 font-sans text-[10px] font-semibold tracking-wider text-viridian">
        HIGH CONFIDENCE
      </span>
    ) : report.confidence === "MEDIUM" ? (
      <span className="rounded-[2px] border border-ochre/30 bg-ochre/10 px-2 py-0.5 font-sans text-[10px] font-semibold tracking-wider text-ochre">
        MEDIUM CONFIDENCE
      </span>
    ) : (
      <span className="rounded-[2px] border border-hairline bg-well px-2 py-0.5 font-sans text-[10px] font-semibold tracking-wider text-silver">
        LOW CONFIDENCE
      </span>
    );

  return (
    <div
      className={cn(
        "panel relative overflow-hidden rounded-[2px] border border-hairline border-l-[3px] border-l-vermilion bg-surface p-5 sm:p-6 shadow-placard",
        className,
      )}
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-vermilion" />
            <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-vermilion">Curator's Prescription</span>
          </div>
          <h3 className="mt-1 font-display text-[22px] tracking-tight text-ink sm:text-[24px]">
            {report.rootCauseTitle}
          </h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-body">{report.summary}</p>
        </div>
        <div className="flex items-center gap-2">{confidenceBadge}</div>
      </div>

      {error && (
        <div className="mt-3 rounded-sm border border-crit/30 bg-crit/10 px-3 py-2 text-[12px] text-crit">
          {error}
        </div>
      )}

      {/* Evidence Trace Reveal Section */}
      <div className="mt-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="label flex items-center gap-1.5 text-silver">
            <Layers size={13} strokeWidth={1.5} className="text-copper" /> Observed Evidence Chain
          </span>
          <span className="text-[11px] text-silver/60">Deterministic Signals</span>
        </div>

        <div className="relative pl-5">
          {/* Animated 1px Silver Blue vertical rail */}
          <motion.div
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ duration: 0.6, ease: EASE_CLASSIC }}
            className="absolute bottom-2 left-1.5 top-2 w-[1px] origin-top bg-silver/35"
            aria-hidden
          />

          <motion.div
            variants={staggerContainer(0.05, 0.05)}
            initial="hidden"
            animate="visible"
            className="flex flex-col gap-3.5"
          >
            {report.evidenceChain.map((ev, index) => {
              const dotColor =
                ev.severity === "crit" ? "bg-crit" : ev.severity === "warn" ? "bg-warn" : "bg-ok";
              return (
                <motion.div
                  key={ev.id || index}
                  variants={{
                    hidden: { opacity: 0, y: 8 },
                    visible: { opacity: 1, y: 0, transition: transitionClassic(0.35, index * 0.05) },
                  }}
                  className="relative flex items-start gap-2.5 text-[13px]"
                >
                  <span
                    className={cn(
                      "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ring-2 ring-surface",
                      dotColor,
                    )}
                    aria-hidden
                  />
                  <div>
                    <span className="font-medium text-ink">{ev.label}: </span>
                    <span className="text-body/90">{ev.detail}</span>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </div>

      {/* Historical Precedent Card */}
      {precedent && (
        <div className="mt-5 rounded border border-hairline/80 bg-raised/40 p-3.5">
          <div className="flex items-center justify-between">
            <span className="label flex items-center gap-1.5 text-copper">
              <History size={13} strokeWidth={1.5} /> Historical Precedent
            </span>
            <span className="text-[11px] text-silver/70">
              Recovered in <span className="num font-semibold text-ink">{precedent.timeToRecoverFormatted}</span>
            </span>
          </div>
          <div className="mt-2 text-[13px]">
            <span className="font-medium text-ink">Prior Incident: </span>
            <span className="text-silver">{precedent.title}</span>
          </div>
          <p className="mt-1.5 text-[12.5px] italic leading-relaxed text-body/90">
            &ldquo;{precedent.resolutionNote}&rdquo;
          </p>
          <div className="mt-2 text-[11px] text-silver/60">
            {precedent.similarityReason} · Resolved {formatDateTime(precedent.resolvedAt)}
          </div>
        </div>
      )}

      {/* Ranked Instant Solutions */}
      <div className="mt-6 border-t border-hairline/80 pt-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="label flex items-center gap-1.5 text-silver">
            <Wrench size={13} strokeWidth={1.5} className="text-copper" /> Recommended Actions & Instant Fixes
          </span>
          <span className="text-[11px] text-silver/60">Ranked by effectiveness</span>
        </div>

        <div className="flex flex-col gap-3">
          {report.instantFixes.map((fix) => {
            const state = fixState[fix.id];
            const isDone = state === "DONE";
            const isConfirming = state === "CONFIRMING";
            const isRunning = state === "RUNNING";
            const isAccordionOpen = expandedFixId === fix.id;
            const isCopied = copiedSnippetId === fix.id;

            return (
              <div
                key={fix.id}
                className={cn(
                  "rounded border transition-colors",
                  isDone
                    ? "border-ok/30 bg-ok/5"
                    : isConfirming
                      ? "border-copper/40 bg-copper/5"
                      : "border-hairline bg-raised/20 hover:border-hairline-strong",
                )}
              >
                <div className="flex flex-col p-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-medium text-ink">{fix.title}</span>
                      {fix.riskLevel === "GUARDED" ? (
                        <span className="rounded-[2px] border border-copper/30 bg-copper/10 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-copper">
                          GUARDED
                        </span>
                      ) : (
                        <span className="rounded-[2px] border border-ok/30 bg-ok/10 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-ok">
                          SAFE
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[12.5px] text-body">{fix.summary}</p>
                  </div>

                  {/* Action execution buttons */}
                  <div className="mt-3 flex shrink-0 items-center gap-2 sm:mt-0">
                    {fix.snippetCode && (
                      <button
                        type="button"
                        onClick={() => setExpandedFixId((prev) => (prev === fix.id ? null : fix.id))}
                        className="inline-flex items-center gap-1.5 rounded border border-hairline px-2.5 py-1 text-[12px] text-silver transition-colors hover:border-hairline-strong hover:text-ink"
                      >
                        <Code2 size={13} />
                        <span>{isAccordionOpen ? "Hide snippet" : "Inspect snippet"}</span>
                        <ChevronDown
                          size={12}
                          className={cn("transition-transform duration-200", isAccordionOpen && "rotate-180")}
                        />
                      </button>
                    )}

                    {/* GUARDED / SAFE action button with inline confirmation morph */}
                    {fix.actionType !== "COPY_SNIPPET" && (
                      <div className="flex items-center gap-1.5">
                        {isDone ? (
                          <motion.span
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="inline-flex items-center gap-1.5 rounded border border-ok/40 bg-ok/15 px-2.5 py-1 text-[11.5px] font-medium text-ok"
                          >
                            <CheckCircle2 size={13} /> VERIFIED & LOGGED
                          </motion.span>
                        ) : isConfirming ? (
                          <motion.div
                            layout
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="flex items-center gap-1.5"
                          >
                            <button
                              type="button"
                              onClick={() => handleExecuteFix(fix)}
                              className="relative inline-flex items-center gap-1.5 overflow-hidden rounded border border-copper bg-copper px-2.5 py-1 text-[12px] font-medium text-white shadow-sm hover:brightness-110"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setFixState((prev) => {
                                  const copy = { ...prev };
                                  delete copy[fix.id];
                                  return copy;
                                })
                              }
                              className="rounded border border-hairline px-2 py-1 text-[12px] text-silver hover:text-ink"
                            >
                              Cancel
                            </button>
                          </motion.div>
                        ) : (
                          <motion.button
                            layout
                            type="button"
                            disabled={isRunning}
                            onClick={() => handleExecuteFix(fix)}
                            className={cn(
                              "relative inline-flex items-center gap-1.5 overflow-hidden rounded px-3 py-1 text-[12px] font-medium transition-all",
                              fix.riskLevel === "GUARDED"
                                ? "border border-copper/80 bg-copper/15 text-copper hover:bg-copper/25"
                                : "border border-hairline bg-surface text-ink hover:border-hairline-strong",
                            )}
                          >
                            {isRunning ? (
                              <>
                                <RotateCw size={13} className="animate-spin text-copper" />
                                <span>Executing…</span>
                              </>
                            ) : (
                              <>
                                <Play size={11} className={fix.riskLevel === "GUARDED" ? "fill-copper text-copper" : "text-silver"} />
                                <span>
                                  {fix.actionType === "RUNBOOK_WEBHOOK"
                                    ? "Execute Runbook"
                                    : fix.actionType === "SMART_REPLAY"
                                      ? "Auto-Fix & Replay"
                                      : "Engage Backoff"}
                                </span>
                              </>
                            )}
                          </motion.button>
                        )}
                      </div>
                    )}

                    {fix.actionType === "COPY_SNIPPET" && fix.snippetCode && (
                      <button
                        type="button"
                        onClick={() => handleCopy(fix.id, fix.snippetCode!)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-[12px] transition-all",
                          isCopied
                            ? "border-copper/40 bg-copper/15 text-copper"
                            : "border-hairline bg-surface text-silver hover:border-hairline-strong hover:text-ink",
                        )}
                      >
                        {isCopied ? <Check size={12} className="text-copper" /> : <Copy size={12} />}
                        <span>{isCopied ? "COPIED" : "Copy cURL"}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Snippet / Diff Accordion with AnimatePresence */}
                <AnimatePresence>
                  {isAccordionOpen && fix.snippetCode && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: EASE_CLASSIC }}
                      className="overflow-hidden border-t border-hairline/60 bg-well/90"
                    >
                      <div className="flex items-center justify-between border-b border-hairline/40 px-3.5 py-1.5 text-[11px] text-silver">
                        <span className="font-mono uppercase">{fix.snippetLanguage || "bash"}</span>
                        <button
                          type="button"
                          onClick={() => handleCopy(fix.id, fix.snippetCode!)}
                          className="inline-flex items-center gap-1 text-copper hover:underline"
                        >
                          {isCopied ? (
                            <>
                              <Check size={11} /> Copied!
                            </>
                          ) : (
                            <>
                              <Copy size={11} /> Copy snippet
                            </>
                          )}
                        </button>
                      </div>
                      <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-silver/90">
                        {fix.snippetCode}
                      </pre>
                      {fix.snippetExplanation && (
                        <div className="border-t border-hairline/40 px-3.5 py-2 text-[11.5px] text-silver/70">
                          {fix.snippetExplanation}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>

      {/* Enhanced Analysis & Postmortem Action Bar */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-hairline/80 pt-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={enhancing}
            onClick={handleDeepenAnalysis}
            className="inline-flex items-center gap-1.5 rounded border border-hairline bg-raised/30 px-3 py-1.5 text-[12px] text-silver transition-colors hover:border-hairline-strong hover:text-ink disabled:opacity-50"
          >
            {enhancing ? (
              <RotateCw size={13} className="animate-spin text-copper" />
            ) : (
              <Sparkles size={13} className="text-copper" />
            )}
            <span>{enhancing ? "Consulting Engine…" : "Deepen Analysis"}</span>
          </button>

          {incidentId && (
            <button
              type="button"
              disabled={generatingPostmortem}
              onClick={handleGeneratePostmortem}
              className={cn(
                "inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-[12px] transition-colors",
                postmortemSuccess
                  ? "border-ok/40 bg-ok/10 text-ok"
                  : "border-hairline bg-raised/30 text-silver hover:border-hairline-strong hover:text-ink",
              )}
            >
              {generatingPostmortem ? (
                <RotateCw size={13} className="animate-spin text-copper" />
              ) : postmortemSuccess ? (
                <Check size={13} className="text-ok" />
              ) : (
                <FileText size={13} className="text-silver" />
              )}
              <span>
                {generatingPostmortem
                  ? "Compiling…"
                  : postmortemSuccess
                    ? "Postmortem Copied!"
                    : "Generate Postmortem (MD)"}
              </span>
            </button>
          )}
        </div>

        {remediations.length > 0 && (
          <span className="text-[11.5px] text-silver/70">
            {remediations.length} action{remediations.length === 1 ? "" : "s"} audited in timeline
          </span>
        )}
      </div>

      {/* Deepened Analysis Drawer / Accordion */}
      <AnimatePresence>
        {enhancedAnalysis && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: EASE_CLASSIC }}
            className="mt-4 overflow-hidden rounded border border-copper/30 bg-surface/90 p-4"
          >
            <div className="flex items-center justify-between border-b border-hairline/60 pb-2">
              <span className="label flex items-center gap-1.5 text-copper">
                <Sparkles size={12} /> Architectural Guidance ({enhancedAnalysis.engine})
              </span>
              <button
                type="button"
                onClick={() => setEnhancedAnalysis(null)}
                className="text-silver hover:text-ink"
              >
                <X size={13} />
              </button>
            </div>
            <p className="mt-2.5 text-[13px] leading-relaxed text-body">
              {enhancedAnalysis.architecturalNotes}
            </p>
            <div className="mt-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-silver">
                Recommended Precautions:
              </span>
              <ul className="mt-1.5 flex flex-col gap-1.5 pl-4 text-[12.5px] text-body">
                {enhancedAnalysis.recommendations.map((rec, i) => (
                  <li key={i} className="list-disc">
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
