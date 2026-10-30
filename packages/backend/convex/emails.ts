import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { MAX_SEND_ATTEMPTS, RETRY_BACKOFF_MS } from "./lib/reminderConfig";

/**
 * Send one queued notification through Resend (https://resend.com/docs/api-reference/emails/send-email).
 * Dry run: without RESEND_API_KEY + EMAIL_FROM the email is not sent and is logged as `skipped_no_provider`
 * with its rendered subject/HTML/text. Retries 429/5xx/network errors with backoff, up to MAX_SEND_ATTEMPTS.
 */
export const send = internalAction({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    const n = await ctx.runQuery(internal.reminders.getForSend, { notificationId });
    if (!n || n.status !== "queued" || !n.to) return;
    const key = process.env.RESEND_API_KEY;
    const fromEnv = process.env.EMAIL_FROM;
    if (!key || !fromEnv) {
      await ctx.runMutation(internal.reminders.recordSendResult, { notificationId, outcome: "skipped_no_provider", error: "Dry run: RESEND_API_KEY / EMAIL_FROM not set" });
      return;
    }
    // "Reminders <reminders@domain>" is used as-is; a bare address gets the company name as display name.
    const from = fromEnv.includes("<") ? fromEnv : `${n.orgName.replace(/[<>"]/g, "")} <${fromEnv}>`;
    const headers: Record<string, string> = {};
    if (n.unsubscribeUrl) {
      headers["List-Unsubscribe"] = `<${n.unsubscribeUrl}>`;
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }
    const attempt = n.attempts + 1;
    const retryOrFail = async (error: string) => {
      if (attempt < MAX_SEND_ATTEMPTS) {
        await ctx.runMutation(internal.reminders.recordSendResult, {
          notificationId, outcome: "retry", error, retryInMs: RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)],
        });
      } else {
        await ctx.runMutation(internal.reminders.recordSendResult, { notificationId, outcome: "failed", error: `${error} (gave up after ${attempt} attempts)` });
      }
    };
    try {
      const res = await fetch(process.env.RESEND_API_URL ?? "https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `notification-${notificationId}` },
        body: JSON.stringify({ from, to: [n.to], subject: n.subject, html: n.html, text: n.text, reply_to: n.replyTo ?? undefined, headers }),
      });
      const body = await res.text();
      if (res.ok) {
        let id: string | undefined;
        try {
          id = JSON.parse(body).id;
        } catch {
          /* ignore */
        }
        await ctx.runMutation(internal.reminders.recordSendResult, { notificationId, outcome: "sent", providerMessageId: id });
      } else if (res.status === 429 || res.status >= 500) {
        await retryOrFail(`Resend ${res.status}: ${body.slice(0, 300)}`);
      } else {
        await ctx.runMutation(internal.reminders.recordSendResult, { notificationId, outcome: "failed", error: `Resend ${res.status}: ${body.slice(0, 300)}` });
      }
    } catch (e) {
      await retryOrFail(`Network error: ${String(e).slice(0, 300)}`);
    }
  },
});
