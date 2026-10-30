"use node";

/** A4 quote and invoice PDFs (same branding as certificates). Stored with a SHA-256 fingerprint. */
import { v } from "convex/values";
import { internalAction, ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { PDFDocument, StandardFonts, rgb, RGB } from "pdf-lib";
import { createHash } from "crypto";
import { formatDate } from "./lib/labels";
import { C, M, CW, wrap, fit, embedImage, loadStorage, drawQr, Writer, addressLines, drawOrgHeader, watermark, OrgBrand } from "./lib/pdfKit";

type QuoteData = NonNullable<Awaited<ReturnType<typeof loadQuote>>>;
type InvoiceData = NonNullable<Awaited<ReturnType<typeof loadInvoice>>>;
const loadQuote = (ctx: ActionCtx, quoteId: Id<"quotes">) => ctx.runQuery(internal.commercialDocs.quoteData, { quoteId });
const loadInvoice = (ctx: ActionCtx, invoiceId: Id<"invoices">) => ctx.runQuery(internal.commercialDocs.invoiceData, { invoiceId });
type Org = QuoteData["org"];
type Party = Pick<QuoteData, "client" | "site">;

/* ---------------- formatting (UK) ---------------- */

const money = (pence: number, currency = "GBP") => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(pence / 100);
const qtyFmt = (q: number) => (Number.isInteger(q) ? String(q) : q.toLocaleString("en-GB", { maximumFractionDigits: 2 }));
const pct = (p: number) => `${Number.isInteger(p) ? p : p.toFixed(2).replace(/0+$/, "")}%`;
const sortCodeFmt = (s: string) => s.replace(/^(\d{2})(\d{2})(\d{2})$/, "$1-$2-$3");
const KIND: Record<string, string> = { labour: "Labour", material: "Materials", equipment: "Equipment", service: "Service", other: "Other" };
const SEVERITY: Record<string, { label: string; color: RGB }> = {
  critical: { label: "CRITICAL", color: C.danger }, major: { label: "MAJOR", color: rgb(0.85, 0.33, 0.05) },
  minor: { label: "MINOR", color: C.amber }, advisory: { label: "ADVISORY", color: rgb(0.2, 0.4, 0.7) },
};
const METHOD: Record<string, string> = { bank_transfer: "Bank transfer", card: "Card", cash: "Cash", cheque: "Cheque", other: "Other" };

/** VAT per rate: [{rate, net, vat}], sorted high to low. */
function vatBreakdown(lines: { taxRate: number; lineTotal: number }[]) {
  const by = new Map<number, { net: number; vat: number }>();
  for (const l of lines) {
    const r = by.get(l.taxRate) ?? { net: 0, vat: 0 };
    r.net += l.lineTotal;
    r.vat += Math.round((l.lineTotal * l.taxRate) / 100);
    by.set(l.taxRate, r);
  }
  return [...by.entries()].sort((a, b) => b[0] - a[0]).map(([rate, x]) => ({ rate, ...x }));
}

/* ---------------- shared layout ---------------- */

async function setup(ctx: ActionCtx, org: Org, title: string, subject: string, keywords: string[], continued: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  doc.setTitle(title);
  doc.setAuthor(org.name);
  doc.setSubject(subject);
  doc.setCreator("Compliance platform");
  doc.setProducer("Compliance platform");
  doc.setKeywords(keywords);
  doc.setCreationDate(new Date());
  const logo = await loadStorage(ctx, org.logoId).then((b) => embedImage(doc, b));
  const w = new Writer(doc, font, bold, mono, (wr) => {
    wr.text(org.name, M, wr.y - 10, 10, { font: bold, color: C.navy });
    wr.textRight(continued, M + CW, wr.y - 10, 8, { color: C.grey });
    wr.page.drawLine({ start: { x: M, y: wr.y - 18 }, end: { x: M + CW, y: wr.y - 18 }, thickness: 1.2, color: C.red });
    wr.y -= 26;
  });
  w.addPage();
  drawOrgHeader(w, org as unknown as OrgBrand, logo);
  return { doc, font, bold, mono, w };
}

/** Navy title band: document name left, number right, optional status pill. */
function titleBand(w: Writer, title: string, sub: string, numberLabel: string, number: string, pill?: { text: string; color: RGB }) {
  const subLines = wrap(sub, w.font, 9, CW - 250).slice(0, 2);
  if (wrap(sub, w.font, 9, CW - 250).length > 2) subLines[1] = fit(subLines[1] + " …", w.font, 9, CW - 250);
  const bandH = 40 + subLines.length * 11;
  w.page.drawRectangle({ x: M, y: w.y - bandH, width: CW, height: bandH, color: C.navy });
  w.text(title, M + 12, w.y - 22, 15, { font: w.bold, color: C.white });
  subLines.forEach((l, i) => w.text(l, M + 12, w.y - 38 - i * 11, 9, { color: rgb(0.82, 0.86, 0.93) }));
  const mid = w.y - bandH / 2;
  w.textRight(numberLabel, M + CW - 12, mid + 8, 7, { font: w.bold, color: rgb(0.82, 0.86, 0.93) });
  w.textRight(number, M + CW - 12, mid - 9, 14, { font: w.bold, color: C.white });
  if (pill) {
    const tw = w.bold.widthOfTextAtSize(pill.text, 7.5) + 14;
    const nx = M + CW - 12 - w.bold.widthOfTextAtSize(number, 14) - 10 - tw;
    w.page.drawRectangle({ x: nx, y: mid - 12, width: tw, height: 15, color: pill.color });
    w.text(pill.text, nx + 7, mid - 7, 7.5, { font: w.bold, color: C.white });
  }
  w.y -= bandH + 12;
}

/** 3-column grid of key facts. Returns its bottom y. */
function factsGrid(w: Writer, facts: [string, string][], width: number) {
  const cellW = width / 3;
  const cellH = 32;
  const top = w.y;
  facts.forEach(([k, val], i) => {
    const cx = M + (i % 3) * cellW;
    const cy = top - Math.floor(i / 3) * cellH;
    w.page.drawRectangle({ x: cx, y: cy - cellH, width: cellW, height: cellH, color: C.light, borderColor: C.white, borderWidth: 1.5 });
    w.text(k.toUpperCase(), cx + 7, cy - 11, 6.5, { font: w.bold, color: C.grey });
    w.text(fit(val, w.bold, 9.5, cellW - 14), cx + 7, cy - 24, 9.5, { font: w.bold });
  });
  return top - Math.ceil(facts.length / 3) * cellH;
}

/** Two boxes side by side (client / site). */
function partyBoxes(w: Writer, left: { title: string; lines: string[] }, right: { title: string; lines: string[] }) {
  const colW = (CW - 12) / 2;
  const wrapCol = (lines: string[]) => lines.flatMap((l, i) => wrap(l, i === 0 ? w.bold : w.font, 8.5, colW - 16));
  const boxes = [{ ...left, l: wrapCol(left.lines), x: M }, { ...right, l: wrapCol(right.lines), x: M + colW + 12 }];
  const boxH = 22 + Math.max(...boxes.map((b) => b.l.length), 1) * 11;
  w.ensure(boxH + 10);
  w.y -= 6;
  for (const b of boxes) {
    w.page.drawRectangle({ x: b.x, y: w.y - boxH, width: colW, height: boxH, borderColor: C.line, borderWidth: 0.8, color: C.white });
    w.text(b.title, b.x + 8, w.y - 12, 6.5, { font: w.bold, color: C.grey });
    b.l.forEach((l, i) => w.text(l, b.x + 8, w.y - 25 - i * 11, 8.5, { font: i === 0 ? w.bold : w.font, color: i === 0 ? C.text : C.text }));
  }
  w.y -= boxH + 4;
}

function clientLines(p: Party) {
  const c = p.client.contact;
  return [p.client.name, ...addressLines(p.client.address), ...(c ? [`FAO ${c.name}${c.email ? ` · ${c.email}` : ""}`] : [])];
}
function siteLines(p: Party) {
  if (!p.site) return ["As billing address"];
  return [p.site.name + (p.site.reference ? ` (${p.site.reference})` : ""), ...addressLines(p.site.address)];
}

/** Right-aligned totals box. rows: [label, value, emphasis?] */
function totalsBox(w: Writer, rows: { label: string; value: string; strong?: boolean; color?: RGB }[], note?: string) {
  const bw = 250;
  const x = M + CW - bw;
  const rowH = 15;
  const noteLines = note ? note.split(/\n\n/).flatMap((para, i) => [...(i ? [""] : []), ...wrap(para.trim(), w.font, 7.5, CW - bw - 20)]) : [];
  const h = rows.length * rowH + 8;
  w.ensure(Math.max(h, noteLines.length * 10) + 8);
  w.y -= 6;
  const top = w.y;
  noteLines.forEach((l, i) => w.text(l, M, top - 10 - i * 10, 7.5, { color: C.grey }));
  w.page.drawRectangle({ x, y: top - h, width: bw, height: h, color: C.light });
  let y = top - 4;
  rows.forEach((r) => {
    if (r.strong) {
      w.page.drawRectangle({ x, y: y - rowH - 2, width: bw, height: rowH + 4, color: r.color ?? C.navy });
      w.text(r.label, x + 10, y - 11.5, 9.5, { font: w.bold, color: C.white });
      w.textRight(r.value, x + bw - 10, y - 11.5, 10.5, { font: w.bold, color: C.white });
    } else {
      w.text(r.label, x + 10, y - 10.5, 8.5, { color: r.color ?? C.text });
      w.textRight(r.value, x + bw - 10, y - 10.5, 8.5, { font: w.bold, color: r.color ?? C.text });
    }
    y -= rowH;
  });
  w.y = Math.min(top - h - 2, top - noteLines.length * 10 - 4);
}

function box(w: Writer, title: string, lines: { text: string; bold?: boolean; color?: RGB; mono?: boolean }[], opts: { accent?: RGB; minH?: number } = {}) {
  const wrapped = lines.flatMap((l) => wrap(l.text, l.mono ? w.mono : l.bold ? w.bold : w.font, 8.5, CW - 24).map((t) => ({ ...l, text: t })));
  const h = Math.max(opts.minH ?? 0, 24 + wrapped.length * 11);
  w.ensure(h + 8);
  w.y -= 8;
  w.page.drawRectangle({ x: M, y: w.y - h, width: CW, height: h, borderColor: opts.accent ?? C.line, borderWidth: opts.accent ? 1.2 : 0.8, color: C.white });
  if (opts.accent) w.page.drawRectangle({ x: M, y: w.y - h, width: 4, height: h, color: opts.accent });
  w.text(title, M + 12, w.y - 13, 6.5, { font: w.bold, color: opts.accent ?? C.grey });
  wrapped.forEach((l, i) => w.text(l.text, M + 12, w.y - 26 - i * 11, 8.5, { font: l.mono ? w.mono : l.bold ? w.bold : w.font, color: l.color ?? C.text }));
  const top = w.y;
  w.y -= h;
  return top;
}

function footers(w: Writer, org: Org, docLabel: string, line2: string) {
  const total = w.pages.length;
  const reg = [org.legalName ?? org.name, org.registrationNumber && `Company No. ${org.registrationNumber}`, org.vatNumber && `VAT Reg. No. ${org.vatNumber}`]
    .filter(Boolean).join("  ·  ");
  w.pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: M + 22 }, end: { x: M + CW, y: M + 22 }, thickness: 0.6, color: C.line });
    p.drawText(fit(`${reg}  ·  ${docLabel}`, w.bold, 7, CW - 80), { x: M, y: M + 12, size: 7, font: w.bold, color: C.grey });
    const pg = `Page ${i + 1} of ${total}`;
    p.drawText(pg, { x: M + CW - w.font.widthOfTextAtSize(pg, 7), y: M + 12, size: 7, font: w.font, color: C.grey });
    p.drawText(fit(line2, w.font, 6.5, CW), { x: M, y: M + 3, size: 6.5, font: w.font, color: C.grey });
  });
}

/* ---------------- quote ---------------- */

async function renderQuote(ctx: ActionCtx, d: QuoteData): Promise<Uint8Array> {
  const q = d.quote;
  const tz = d.org.timezone;
  const fd = (ms: number | null) => formatDate(ms, tz);
  const ref = `${q.quoteNumber}${q.revision ? ` rev ${q.revision}` : ""}`;
  const accepted = q.acceptance?.decision === "accepted" ? q.acceptance : null;
  const declined = q.acceptance?.decision === "declined" ? q.acceptance : null;
  const { doc, w } = await setup(ctx, d.org, `Quotation ${ref}`, `${q.title} for ${d.client.name}`, [q.quoteNumber, q.status], `Quotation ${ref} (continued)`);
  const sigImg = accepted?.signature?.signatureImageId ? await loadStorage(ctx, accepted.signature.signatureImageId).then((b) => embedImage(doc, b)) : null;

  const PILL: Record<string, { text: string; color: RGB }> = {
    draft: { text: "DRAFT", color: C.grey }, accepted: { text: "ACCEPTED", color: C.green }, declined: { text: "DECLINED", color: C.danger },
    expired: { text: "EXPIRED", color: C.amber }, superseded: { text: "SUPERSEDED", color: C.grey },
  };
  titleBand(w, "QUOTATION", q.title, q.revision ? `QUOTE NO. · REVISION ${q.revision}` : "QUOTE NO.", q.quoteNumber, PILL[q.status]);

  // facts + QR
  const qrW = 132;
  const gridW = d.acceptUrl ? CW - qrW - 12 : CW;
  const gridTop = w.y;
  const facts: [string, string][] = [
    ["Quote date", fd(q.sentAt ?? q.createdAt)],
    ["Valid until", fd(q.validUntil)],
    ["Revision", q.revision ? `${q.revision}${q.previousRevision ? ` (replaces ${q.previousRevision})` : ""}` : "Original"],
    ["Prepared for", d.client.contact?.name ?? d.client.name],
    ["Total (inc. VAT)", money(q.total, q.currency)],
    [accepted ? "Accepted" : declined ? "Declined" : "Job reference", accepted ? fd(accepted.decidedAt) : declined ? fd(declined.decidedAt) : (q.jobNumber ?? "-")],
  ];
  let bottom = factsGrid(w, facts, gridW);
  if (d.acceptUrl) {
    const qx = M + CW - qrW;
    const panelH = 2 * 32;
    w.page.drawRectangle({ x: qx, y: gridTop - panelH, width: qrW, height: panelH, borderColor: C.line, borderWidth: 0.8, color: C.white });
    const s = 58;
    drawQr(w.page, d.acceptUrl, qx + 3, gridTop - 3 - s, s);
    const tx = qx + s + 8;
    const open = q.status === "sent" || q.status === "viewed";
    const label = open ? ["SCAN TO VIEW", "AND ACCEPT", "Review, choose", "options and", "sign online."] : ["SCAN TO VIEW", "ONLINE", "View this quote", "and its status", "online."];
    label.forEach((t, i) => w.text(t, tx, gridTop - 14 - i * 9, i < 2 ? 7 : 6.5, { font: i < 2 ? w.bold : w.font, color: C.grey }));
    bottom = Math.min(bottom, gridTop - panelH);
  }
  w.y = bottom - 4;

  partyBoxes(w, { title: "QUOTE FOR", lines: clientLines(d) }, { title: "SITE / PREMISES", lines: siteLines(d) });

  if (q.introduction) {
    w.sectionTitle("Scope of works");
    w.paragraph(q.introduction);
  }

  if (d.defects.length) {
    w.sectionTitle(`Defects addressed by this quote (${d.defects.length})`, 50);
    w.y -= 2;
    w.table(
      [{ header: "REF", width: 62 }, { header: "SEVERITY", width: 62 }, { header: "DEFECT", width: 205 }, { header: "RECOMMENDED ACTION", width: CW - 329 }],
      d.defects.map((x) => {
        const s = SEVERITY[x.severity] ?? SEVERITY.advisory;
        return [{ text: x.reference, bold: true }, { text: s.label, color: s.color, bold: true }, { text: x.title + (x.siteName ? ` (${x.siteName})` : "") }, { text: x.recommendedAction ?? "-" }];
      }),
      "",
    );
  }

  const cols = [
    { header: "DESCRIPTION", width: 213 }, { header: "TYPE", width: 58 }, { header: "QTY", width: 38, align: "right" as const },
    { header: "UNIT PRICE", width: 66, align: "right" as const }, { header: "DISC.", width: 38, align: "right" as const },
    { header: "VAT", width: 38, align: "right" as const }, { header: "NET", width: CW - 451, align: "right" as const },
  ];
  const row = (l: QuoteData["lines"][number], muted = false) => {
    const c = muted ? C.grey : undefined;
    return [
      { text: l.description + (l.productCode ? `\nCode: ${l.productCode}` : ""), color: c }, { text: KIND[l.kind] ?? l.kind, color: c }, { text: qtyFmt(l.quantity), color: c },
      { text: money(l.unitPrice, q.currency), color: c }, { text: l.discountPercent ? pct(l.discountPercent) : "-", color: c }, { text: pct(l.taxRate), color: c },
      { text: money(l.lineTotal, q.currency), bold: !muted, color: c },
    ];
  };
  const required = d.lines.filter((l) => !l.optional);
  const optional = d.lines.filter((l) => l.optional);
  w.sectionTitle("Quotation", 60);
  w.y -= 2;
  w.table(cols, required.map((l) => row(l)), "No items.");
  if (optional.length) {
    const decided = !!accepted;
    w.sectionTitle(`Optional items (${optional.length})`, 95);
    w.paragraph(decided ? "Optional items selected by the client on acceptance are included in the total; unselected items are shown for reference only." : "These items are optional. They are included in the total below unless you deselect them when accepting online.", 7.5, C.grey);
    w.y -= 4;
    w.table(
      [...cols.slice(0, 6), { header: decided ? "STATUS / NET" : "OPTIONAL / NET", width: CW - 451 }].map((c, i) => (i === 6 ? { ...c, align: "right" as const } : c)),
      optional.map((l) => {
        const r = row(l, decided && !l.selected);
        r[6] = { text: `${decided ? (l.selected ? "SELECTED" : "NOT SELECTED") : "OPTIONAL"}\n${money(l.lineTotal, q.currency)}`, bold: true, color: decided ? (l.selected ? C.green : C.grey) : C.amber };
        return r;
      }),
      "",
    );
  }

  // totals (included lines only)
  const inc = d.lines.filter((l) => !l.optional || l.selected);
  const vat = vatBreakdown(inc);
  const net = q.subtotal - q.discountTotal;
  totalsBox(
    w,
    [
      ...(q.discountTotal ? [{ label: "Subtotal (before discount)", value: money(q.subtotal, q.currency) }, { label: "Discount", value: `-${money(q.discountTotal, q.currency)}` }] : []),
      { label: "Net total", value: money(net, q.currency) },
      ...vat.map((x) => ({ label: `VAT @ ${pct(x.rate)} on ${money(x.net, q.currency)}`, value: money(x.vat, q.currency) })),
      { label: `TOTAL (${q.currency})`, value: money(q.total, q.currency), strong: true },
    ],
    `All prices in ${q.currency === "GBP" ? "pounds sterling (GBP)" : q.currency}. ${d.org.vatNumber ? `VAT charged at the rates shown (VAT Reg. No. ${d.org.vatNumber}).` : ""}`,
  );

  // acceptance
  if (accepted) {
    const s = accepted.signature;
    const h = 96;
    w.ensure(h + 30);
    w.sectionTitle("Acceptance record");
    const top = box(
      w, "ACCEPTED BY THE CLIENT",
      [
        { text: s?.signedByName ?? "-", bold: true },
        { text: [s?.signedByRole, `on behalf of ${d.client.name}`].filter(Boolean).join(", ") },
        { text: `Accepted ${fd(accepted.decidedAt)} ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(accepted.decidedAt))} (${tz === "Europe/London" ? "UK time" : tz})` },
        { text: `Purchase order: ${accepted.purchaseOrderNumber ?? "not provided"}` },
        ...(s?.contentHash ? [{ text: `Signed content fingerprint (SHA-256): ${s.contentHash.slice(0, 32)}…`, mono: false, color: C.grey }] : []),
      ],
      { accent: C.green, minH: h },
    );
    const sx = M + CW - 200;
    w.page.drawLine({ start: { x: sx, y: top - h + 24 }, end: { x: M + CW - 14, y: top - h + 24 }, thickness: 0.6, color: C.line });
    w.text("SIGNATURE", sx, top - h + 13, 6.5, { font: w.bold, color: C.grey });
    if (sigImg) {
      const sc = Math.min(186 / sigImg.width, 52 / sigImg.height);
      w.page.drawImage(sigImg, { x: sx, y: top - h + 26, width: sigImg.width * sc, height: sigImg.height * sc });
    } else w.text("Signed electronically", sx, top - h + 32, 8.5, { color: C.grey });
  } else if (declined) {
    w.sectionTitle("Client response");
    box(w, "DECLINED", [{ text: `Declined ${fd(declined.decidedAt)}`, bold: true }, ...(declined.declineReason ? [{ text: `Reason: ${declined.declineReason}` }] : [])], { accent: C.danger });
  } else if (d.acceptUrl && (q.status === "sent" || q.status === "viewed")) {
    w.sectionTitle("How to accept");
    box(w, "ACCEPT ONLINE", [
      { text: `Scan the QR code above or visit the link below to review this quote, choose any optional items, and accept with your signature${q.validUntil ? ` before ${fd(q.validUntil)}` : ""}. You can add your purchase order number when accepting.` },
      { text: d.acceptUrl, bold: true, color: rgb(0.11, 0.3, 0.85) },
    ], { accent: C.navy });
  }

  const terms = q.terms ?? d.org.quoteTerms ??
    `This quotation is valid until ${fd(q.validUntil)} and is subject to a site survey where stated. Prices exclude VAT unless stated and are based on works being carried out during normal working hours (Mon-Fri, 08:00-17:00) with clear access. Any additional works found to be necessary will be quoted separately. Payment terms: 30 days from date of invoice.`;
  w.sectionTitle("Terms and conditions");
  w.paragraph(terms, 7.5, C.grey);

  const mark = q.status === "draft" ? ["DRAFT", C.grey] : q.status === "superseded" ? ["SUPERSEDED", C.grey] : q.status === "expired" ? ["EXPIRED", C.amber] : q.status === "declined" ? ["DECLINED", C.danger] : null;
  if (mark) for (const p of w.pages) watermark(p, w.bold, mark[0] as string, mark[1] as RGB);
  footers(w, d.org, `Quotation ${ref}`, d.acceptUrl ? `View and respond online: ${d.acceptUrl}` : "Draft quotation - not yet issued");
  return await doc.save();
}

/* ---------------- invoice ---------------- */

async function renderInvoice(ctx: ActionCtx, d: InvoiceData): Promise<Uint8Array> {
  const inv = d.invoice;
  const cur = inv.currency;
  const fd = (ms: number | null) => formatDate(ms, d.org.timezone);
  const docName = d.org.vatNumber ? "TAX INVOICE" : "INVOICE";
  const { doc, w } = await setup(ctx, d.org, `Invoice ${inv.invoiceNumber}`, `Invoice for ${d.client.name}`, [inv.invoiceNumber, inv.status], `Invoice ${inv.invoiceNumber} (continued)`);
  const PILL: Record<string, { text: string; color: RGB }> = {
    draft: { text: "DRAFT", color: C.grey }, paid: { text: "PAID", color: C.green }, void: { text: "VOID", color: C.danger },
    partially_paid: { text: "PART PAID", color: C.amber },
  };
  const pill = inv.overdue ? { text: "OVERDUE", color: C.danger } : PILL[inv.status];
  const po = d.quote?.purchaseOrderNumber ?? d.job?.purchaseOrderNumber ?? null;
  titleBand(w, docName, d.site ? `Works at ${d.site.name}` : d.client.name, "INVOICE NO.", inv.invoiceNumber, pill);

  // facts + amount-due panel
  const panelW = 150;
  const gridW = CW - panelW - 12;
  const top = w.y;
  const bottom = factsGrid(w, [
    ["Invoice date / tax point", fd(inv.issuedAt)],
    ["Due date", fd(inv.dueAt)],
    ["Payment terms", inv.paymentTermsDays === 0 ? "Due on receipt" : `${inv.paymentTermsDays} days`],
    ["Job reference", d.job?.jobNumber ?? "-"],
    ["Quote reference", d.quote ? `${d.quote.quoteNumber}${d.quote.revision ? ` rev ${d.quote.revision}` : ""}` : "-"],
    ["Your PO number", po ?? "-"],
  ], gridW);
  const px = M + CW - panelW;
  const ph = top - bottom;
  const settled = inv.status === "paid";
  const pc = inv.status === "void" ? C.grey : settled ? C.green : inv.overdue ? C.danger : C.navy;
  w.page.drawRectangle({ x: px, y: bottom, width: panelW, height: ph, color: pc });
  w.text(inv.status === "void" ? "VOID - NOTHING TO PAY" : settled ? "PAID IN FULL" : "BALANCE DUE", px + 10, top - 15, 7, { font: w.bold, color: C.white });
  w.text(money(inv.status === "void" ? 0 : inv.balance, cur), px + 10, top - 37, 17, { font: w.bold, color: C.white });
  w.text(fit(settled ? `Paid ${fd(inv.paidAt)}` : inv.status === "void" ? "This invoice has been cancelled" : inv.dueAt ? `${inv.overdue ? "Was due" : "Due by"} ${fd(inv.dueAt)}` : "On receipt", w.font, 8, panelW - 20), px + 10, top - 53, 8, { color: C.white });
  w.y = bottom - 4;

  partyBoxes(w, { title: "BILL TO", lines: clientLines(d) }, { title: "SITE / PREMISES", lines: siteLines(d) });

  w.sectionTitle("Details", 60);
  w.y -= 2;
  const anyDisc = d.lines.some((l) => l.discountPercent);
  w.table(
    [
      { header: "DESCRIPTION", width: anyDisc ? 228 : 268 }, { header: "QTY", width: 45, align: "right" }, { header: "UNIT PRICE", width: 72, align: "right" },
      ...(anyDisc ? [{ header: "DISC.", width: 40, align: "right" as const }] : []),
      { header: "VAT RATE", width: 52, align: "right" }, { header: "NET AMOUNT", width: CW - 437, align: "right" },
    ],
    d.lines.map((l) => [
      { text: l.description }, { text: qtyFmt(l.quantity) }, { text: money(l.unitPrice, cur) },
      ...(anyDisc ? [{ text: l.discountPercent ? pct(l.discountPercent) : "-" }] : []),
      { text: pct(l.taxRate) }, { text: money(l.lineTotal, cur), bold: true },
    ]),
    "No lines.",
  );

  const vat = vatBreakdown(d.lines);
  const termsText = d.org.invoiceFooter ??
    `Payment is due ${inv.paymentTermsDays === 0 ? "on receipt" : `within ${inv.paymentTermsDays} days of the invoice date`}. Please quote the invoice number with your payment. We reserve the right to claim interest and compensation for late payment under the Late Payment of Commercial Debts (Interest) Act 1998.`;
  totalsBox(
    w,
    [
      { label: "Net total", value: money(inv.subtotal, cur) },
      ...vat.map((x) => ({ label: `VAT @ ${pct(x.rate)} on ${money(x.net, cur)}`, value: money(x.vat, cur) })),
      { label: `TOTAL (${cur})`, value: money(inv.total, cur), strong: true },
      ...(inv.amountPaid ? [{ label: "Less payments received", value: `-${money(inv.amountPaid, cur)}`, color: C.green }] : []),
      ...(inv.status !== "void" ? [{ label: "BALANCE DUE", value: money(inv.balance, cur), strong: true, color: settled ? C.green : inv.overdue ? C.danger : C.red }] : []),
    ],
    [
      inv.discountTotal ? `Includes discounts of ${money(inv.discountTotal, cur)}.` : "",
      `All amounts in ${cur === "GBP" ? "pounds sterling (GBP)" : cur}.`,
      d.org.vatNumber ? `VAT Reg. No. ${d.org.vatNumber}.` : "",
      "\n\n" + termsText,
    ].filter(Boolean).join(" "),
  );

  if (inv.payments.length) {
    w.sectionTitle(`Payments received (${inv.payments.length})`, 40);
    w.y -= 2;
    w.table(
      [{ header: "DATE", width: 100 }, { header: "METHOD", width: 110 }, { header: "REFERENCE", width: CW - 310 }, { header: "AMOUNT", width: 100, align: "right" }],
      inv.payments.map((p) => [{ text: fd(p.paidAt) }, { text: METHOD[p.method] ?? p.method }, { text: p.reference ?? "-" }, { text: money(p.amount, cur), bold: true, color: C.green }]),
      "",
    );
  }

  if (inv.status === "void") {
    w.sectionTitle("Cancelled");
    box(w, "THIS INVOICE IS VOID", [{ text: `Reason: ${inv.voidReason ?? "-"}` }, { text: "No payment is due against this invoice." }], { accent: C.danger });
  } else if (!settled) {
    const b = d.org.bankDetails;
    const lines: { text: string; bold?: boolean; color?: RGB }[] = [];
    if (b && (b.accountNumber || b.iban)) {
      if (b.accountName) lines.push({ text: `Account name: ${b.accountName}`, bold: true });
      if (b.bankName) lines.push({ text: `Bank: ${b.bankName}` });
      if (b.sortCode || b.accountNumber) lines.push({ text: [b.sortCode && `Sort code: ${sortCodeFmt(b.sortCode)}`, b.accountNumber && `Account number: ${b.accountNumber}`].filter(Boolean).join("   ·   "), bold: true });
      if (b.iban || b.bic) lines.push({ text: [b.iban && `IBAN: ${b.iban.replace(/(.{4})/g, "$1 ").trim()}`, b.bic && `BIC: ${b.bic}`].filter(Boolean).join("   ·   ") });
    } else lines.push({ text: `Please contact ${d.org.email ?? d.org.name} for payment details.`, color: C.grey });
    lines.push({ text: `Payment reference: ${inv.invoiceNumber}`, bold: true, color: C.red });
    if (b?.paymentInstructions) lines.push({ text: b.paymentInstructions });
    w.y -= 6;
    box(w, "HOW TO PAY  ·  BANK TRANSFER (BACS / FASTER PAYMENTS)", lines, { accent: C.navy });
  }

  if (inv.notes && inv.notes.trim() !== `PO: ${po}`) {
    w.sectionTitle("Notes");
    w.paragraph(inv.notes);
  }

  const mark = inv.status === "paid" ? ["PAID", C.green] : inv.status === "void" ? ["VOID", C.danger] : inv.status === "draft" ? ["DRAFT", C.grey] : null;
  if (mark) for (const p of w.pages) watermark(p, w.bold, mark[0] as string, mark[1] as RGB);
  footers(w, d.org, `Invoice ${inv.invoiceNumber}`, `Questions about this invoice? ${[d.org.email, d.org.phone].filter(Boolean).join(" · ") || d.org.name}  ·  Payment reference: ${inv.invoiceNumber}`);
  return await doc.save();
}

/* ---------------- actions ---------------- */

async function store(ctx: ActionCtx, bytes: Uint8Array) {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storageId = await ctx.storage.store(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  return { storageId, sha256, bytes: bytes.length };
}

export const generateQuote = internalAction({
  args: { quoteId: v.id("quotes") },
  handler: async (ctx, { quoteId }) => {
    try {
      const d = await loadQuote(ctx, quoteId);
      if (!d) throw new Error("Quote not found");
      const r = await store(ctx, await renderQuote(ctx, d));
      await ctx.runMutation(internal.commercialDocs.savePdf, { quoteId, ...r });
      return r;
    } catch (e) {
      await ctx.runMutation(internal.commercialDocs.markPdfFailed, { quoteId, error: String(e) });
      throw e;
    }
  },
});

export const generateInvoice = internalAction({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    try {
      const d = await loadInvoice(ctx, invoiceId);
      if (!d) throw new Error("Invoice not found");
      const r = await store(ctx, await renderInvoice(ctx, d));
      await ctx.runMutation(internal.commercialDocs.savePdf, { invoiceId, ...r });
      return r;
    } catch (e) {
      await ctx.runMutation(internal.commercialDocs.markPdfFailed, { invoiceId, error: String(e) });
      throw e;
    }
  },
});

