import "server-only";
import { getAppOrigin } from "./utils";

/** Discord incoming webhooks want `content`; Slack, Mattermost, Google Chat, Teams workflows and ntfy-style bridges take `text`. */
export function buildAlertPayload(webhookUrl: string, text: string): Record<string, string> {
  let host = "";
  try {
    host = new URL(webhookUrl).hostname;
  } catch {
    /* fall through to the Slack shape */
  }
  return /(^|\.)discord(app)?\.com$/.test(host) ? { content: text } : { text };
}

/**
 * Post an incident notice to ALERT_WEBHOOK_URL. Never throws: a broken alert
 * channel must not fail the probe that detected the outage.
 */
export async function sendAlert(text: string): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildAlertPayload(url, `${text}\n${getAppOrigin()}/incidents`)),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) console.error(`[alerts] webhook responded ${res.status}`);
  } catch (err) {
    console.error("[alerts] webhook delivery failed:", err);
  }
}
