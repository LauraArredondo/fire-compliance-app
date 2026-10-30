"use node";

import { v } from "convex/values";
import { internalAction, action, ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { PDFDocument, StandardFonts, rgb, RGB, PDFFont } from "pdf-lib";
import { createHash } from "crypto";
import { disciplineLabel, formatDate, RESULT_LABELS } from "./lib/labels";
import { formatToken } from "./lib/tokens";
import { assetVerifyUrl, siteVerifyUrl } from "./lib/verification";

import { C, M, CW, PAGE_W, PAGE_H, clean, wrap, fit, embedImage, loadStorage, drawQr, Writer, addressLines, drawOrgHeader } from "./lib/pdfKit";


const SEVERITY: Record<string, { label: string; color: RGB }> = {
  critical: { label: "CRITICAL", color: C.danger },
  major: { label: "MAJOR", color: rgb(0.85, 0.33, 0.05) },
  minor: { label: "MINOR", color: C.amber },
  advisory: { label: "ADVISORY", color: rgb(0.2, 0.4, 0.7) },
};
const ASSET_RESULT: Record<string, { label: string; color: RGB }> = {
  pass: { label: "Pass", color: C.green },
  fail: { label: "Fail", color: C.danger },
  advisory: { label: "Advisory", color: C.amber },
  not_tested: { label: "Not tested", color: C.grey },
};
const RESULT_COLOR: Record<string, RGB> = {
  satisfactory: C.green,
  unsatisfactory: C.danger,
  satisfactory_with_observations: C.amber,
};

/* ------------------------------------------------------------------ */
/* Certificate renderer                                                */
/* ------------------------------------------------------------------ */

type RenderData = NonNullable<Awaited<ReturnType<typeof loadRenderData>>>;
async function loadRenderData(ctx: ActionCtx, certificateId: Id<"certificates">) {
  return await ctx.runQuery(internal.certificates.getRenderData, { certificateId });
}


async function renderCertificate(ctx: ActionCtx, d: RenderData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const tz = d.org.timezone || "Europe/London";
  const fd = (ms: number | null) => formatDate(ms, tz);
  const certNo = d.cert.certificateNumber;

  doc.setTitle(`${d.type.name} - ${certNo}`);
  doc.setAuthor(d.org.name);
  doc.setSubject(`${d.type.standard ?? disciplineLabel(d.cert.discipline)} certificate for ${d.site.name}`);
  doc.setCreator("Compliance platform");
  doc.setProducer("Compliance platform");
  doc.setKeywords([certNo, d.cert.verificationToken]);
  doc.setCreationDate(new Date(d.cert.issuedAt ?? Date.now()));

  const [logo, engSig, cliSig] = await Promise.all([
    loadStorage(ctx, d.org.logoId).then((b) => embedImage(doc, b)),
    loadStorage(ctx, d.cert.engineerSignature?.signatureImageId).then((b) => embedImage(doc, b)),
    loadStorage(ctx, d.cert.clientSignature?.signatureImageId).then((b) => embedImage(doc, b)),
  ]);

  const w = new Writer(doc, font, bold, mono, (wr) => {
    // continuation header
    wr.text(d.org.name, M, wr.y - 10, 10, { font: bold, color: C.navy });
    wr.textRight(`${d.type.name} · ${certNo} (continued)`, M + CW, wr.y - 10, 8, { color: C.grey });
    wr.page.drawLine({ start: { x: M, y: wr.y - 18 }, end: { x: M + CW, y: wr.y - 18 }, thickness: 1.2, color: C.red });
    wr.y -= 26;
  });
  w.addPage();

  drawOrgHeader(w, d.org, logo);


  /* ---- Title band ---- */
  const titleLines = wrap(d.type.name, bold, 13, CW - 175).slice(0, 3);
  const bandH = 30 + titleLines.length * 16;
  w.page.drawRectangle({ x: M, y: w.y - bandH, width: CW, height: bandH, color: C.navy });
  titleLines.forEach((l, i) => w.text(l, M + 12, w.y - 20 - i * 16, 13, { font: bold, color: C.white }));
  const sub = d.type.standard ? `In accordance with ${d.type.standard}` : disciplineLabel(d.cert.discipline);
  w.text(fit(sub, font, 9, CW - 175), M + 12, w.y - bandH + 11, 9, { color: rgb(0.82, 0.86, 0.93) });
  w.textRight("CERTIFICATE NO.", M + CW - 12, w.y - bandH / 2 + 8, 7, { font: bold, color: rgb(0.82, 0.86, 0.93) });
  w.textRight(certNo, M + CW - 12, w.y - bandH / 2 - 9, 14, { font: bold, color: C.white });
  w.y -= bandH + 12;

  /* ---- Key facts (left) + QR panel (right) ---- */
  const qrPanelW = 132;
  const gridW = CW - qrPanelW - 12;
  const facts: [string, string][] = [
    ["Discipline", disciplineLabel(d.cert.discipline)],
    ["Date of inspection", fd(d.cert.inspectionDate)],
    ["Date of issue", fd(d.cert.issuedAt)],
    ["Valid until", fd(d.cert.expiresAt)],
    ["Next inspection due", fd(d.cert.nextInspectionDueAt)],
    ["Job / PO reference", [d.job?.jobNumber, d.job?.purchaseOrderNumber].filter(Boolean).join(" / ") || "-"],
  ];
  const cellW = gridW / 3;
  const cellH = 32;
  const gridTop = w.y;
  facts.forEach(([k, val], i) => {
    const cx = M + (i % 3) * cellW;
    const cy = gridTop - Math.floor(i / 3) * cellH;
    w.page.drawRectangle({ x: cx, y: cy - cellH, width: cellW, height: cellH, color: C.light, borderColor: C.white, borderWidth: 1.5 });
    w.text(k.toUpperCase(), cx + 7, cy - 11, 6.5, { font: bold, color: C.grey });
    w.text(fit(val, bold, 9.5, cellW - 14), cx + 7, cy - 24, 9.5, { font: bold });
  });
  // overall result strip
  const resultY = gridTop - 2 * cellH - 6;
  const rColor = RESULT_COLOR[d.cert.overallResult] ?? C.grey;
  w.page.drawRectangle({ x: M, y: resultY - 30, width: gridW, height: 30, color: rColor });
  w.text("OVERALL RESULT", M + 10, resultY - 12, 7, { font: bold, color: C.white });
  w.text((RESULT_LABELS[d.cert.overallResult] ?? d.cert.overallResult).toUpperCase(), M + 10, resultY - 25, 11, { font: bold, color: C.white });
  const counts = { pass: 0, fail: 0, other: 0 };
  d.assets.forEach((a) => (a.result === "pass" ? counts.pass++ : a.result === "fail" ? counts.fail++ : counts.other++));
  const openDefects = d.defects.filter((x) => !["resolved", "verified", "closed_no_action"].includes(x.status)).length;
  w.textRight(`${d.assets.length} devices · ${counts.pass} pass · ${counts.fail} fail · ${openDefects} open defects`, M + gridW - 10, resultY - 12, 7, {
    font: bold,
    color: C.white,
  });

  // QR panel
  const qx = M + CW - qrPanelW;
  const panelH = 2 * cellH + 36;
  w.page.drawRectangle({ x: qx, y: gridTop - panelH, width: qrPanelW, height: panelH, borderColor: C.line, borderWidth: 0.8, color: C.white });
  const qrSize = 74;
  drawQr(w.page, d.verifyUrl, qx + 6, gridTop - 6 - qrSize, qrSize);
  const tx = qx + qrSize + 10;
  w.text("SCAN TO", tx, gridTop - 18, 7, { font: bold, color: C.grey });
  w.text("VERIFY", tx, gridTop - 27, 7, { font: bold, color: C.grey });
  w.text("Checks this", tx, gridTop - 42, 6.5, { color: C.grey });
  w.text("certificate is", tx, gridTop - 50, 6.5, { color: C.grey });
  w.text("genuine and", tx, gridTop - 58, 6.5, { color: C.grey });
  w.text("current.", tx, gridTop - 66, 6.5, { color: C.grey });
  w.text("VERIFICATION CODE", qx + 6, gridTop - qrSize - 14, 6, { font: bold, color: C.grey });
  w.text(formatToken(d.cert.verificationToken), qx + 6, gridTop - qrSize - 24, 8.5, { font: mono, color: C.navy });
  w.y = Math.min(resultY - 30, gridTop - panelH) - 6;

  /* ---- Client & premises ---- */
  const colW = (CW - 12) / 2;
  const clientLines = [d.client.name, ...addressLines(d.client.address)];
  const rp = d.site.responsiblePerson;
  const siteLines = [
    d.site.name + (d.site.reference ? ` (${d.site.reference})` : ""),
    ...addressLines(d.site.address),
    ...(rp ? [`Responsible person: ${rp.name}${rp.phone ? ", " + rp.phone : ""}`] : []),
  ];
  const wrapCol = (lines: string[]) => lines.flatMap((l, i) => wrap(l, i === 0 ? bold : font, 8.5, colW - 16));
  const cl = wrapCol(clientLines);
  const sl = wrapCol(siteLines);
  const boxH = 22 + Math.max(cl.length, sl.length) * 11;
  w.ensure(boxH + 10);
  w.y -= 6;
  [
    { title: "CLIENT", lines: cl, x: M },
    { title: "PREMISES / SITE", lines: sl, x: M + colW + 12 },
  ].forEach((b) => {
    w.page.drawRectangle({ x: b.x, y: w.y - boxH, width: colW, height: boxH, borderColor: C.line, borderWidth: 0.8, color: C.white });
    w.text(b.title, b.x + 8, w.y - 12, 6.5, { font: bold, color: C.grey });
    b.lines.forEach((l, i) => w.text(l, b.x + 8, w.y - 25 - i * 11, 8.5, { font: i === 0 ? bold : font }));
  });
  w.y -= boxH + 4;

  /* ---- Summary ---- */
  if (d.cert.summary) {
    w.sectionTitle("Summary of work and system");
    w.paragraph(d.cert.summary);
  }

  /* ---- Assets ---- */
  w.sectionTitle(`Devices / assets inspected (${d.assets.length})`, 70);
  w.y -= 2;
  w.table(
    [
      { header: "REF", width: 70 },
      { header: "TYPE", width: 140 },
      { header: "DESCRIPTION", width: 150 },
      { header: "LOCATION", width: 102 },
      { header: "RESULT", width: CW - 462 },
    ],
    d.assets.map((a) => {
      const r = ASSET_RESULT[a.result] ?? ASSET_RESULT.not_tested;
      return [{ text: a.reference, bold: true }, { text: a.type }, { text: a.description }, { text: a.location }, { text: r.label, color: r.color, bold: true }];
    }),
    "No individual devices recorded on this certificate.",
  );

  /* ---- Defects ---- */
  w.sectionTitle(`Defects and observations (${d.defects.length})`, 70);
  w.y -= 2;
  w.table(
    [
      { header: "REF", width: 60 },
      { header: "SEVERITY", width: 62 },
      { header: "DEFECT / OBSERVATION", width: 210 },
      { header: "RECOMMENDED ACTION", width: CW - 60 - 62 - 210 - 60 },
      { header: "STATUS", width: 60 },
    ],
    d.defects.map((x) => {
      const s = SEVERITY[x.severity] ?? SEVERITY.advisory;
      return [
        { text: x.reference, bold: true },
        { text: s.label, color: s.color, bold: true },
        { text: x.description ? `${x.title}\n${x.description}` : x.title },
        { text: x.recommendedAction || "-" },
        { text: x.status.replace(/_/g, " ") },
      ];
    }),
    "No defects or observations were recorded.",
  );

  /* ---- Variations ---- */
  if (d.cert.variations) {
    w.sectionTitle("Variations from the standard");
    w.paragraph(d.cert.variations);
  }

  /* ---- Declaration + signatures (kept together) ---- */
  const standard = d.type.standard ?? "the relevant British Standard";
  const declaration =
    `I/We, being the competent person(s) responsible for the inspection and servicing of the system described above, ` +
    `CERTIFY that the work for which I/we have been responsible complies, to the best of my/our knowledge and belief, ` +
    `with the recommendations of ${standard}, except for any variations stated in this certificate.` +
    (d.cert.supersedesNumber ? ` This certificate supersedes certificate ${d.cert.supersedesNumber}.` : "");
  const declLines = wrap(declaration, font, 8.5, CW);
  const sigBlockH = 14 + 10 + declLines.length * 11.5 + 12 + 112;
  w.ensure(sigBlockH);
  w.sectionTitle("Declaration");
  w.paragraph(declaration);
  w.y -= 10;
  const sigH = 108;
  const sigs = [
    {
      title: "ENGINEER / COMPETENT PERSON",
      sig: d.cert.engineerSignature,
      img: engSig,
      extra: d.qualification ? `Qualification: ${d.qualification}` : `For and on behalf of ${d.org.name}`,
    },
    {
      title: "CLIENT / RESPONSIBLE PERSON",
      sig: d.cert.clientSignature,
      img: cliSig,
      extra: d.cert.clientSignature?.signedByRole ? `Position: ${d.cert.clientSignature.signedByRole}` : `On behalf of ${d.client.name}`,
    },
  ];
  sigs.forEach((s, i) => {
    const x = M + i * (colW + 12);
    w.page.drawRectangle({ x, y: w.y - sigH, width: colW, height: sigH, borderColor: C.line, borderWidth: 0.8, color: C.white });
    w.text(s.title, x + 8, w.y - 12, 6.5, { font: bold, color: C.grey });
    // signature area
    const areaY = w.y - 64;
    w.page.drawLine({ start: { x: x + 8, y: areaY }, end: { x: x + colW - 8, y: areaY }, thickness: 0.6, color: C.line });
    if (s.img) {
      const sc = Math.min((colW - 16) / s.img.width, 42 / s.img.height);
      w.page.drawImage(s.img, { x: x + 8, y: areaY + 2, width: s.img.width * sc, height: s.img.height * sc });
    } else if (s.sig) {
      w.text("Signed electronically", x + 8, areaY + 8, 8, { color: C.grey });
    } else {
      w.text("Not signed", x + 8, areaY + 8, 8, { color: C.grey });
    }
    w.text(s.sig?.signedByName ?? "-", x + 8, areaY - 13, 9, { font: bold });
    w.text(fit(s.extra, font, 7.5, colW - 16), x + 8, areaY - 25, 7.5, { color: C.grey });
    w.text(s.sig ? `Signed ${fd(s.sig.signedAt)}` : "", x + 8, areaY - 36, 7.5, { color: C.grey });
  });
  w.y -= sigH;

  /* ---- Footer on every page ---- */
  const total = w.pages.length;
  w.pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: M + 22 }, end: { x: M + CW, y: M + 22 }, thickness: 0.6, color: C.line });
    p.drawText(fit(`${d.org.name}  ·  Certificate ${certNo}`, bold, 7, CW - 80), { x: M, y: M + 12, size: 7, font: bold, color: C.grey });
    const pg = `Page ${i + 1} of ${total}`;
    p.drawText(pg, { x: M + CW - font.widthOfTextAtSize(pg, 7), y: M + 12, size: 7, font, color: C.grey });
    const verify = fit(`Verify this certificate: ${d.verifyUrl}  ·  code ${formatToken(d.cert.verificationToken)}`, font, 6.5, CW);
    p.drawText(verify, { x: M, y: M + 3, size: 6.5, font, color: C.grey });
  });

  return await doc.save();
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

/** Render the certificate PDF, store it, and save the storage id + SHA-256 on the certificate. */
export const generate = internalAction({
  args: { certificateId: v.id("certificates") },
  handler: async (ctx, { certificateId }) => {
    try {
      const data = await loadRenderData(ctx, certificateId);
      if (!data) throw new Error("Certificate data incomplete");
      const bytes = await renderCertificate(ctx, data);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const storageId = await ctx.storage.store(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      await ctx.runMutation(internal.certificates.savePdf, { certificateId, storageId, sha256 });
      return { storageId, sha256, bytes: bytes.length };
    } catch (e) {
      await ctx.runMutation(internal.certificates.markPdfFailed, { certificateId, error: String(e) });
      throw e;
    }
  },
});

/* ---- 50 x 25 mm QR label ---- */

const MM = 72 / 25.4;

async function renderLabel(l: { kind: "asset" | "site"; orgName: string; title: string; subtitle: string; place: string; code: string; url: string }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  doc.setTitle(`QR label ${l.title}`);
  const W = 50 * MM;
  const H = 25 * MM;
  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.white });
  page.drawRectangle({ x: 0, y: H - 2.2 * MM, width: W, height: 2.2 * MM, color: C.red });
  const q = 20 * MM;
  drawQr(page, l.url, 1.2 * MM, 1.2 * MM, q);
  const x = 1.2 * MM + q + 1.2 * MM;
  const tw = W - x - 1.5 * MM;
  const t = (s: string, y: number, size: number, f: PDFFont, color: RGB = C.text) =>
    page.drawText(fit(s, f, size, tw), { x, y, size, font: f, color });
  let os = 5;
  while (os > 3.8 && bold.widthOfTextAtSize(clean(l.orgName.toUpperCase()), os) > tw) os -= 0.2;
  t(l.orgName.toUpperCase(), H - 5.6 * MM, os, bold, C.navy);
  t(l.title, H - 9.6 * MM, 8.5, bold);
  t(l.subtitle, H - 12.6 * MM, 5.5, font, C.grey);
  if (l.place) t(l.place, H - 15.2 * MM, 5.5, font, C.grey);
  t("Scan to check compliance", H - 18.6 * MM, 5, bold, C.navy);
  t(formatToken(l.code), 2.2 * MM, 6, mono, C.text);
  return await doc.save();
}

/**
 * Generate (or regenerate) a printable 50x25 mm QR label for an asset or a site.
 * Staff only. Returns a download URL; the label is also saved on the record (labelPdfId).
 */
export const generateLabel = action({
  args: { assetId: v.optional(v.id("assets")), siteId: v.optional(v.id("sites")) },
  handler: async (ctx, { assetId, siteId }): Promise<{ url: string | null; code: string; verifyUrl: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const info = await ctx.runMutation(internal.certificates.prepareLabel, { userId, assetId, siteId });
    const url = info.kind === "asset" ? assetVerifyUrl(info.code) : siteVerifyUrl(info.code);
    const bytes = await renderLabel({ ...info, url });
    const storageId = await ctx.storage.store(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    const fileUrl = await ctx.runMutation(internal.certificates.saveLabel, { assetId, siteId, storageId });
    return { url: fileUrl, code: info.code, verifyUrl: url };
  },
});
