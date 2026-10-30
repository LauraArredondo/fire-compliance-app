import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { simplePage } from "./lib/emailTemplates";
import { renderAssetPage, renderCertificatePage, renderSitePage } from "./lib/verifyPage";

const http = httpRouter();

auth.addHttpRoutes(http);

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const html = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    },
  });

/**
 * Public QR verification pages:
 *   GET /verify/<certificateToken>   certificate
 *   GET /verify/a/<assetTag>         asset / device label
 *   GET /verify/s/<siteToken>        site / premises label
 *   GET /verify?token=<certificateToken>
 */
const verifyHandler = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/verify\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const meta = {
    userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? undefined,
    ipHash: ip ? (await sha256Hex(ip)).slice(0, 32) : undefined,
  };
  if (parts[0] === "a" && parts[1]) {
    const r = await ctx.runMutation(internal.certificates.scanAsset, { token: parts[1], ...meta });
    return html(renderAssetPage(r, parts[1]), r ? 200 : 404);
  }
  if (parts[0] === "s" && parts[1]) {
    const r = await ctx.runMutation(internal.certificates.scanSite, { token: parts[1], ...meta });
    return html(renderSitePage(r, parts[1]), r ? 200 : 404);
  }
  const token = parts[0] ?? url.searchParams.get("token") ?? "";
  const r = await ctx.runMutation(internal.certificates.scanCertificate, { token, ...meta });
  return html(renderCertificatePage(r, token), r.found ? 200 : 404);
});

/**
 * Emailed PDF links (always the latest render; drafts never served):
 *   GET /pdf/q/<quoteAcceptanceToken>   quote
 *   GET /pdf/i/<invoicePdfToken>        invoice
 */
const pdfHandler = httpAction(async (ctx, request) => {
  const [kind, token] = new URL(request.url).pathname.replace(/^\/pdf\/?/, "").split("/").map(decodeURIComponent);
  if ((kind !== "q" && kind !== "i") || !token) return html(simplePage("Document", "Link not valid", "This document link is incomplete."), 404);
  const r = await ctx.runQuery(internal.commercialDocs.pdfForToken, { kind, token: token.replace(/\.pdf$/i, "") });
  if (!r) return html(simplePage("Document", "Link not valid", "This document link is not recognised or is no longer available."), 404);
  const blob = r.storageId ? await ctx.storage.get(r.storageId) : null;
  if (!blob) {
    const res = html(simplePage("Document", "Your document is being prepared", "Please try again in a few seconds."), 503);
    res.headers.set("Retry-After", "5");
    return res;
  }
  return new Response(blob, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${r.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
      ...(r.sha256 ? { "X-Content-SHA256": r.sha256 } : {}),
    },
  });
});
http.route({ pathPrefix: "/pdf/", method: "GET", handler: pdfHandler });

http.route({ path: "/verify", method: "GET", handler: verifyHandler });
http.route({ pathPrefix: "/verify/", method: "GET", handler: verifyHandler });

/**
 * Email opt-out:
 *   GET  /unsubscribe/<token>  confirmation page (a GET never unsubscribes, so link scanners can't opt people out)
 *   POST /unsubscribe/<token>  confirm; also RFC 8058 one-click from the List-Unsubscribe-Post header
 */
const unsubscribeHandler = httpAction(async (ctx, request) => {
  const token = decodeURIComponent(new URL(request.url).pathname.replace(/^\/unsubscribe\/?/, "").split("/")[0] ?? "");
  if (!token) return html(simplePage("Unsubscribe", "Link not valid", "This unsubscribe link is incomplete."), 404);
  if (request.method === "POST") {
    const r = await ctx.runMutation(internal.reminders.unsubscribe, { token });
    if (!r) return html(simplePage("Unsubscribe", "Link not valid", "This unsubscribe link is not recognised or has expired."), 404);
    return html(
      simplePage("Unsubscribed", "You have been unsubscribed", `${r.email} will no longer receive automated reminder emails from ${r.orgName}. To start receiving them again, please contact ${r.orgName}.`),
    );
  }
  const info = await ctx.runQuery(internal.reminders.unsubscribeInfo, { token });
  if (!info) return html(simplePage("Unsubscribe", "Link not valid", "This unsubscribe link is not recognised or has expired."), 404);
  if (info.already) return html(simplePage("Unsubscribed", "Already unsubscribed", `${info.email} is not receiving reminder emails from ${info.orgName}.`));
  return html(
    simplePage(
      "Unsubscribe",
      `Stop reminder emails from ${info.orgName}?`,
      `${info.email} will no longer receive automated service, certificate and defect reminders. Please note you remain responsible for keeping your premises compliant.`,
      { action: `/unsubscribe/${encodeURIComponent(token)}`, button: "Unsubscribe" },
    ),
  );
});
http.route({ pathPrefix: "/unsubscribe/", method: "GET", handler: unsubscribeHandler });
http.route({ pathPrefix: "/unsubscribe/", method: "POST", handler: unsubscribeHandler });

export default http;
