/** Shared PDF building blocks (A4, Helvetica, company branding) for certificates, quotes and invoices. */
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb, RGB, degrees } from "pdf-lib";
import QRCode from "qrcode";
import { ActionCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";

export const PAGE_W = 595.28; // A4 portrait
export const PAGE_H = 841.89;
export const M = 36; // page margin
export const CW = PAGE_W - 2 * M; // content width
export const FOOTER_H = 34;

export const C = {
  navy: rgb(0.122, 0.165, 0.267),
  red: rgb(0.78, 0.063, 0.18),
  text: rgb(0.12, 0.14, 0.17),
  grey: rgb(0.42, 0.45, 0.5),
  line: rgb(0.84, 0.86, 0.89),
  light: rgb(0.955, 0.962, 0.972),
  white: rgb(1, 1, 1),
  green: rgb(0.08, 0.5, 0.24),
  amber: rgb(0.78, 0.45, 0.02),
  danger: rgb(0.72, 0.11, 0.11),
};

/* ------------------------------------------------------------------ */
/* Text helpers (Helvetica = WinAnsi only)                             */
/* ------------------------------------------------------------------ */

const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
export function clean(s: unknown): string {
  return String(s ?? "")
    .replace(/[\u2010-\u2012]/g, "-")
    .replace(/\u2265/g, ">=")
    .replace(/\u2264/g, "<=")
    .replace(/\u00a0/g, " ")
    .replace(/\t/g, " ")
    .split("")
    .map((ch) => {
      const c = ch.charCodeAt(0);
      if (ch === "\n") return ch;
      if ((c >= 32 && c < 127) || (c >= 160 && c <= 255) || WIN_ANSI_EXTRA.has(ch)) return ch;
      return "?";
    })
    .join("");
}

export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of clean(text).split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push("");
      continue;
    }
    let line = "";
    for (let w of words) {
      // hard-break very long words
      while (font.widthOfTextAtSize(w, size) > width) {
        let i = w.length;
        while (i > 1 && font.widthOfTextAtSize(w.slice(0, i), size) > width) i--;
        if (line) {
          out.push(line);
          line = "";
        }
        out.push(w.slice(0, i));
        w = w.slice(i);
      }
      const candidate = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
      else {
        if (line) out.push(line);
        line = w;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

export function fit(text: string, font: PDFFont, size: number, width: number): string {
  let t = clean(text).replace(/\n/g, " ");
  if (font.widthOfTextAtSize(t, size) <= width) return t;
  while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > width) t = t.slice(0, -1);
  return t + "…";
}

export async function embedImage(doc: PDFDocument, bytes: Uint8Array | null): Promise<PDFImage | null> {
  if (!bytes || bytes.length < 4) return null;
  try {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return await doc.embedPng(bytes);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return await doc.embedJpg(bytes);
  } catch {
    /* unsupported image: skip */
  }
  return null;
}

export async function loadStorage(ctx: ActionCtx, id: Id<"_storage"> | null | undefined): Promise<Uint8Array | null> {
  if (!id) return null;
  const blob = await ctx.storage.get(id);
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** Vector QR code (crisp at any print size). */
export function drawQr(page: PDFPage, text: string, x: number, y: number, size: number) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const quiet = 2;
  const cell = size / (n + quiet * 2);
  page.drawRectangle({ x, y, width: size, height: size, color: C.white });
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.modules.get(r, c)) {
        c++;
        continue;
      }
      let run = 1;
      while (c + run < n && qr.modules.get(r, c + run)) run++;
      page.drawRectangle({
        x: x + (quiet + c) * cell,
        y: y + size - (quiet + r + 1) * cell,
        width: run * cell + 0.05,
        height: cell + 0.05,
        color: rgb(0, 0, 0),
      });
      c += run;
    }
  }
}

export type Col = { header: string; width: number; align?: "left" | "right" | "center" };
export type Cell = { text: string; color?: RGB; bold?: boolean };

export class Writer {
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;
  constructor(
    public doc: PDFDocument,
    public font: PDFFont,
    public bold: PDFFont,
    public mono: PDFFont,
    private onNewPage: (w: Writer) => void,
  ) {}

  addPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.y = PAGE_H - M;
    if (this.pages.length > 1) this.onNewPage(this);
  }
  ensure(h: number) {
    if (this.y - h < M + FOOTER_H) this.addPage();
  }
  text(t: string, x: number, y: number, size: number, opts: { font?: PDFFont; color?: RGB } = {}) {
    this.page.drawText(clean(t), { x, y, size, font: opts.font ?? this.font, color: opts.color ?? C.text });
  }
  textRight(t: string, xRight: number, y: number, size: number, opts: { font?: PDFFont; color?: RGB } = {}) {
    const f = opts.font ?? this.font;
    const s = clean(t);
    this.page.drawText(s, { x: xRight - f.widthOfTextAtSize(s, size), y, size, font: f, color: opts.color ?? C.text });
  }

  sectionTitle(title: string, keepWithNext = 24) {
    this.ensure(20 + keepWithNext);
    this.y -= 20;
    this.page.drawRectangle({ x: M, y: this.y - 3, width: 3, height: 13, color: C.red });
    this.text(title.toUpperCase(), M + 9, this.y, 9.5, { font: this.bold, color: C.navy });
    this.y -= 10;
  }

  paragraph(t: string, size = 8.5, color = C.text) {
    const lines = wrap(t, this.font, size, CW);
    for (const l of lines) {
      this.ensure(size + 3);
      this.y -= size + 3;
      this.text(l, M, this.y, size, { color });
    }
  }

  table(cols: Col[], rows: Cell[][], emptyText: string) {
    const size = 8;
    const lh = 10;
    const pad = 4;
    const drawHeader = () => {
      this.page.drawRectangle({ x: M, y: this.y - 16, width: CW, height: 16, color: C.navy });
      let x = M;
      for (const c of cols) {
        const tx = c.align === "right" ? x + c.width - pad - this.bold.widthOfTextAtSize(c.header, 7.5) : x + pad;
        this.text(c.header, tx, this.y - 11, 7.5, { font: this.bold, color: C.white });
        x += c.width;
      }
      this.y -= 16;
    };
    const firstH = rows.length
      ? Math.max(...rows[0].map((cell, i) => wrap(cell.text, cell.bold ? this.bold : this.font, size, cols[i].width - 2 * pad).length)) * lh + 2 * pad
      : 20;
    this.ensure(16 + firstH);
    drawHeader();
    if (!rows.length) {
      this.page.drawRectangle({ x: M, y: this.y - 20, width: CW, height: 20, borderColor: C.line, borderWidth: 0.5, color: C.white });
      this.text(emptyText, M + pad, this.y - 13, size, { color: C.grey });
      this.y -= 20;
      return;
    }
    rows.forEach((row, ri) => {
      const wrapped = row.map((cell, i) => wrap(cell.text, cell.bold ? this.bold : this.font, size, cols[i].width - 2 * pad));
      const h = Math.max(...wrapped.map((w) => w.length)) * lh + 2 * pad - 2;
      if (this.y - h < M + FOOTER_H) {
        this.addPage();
        drawHeader();
      }
      this.page.drawRectangle({ x: M, y: this.y - h, width: CW, height: h, color: ri % 2 ? C.light : C.white });
      this.page.drawLine({ start: { x: M, y: this.y - h }, end: { x: M + CW, y: this.y - h }, thickness: 0.4, color: C.line });
      let x = M;
      row.forEach((cell, i) => {
        const f = cell.bold ? this.bold : this.font;
        wrapped[i].forEach((line, li) => {
          const ty = this.y - pad - 7 - li * lh;
          const tx = cols[i].align === "right" ? x + cols[i].width - pad - f.widthOfTextAtSize(line, size) : x + pad;
          this.text(line, tx, ty, size, { font: f, color: cell.color ?? C.text });
        });
        x += cols[i].width;
      });
      this.y -= h;
    });
  }
}

export function addressLines(a: { line1: string; line2?: string; city?: string; region?: string; postcode?: string } | null): string[] {
  if (!a) return [];
  return [a.line1, a.line2, [a.city, a.region].filter(Boolean).join(", "), a.postcode].filter((x): x is string => !!x);
}

export type OrgBrand = {
  name: string;
  address: { line1: string; line2?: string; city?: string; region?: string; postcode?: string } | null;
  phone?: string | null;
  email?: string | null;
  registrationNumber?: string | null;
  vatNumber?: string | null;
  accreditations: { body: string; scheme?: string | null; number?: string | null }[];
};

/** Company header: logo, name, address/contact, company + VAT numbers, accreditations; red rule underneath. */
export function drawOrgHeader(w: Writer, org: OrgBrand, logo: PDFImage | null) {
  const d = { org };
  const font = w.font;
  const bold = w.bold;
  /* ---- Company header ---- */
  const headerTop = w.y;
  let textX = M;
  if (logo) {
    const s = Math.min(150 / logo.width, 52 / logo.height);
    w.page.drawImage(logo, { x: M, y: headerTop - logo.height * s, width: logo.width * s, height: logo.height * s });
    textX = M + logo.width * s + 12;
  }
  w.text(fit(d.org.name, bold, 16, M + CW - textX - (d.org.accreditations.length ? 120 : 0)), textX, headerTop - 15, 16, { font: bold, color: C.navy });
  // accreditations (right)
  const accs = d.org.accreditations.map((a) => [a.body, a.scheme].filter(Boolean).join(" ") + (a.number ? ` · ${a.number}` : ""));
  const accW = accs.length ? Math.min(170, Math.max(...accs.slice(0, 4).map((a) => bold.widthOfTextAtSize(a, 8)), 60)) : 0;
  const textW = M + CW - textX - (accs.length ? accW + 14 : 0);
  const orgLines = [
    ...wrap(addressLines(d.org.address).join(", "), font, 8, textW).slice(0, 2),
    [d.org.phone && `Tel ${d.org.phone}`, d.org.email].filter(Boolean).join("  ·  "),
    [d.org.registrationNumber && `Company No. ${d.org.registrationNumber}`, d.org.vatNumber && `VAT ${d.org.vatNumber}`]
      .filter(Boolean)
      .join("  ·  "),
  ].filter(Boolean);
  orgLines.forEach((l, i) => w.text(fit(l, font, 8, textW), textX, headerTop - 28 - i * 10, 8, { color: C.grey }));
  if (accs.length) {
    w.textRight("ACCREDITED BY", M + CW, headerTop - 9, 6.5, { font: bold, color: C.grey });
    accs.slice(0, 4).forEach((a, i) => w.textRight(fit(a, bold, 8, 170), M + CW, headerTop - 21 - i * 10, 8, { font: bold, color: C.navy }));
  }
  const headerH = Math.max(56, 30 + orgLines.length * 10, 24 + Math.min(accs.length, 4) * 10);
  w.y = headerTop - headerH;
  w.page.drawLine({ start: { x: M, y: w.y }, end: { x: M + CW, y: w.y }, thickness: 1.5, color: C.red });
  w.y -= 10;
}

/** Big faint diagonal word across the page (PAID / VOID / DRAFT). */
export function watermark(page: PDFPage, font: PDFFont, word: string, color: RGB) {
  const size = 110;
  const tw = font.widthOfTextAtSize(word, size);
  const a = Math.PI / 5.2;
  const cx = PAGE_W / 2, cy = PAGE_H / 2;
  page.drawText(word, {
    x: cx - (Math.cos(a) * tw) / 2 + (Math.sin(a) * size) / 3,
    y: cy - (Math.sin(a) * tw) / 2 - (Math.cos(a) * size) / 3,
    size, font, color, opacity: 0.12, rotate: degrees((a * 180) / Math.PI),
  });
}
