import { CertificateVerification, buildAssetStatus, buildSiteStatus } from "./verification";
import { disciplineLabel, formatDate, RESULT_LABELS } from "./labels";
import { formatToken } from "./tokens";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const STATUS_STYLE: Record<string, { label: string; color: string; icon: string; note: string }> = {
  issued: { label: "VALID", color: "#15803d", icon: "&#10003;", note: "This certificate is genuine and currently valid." },
  expired: { label: "EXPIRED", color: "#b45309", icon: "!", note: "This certificate is genuine but has passed its expiry date." },
  superseded: { label: "SUPERSEDED", color: "#b45309", icon: "!", note: "This certificate has been replaced by a newer version." },
  revoked: { label: "REVOKED", color: "#b91c1c", icon: "&#10007;", note: "This certificate has been withdrawn by the issuer and must not be relied on." },
  notfound: { label: "NOT FOUND", color: "#b91c1c", icon: "?", note: "No issued certificate matches this code. It may be mistyped, or the document may not be genuine." },
};

function shell(title: string, issuer: string | null, logoUrl: string | null, body: string): string {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title><style>
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f1f3f6;color:#1f2933}
.wrap{max-width:560px;margin:0 auto;padding:20px 16px 40px}.brand{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.brand img{max-height:44px;max-width:160px}.brand .name{font-weight:700;font-size:18px;color:#1f2a44}
.card{background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);overflow:hidden}
.status{color:#fff;padding:18px 20px;display:flex;align-items:center;gap:14px}.status .icon{font-size:28px;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-weight:700}
.status .label{font-size:22px;font-weight:800;letter-spacing:.04em}.status .note{font-size:13px;opacity:.95;margin-top:2px}
dl{margin:0;padding:8px 20px 16px}dl div{display:flex;justify-content:space-between;gap:16px;padding:9px 0;border-bottom:1px solid #eef0f3;font-size:14px}
dl div:last-child{border-bottom:0}dt{color:#6b7280}dd{margin:0;text-align:right;font-weight:600}
h2{font-size:14px;color:#6b7280;margin:18px 20px 0;text-transform:uppercase;letter-spacing:.06em}
.foot{font-size:12px;color:#6b7280;margin-top:16px;line-height:1.5}.hash{font-family:ui-monospace,Menlo,monospace;font-size:11px;word-break:break-all;color:#6b7280}
</style></head><body><div class="wrap"><div class="brand">${logoUrl ? `<img src="${esc(logoUrl)}" alt="">` : ""}<div class="name">${esc(issuer ?? "Compliance verification")}</div></div>
${body}<div class="foot">Only non-sensitive details are shown here. Compare them with your printed document; if anything differs, contact the issuing company.</div></div></body></html>`;
}

function statusBanner(key: string) {
  const s = STATUS_STYLE[key] ?? STATUS_STYLE.notfound;
  return `<div class="status" style="background:${s.color}"><div class="icon">${s.icon}</div><div><div class="label">${s.label}</div><div class="note">${s.note}</div></div></div>`;
}
const row = (k: string, v: unknown) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`;

export function renderCertificatePage(v: CertificateVerification, token: string): string {
  if (!v.found) {
    return shell("Certificate not found", null, null, `<div class="card">${statusBanner("notfound")}<dl>${row("Code checked", formatToken(token))}</dl></div>`);
  }
  let rows =
    row("Certificate No.", v.certificateNumber) +
    row("Type", v.certificateType ?? disciplineLabel(v.discipline)) +
    (v.standard ? row("Standard", v.standard) : "") +
    row("Discipline", disciplineLabel(v.discipline)) +
    row("Result", RESULT_LABELS[v.overallResult] ?? v.overallResult) +
    row("Premises", [v.siteName, v.siteTown].filter(Boolean).join(", ")) +
    row("Inspection date", formatDate(v.inspectionDate)) +
    row("Issued", formatDate(v.issuedAt)) +
    row("Valid until", formatDate(v.expiresAt)) +
    (v.nextInspectionDueAt ? row("Next inspection due", formatDate(v.nextInspectionDueAt)) : "") +
    (v.engineerName ? row("Signed by", `${v.engineerName}${v.signedAt ? " · " + formatDate(v.signedAt) : ""}`) : "") +
    row("Issued by", v.issuedBy) +
    (v.accreditations.length ? row("Accreditations", v.accreditations.join(", ")) : "");
  if (v.status === "superseded" && v.supersededByNumber) rows += row("Replaced by", v.supersededByNumber);
  if (v.status === "revoked" && v.revokedReason) rows += row("Reason", v.revokedReason);
  const hash = v.pdfHash ? `<h2>Document fingerprint (SHA-256)</h2><dl><div><dd class="hash" style="text-align:left">${esc(v.pdfHash)}</dd></div></dl>` : "";
  return shell(`Certificate ${v.certificateNumber}`, v.issuedBy, v.orgLogoUrl, `<div class="card">${statusBanner(v.status)}<dl>${rows}</dl>${hash}</div>`);
}

type CertSummary = { certificateNumber: string; status: string; expiresAt: number | null; discipline: string; nextDueAt: number | null };
function certList(certs: CertSummary[]) {
  if (!certs.length) return `<dl>${row("Certificates", "None issued yet")}</dl>`;
  return `<dl>${certs
    .map((c) => row(disciplineLabel(c.discipline), `${c.certificateNumber} · ${c.status === "issued" ? "valid" : c.status} until ${formatDate(c.expiresAt)}`))
    .join("")}</dl>`;
}

export function renderAssetPage(a: Awaited<ReturnType<typeof buildAssetStatus>>, tag: string): string {
  if (!a) return shell("Asset not found", null, null, `<div class="card">${statusBanner("notfound")}<dl>${row("Tag checked", formatToken(tag))}</dl></div>`);
  const ok = a.status === "in_service" && a.lastResult !== "fail" && (a.nextDueAt === null || a.nextDueAt >= Date.now());
  const banner = `<div class="status" style="background:${ok ? "#15803d" : "#b45309"}"><div class="icon">${ok ? "&#10003;" : "!"}</div><div><div class="label">${ok ? "IN SERVICE" : "ATTENTION"}</div><div class="note">${ok ? "This device is in service and within its inspection interval." : "This device is overdue, defective or out of service. Please contact the service company."}</div></div></div>`;
  const rows =
    row("Device", a.reference) +
    (a.assetType ? row("Type", a.assetType) : "") +
    row("System", disciplineLabel(a.discipline)) +
    (a.location ? row("Location", a.location) : "") +
    row("Premises", [a.siteName, a.siteTown].filter(Boolean).join(", ")) +
    row("Last inspected", formatDate(a.lastInspectedAt)) +
    row("Last result", a.lastResult ? a.lastResult.replace("_", " ") : "-") +
    row("Next due", formatDate(a.nextDueAt)) +
    row("Maintained by", a.issuedBy);
  return shell(`Device ${a.reference}`, a.issuedBy, a.orgLogoUrl, `<div class="card">${banner}<dl>${rows}</dl><h2>Current certificate</h2>${certList(a.certificates)}</div>`);
}

export function renderSitePage(s: Awaited<ReturnType<typeof buildSiteStatus>>, token: string): string {
  if (!s) return shell("Premises not found", null, null, `<div class="card">${statusBanner("notfound")}<dl>${row("Code checked", formatToken(token))}</dl></div>`);
  const allValid = s.certificates.length > 0 && s.certificates.every((c) => c.status === "issued");
  const banner = `<div class="status" style="background:${allValid ? "#15803d" : "#b45309"}"><div class="icon">${allValid ? "&#10003;" : "!"}</div><div><div class="label">${esc(s.siteName)}</div><div class="note">${allValid ? "All recorded certificates are currently valid." : "One or more systems need attention or have no current certificate."}</div></div></div>`;
  return shell(`Premises ${s.siteName}`, s.issuedBy, s.orgLogoUrl, `<div class="card">${banner}<dl>${row("Premises", [s.siteName, s.siteTown].filter(Boolean).join(", "))}${row("Maintained by", s.issuedBy)}</dl><h2>Certificates</h2>${certList(s.certificates)}</div>`);
}
