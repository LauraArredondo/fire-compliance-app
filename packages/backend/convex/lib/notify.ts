import { MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { orgBlock, renderEmail } from "./emailTemplates";

/**
 * Queue a one-off transactional email (invites, quotes, invoices) through the same pipeline as
 * reminders: logged in `notifications`, sent by emails:send (dry run until RESEND_API_KEY is set).
 */
export async function queueEmail(
  ctx: MutationCtx,
  org: Doc<"organizations">,
  m: {
    to: string;
    type: string;
    subject: string;
    heading: string;
    paragraphs: string[];
    details?: [string, string][];
    cta?: { label: string; url: string };
    links?: { label: string; url: string }[];
    statusLabel?: string;
    recipientType: "org" | "client";
    userId?: Id<"users">;
    clientId?: Id<"clients">;
    greetingName?: string;
  },
) {
  const logoUrl = org.logoId ? await ctx.storage.getUrl(org.logoId) : null;
  const { html, text } = renderEmail({
    org: orgBlock(org, logoUrl),
    preheader: m.paragraphs[0] ?? m.subject,
    statusLabel: m.statusLabel ?? "Notification",
    tone: "info",
    heading: m.heading,
    greeting: m.greetingName ? `Dear ${m.greetingName.split(" ")[0]},` : "Hello,",
    paragraphs: m.paragraphs,
    details: m.details ?? [],
    cta: m.cta,
    links: m.links,
    closing: `Kind regards,\n${org.name}`,
    footerReason: `This email was sent by ${org.name}.`,
    unsubscribeUrl: null,
  });
  const id = await ctx.db.insert("notifications", {
    orgId: org._id,
    userId: m.userId,
    clientId: m.clientId,
    recipientType: m.recipientType,
    recipientEmail: m.to,
    channel: "email",
    type: m.type,
    title: m.subject,
    body: text,
    html,
    link: m.cta?.url,
    status: "queued",
    attempts: 0,
    createdAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.emails.send, { notificationId: id });
  return id;
}

export const appUrl = (path: string) => `${(process.env.SITE_URL ?? "").replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

/** Public base for Convex HTTP routes (PDF download links, QR verification). */
export const httpUrl = (path: string) => `${(process.env.CONVEX_SITE_URL ?? "").replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
