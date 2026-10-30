import type { Doc } from "../_generated/dataModel";

/** Branded, table-based HTML + plain-text emails (renders in Outlook, Gmail, Apple Mail). */

export type EmailTone = "info" | "soon" | "overdue" | "ok";
export type EmailInput = {
  org: { name: string; logoUrl: string | null; addressLine: string | null; phone: string | null; email: string | null; accreditations: string[] };
  preheader: string;
  statusLabel: string;
  tone: EmailTone;
  heading: string;
  greeting: string;
  paragraphs: string[];
  details: [string, string][];
  /** Optional extra table, e.g. weekly digest sections. */
  sections?: { title: string; rows: [string, string, string][]; empty: string }[];
  cta?: { label: string; url: string };
  /** Secondary text links under the button, e.g. "Download PDF". */
  links?: { label: string; url: string }[];
  closing: string;
  footerReason: string;
  unsubscribeUrl: string | null;
};

const TONE: Record<EmailTone, { bg: string; fg: string }> = {
  info: { bg: "#e0ecff", fg: "#1d4ed8" },
  soon: { bg: "#fff1d6", fg: "#a15c00" },
  overdue: { bg: "#fde2e1", fg: "#b42318" },
  ok: { bg: "#dcfce7", fg: "#15803d" },
};

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function renderEmail(i: EmailInput): { html: string; text: string } {
  const tone = TONE[i.tone];
  const brand = i.org.logoUrl
    ? `<img src="${esc(i.org.logoUrl)}" alt="${esc(i.org.name)}" height="40" style="display:block;height:40px;max-width:200px;border:0">`
    : `<span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:.2px">${esc(i.org.name)}</span>`;
  const details = i.details.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0 20px;border:1px solid #e5e7eb;border-radius:8px">
${i.details
  .map(
    ([k, v], n) =>
      `<tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;width:38%;${n ? "border-top:1px solid #eef0f3;" : ""}">${esc(k)}</td><td style="padding:10px 14px;font-size:14px;color:#111827;font-weight:600;${n ? "border-top:1px solid #eef0f3;" : ""}">${esc(v)}</td></tr>`,
  )
  .join("\n")}</table>`
    : "";
  const sections = (i.sections ?? [])
    .map(
      (s) => `<h3 style="margin:22px 0 8px;font-size:14px;color:#1f2a44;text-transform:uppercase;letter-spacing:.05em">${esc(s.title)} (${s.rows.length})</h3>
${
  s.rows.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb">${s.rows
        .map(
          (r, n) =>
            `<tr style="background:${n % 2 ? "#f9fafb" : "#ffffff"}"><td style="padding:8px 10px;font-size:13px;color:#111827;font-weight:600">${esc(r[0])}</td><td style="padding:8px 10px;font-size:13px;color:#374151">${esc(r[1])}</td><td style="padding:8px 10px;font-size:13px;color:#6b7280;text-align:right;white-space:nowrap">${esc(r[2])}</td></tr>`,
        )
        .join("")}</table>`
    : `<p style="margin:0;font-size:13px;color:#6b7280">${esc(s.empty)}</p>`
}`,
    )
    .join("\n");
  const cta = i.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="border-radius:6px;background:#c8102e"><a href="${esc(i.cta.url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:6px">${esc(i.cta.label)}</a></td></tr></table>`
    : "";
  const links = (i.links ?? []).length
    ? `<p style="margin:-12px 0 24px;font-size:14px;line-height:1.6">${i.links!.map((l) => `<a href="${esc(l.url)}" style="color:#1d4ed8;text-decoration:underline">${esc(l.label)}</a>`).join(" &middot; ")}</p>`
    : "";
  const contact = [i.org.phone && `Tel ${esc(i.org.phone)}`, i.org.email && `<a href="mailto:${esc(i.org.email)}" style="color:#6b7280">${esc(i.org.email)}</a>`]
    .filter(Boolean)
    .join(" &middot; ");

  const html = `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(i.heading)}</title></head>
<body style="margin:0;padding:0;background:#f1f3f6;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(i.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f3f6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)">
<tr><td style="background:#1f2a44;padding:20px 28px;border-bottom:4px solid #c8102e">${brand}</td></tr>
<tr><td style="padding:28px 28px 8px">
<span style="display:inline-block;padding:5px 10px;border-radius:999px;background:${tone.bg};color:${tone.fg};font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase">${esc(i.statusLabel)}</span>
<h1 style="margin:14px 0 16px;font-size:22px;line-height:1.3;color:#111827">${esc(i.heading)}</h1>
<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#374151">${esc(i.greeting)}</p>
${i.paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#374151">${esc(p)}</p>`).join("\n")}
${details}${sections}${cta}${links}
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151">${esc(i.closing).replace(/\n/g, "<br>")}</p>
</td></tr>
<tr><td style="padding:18px 28px 24px;background:#f9fafb;border-top:1px solid #eef0f3;font-size:12px;line-height:1.6;color:#6b7280">
<strong style="color:#374151">${esc(i.org.name)}</strong>${i.org.addressLine ? `<br>${esc(i.org.addressLine)}` : ""}${contact ? `<br>${contact}` : ""}${
    i.org.accreditations.length ? `<br>${esc(i.org.accreditations.join(" · "))}` : ""
  }
<br><br>${esc(i.footerReason)}${i.unsubscribeUrl ? ` <a href="${esc(i.unsubscribeUrl)}" style="color:#6b7280;text-decoration:underline">Unsubscribe from reminders</a>.` : ""}
</td></tr></table></td></tr></table></body></html>`;

  const text = [
    i.org.name.toUpperCase(),
    "",
    `[${i.statusLabel}] ${i.heading}`,
    "",
    i.greeting,
    "",
    ...i.paragraphs.flatMap((p) => [p, ""]),
    ...i.details.map(([k, v]) => `${k}: ${v}`),
    ...(i.sections ?? []).flatMap((s) => ["", `${s.title.toUpperCase()} (${s.rows.length})`, ...(s.rows.length ? s.rows.map((r) => `- ${r[0]} | ${r[1]} | ${r[2]}`) : [s.empty])]),
    ...(i.cta ? ["", `${i.cta.label}: ${i.cta.url}`] : []),
    ...(i.links ?? []).map((l) => `${l.label}: ${l.url}`),
    "",
    i.closing,
    "",
    "--",
    [i.org.name, i.org.addressLine, i.org.phone && `Tel ${i.org.phone}`, i.org.email].filter(Boolean).join("\n"),
    "",
    i.footerReason,
    ...(i.unsubscribeUrl ? [`Unsubscribe: ${i.unsubscribeUrl}`] : []),
  ].join("\n");
  return { html, text };
}

export function simplePage(title: string, heading: string, body: string, form?: { action: string; button: string }): string {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title></head>
<body style="margin:0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f1f3f6;color:#1f2933">
<div style="max-width:480px;margin:40px auto;padding:0 16px"><div style="background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:28px">
<h1 style="font-size:20px;margin:0 0 12px;color:#1f2a44">${esc(heading)}</h1><p style="font-size:15px;line-height:1.6;margin:0 0 18px">${esc(body)}</p>
${form ? `<form method="post" action="${esc(form.action)}"><button type="submit" style="background:#c8102e;color:#fff;border:0;border-radius:6px;padding:12px 20px;font-size:15px;font-weight:700;cursor:pointer">${esc(form.button)}</button></form>` : ""}
</div></div></body></html>`;
}

export function orgBlock(org: Doc<"organizations">, logoUrl: string | null): EmailInput["org"] {
  const a = org.address;
  return {
    name: org.name,
    logoUrl,
    addressLine: a ? [a.line1, a.line2, a.city, a.postcode].filter(Boolean).join(", ") : null,
    phone: org.phone ?? null,
    email: org.email ?? null,
    accreditations: (org.accreditations ?? []).map((x) => [x.body, x.scheme].filter(Boolean).join(" ")),
  };
}
