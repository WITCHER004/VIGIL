import { describe, expect, it } from "vitest";
import { buildAlertPayload } from "../alerts";

describe("buildAlertPayload", () => {
  it("uses `content` for Discord webhooks", () => {
    expect(buildAlertPayload("https://discord.com/api/webhooks/1/abc", "down")).toEqual({ content: "down" });
    expect(buildAlertPayload("https://ptb.discordapp.com/api/webhooks/1/abc", "down")).toEqual({ content: "down" });
  });

  it("uses `text` for Slack and everything else", () => {
    expect(buildAlertPayload("https://hooks.slack.com/services/T/B/x", "down")).toEqual({ text: "down" });
    expect(buildAlertPayload("https://notdiscord.com.evil.io/hook", "down")).toEqual({ text: "down" });
    expect(buildAlertPayload("not a url", "down")).toEqual({ text: "down" });
  });
});
