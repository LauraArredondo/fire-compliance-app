// Seeds a realistic quote + invoice on DEV, exercises PDF generation/permissions and saves samples.
// Usage: node scripts/smoke-pdf.mjs   (cleanup is a separate step)
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { ConvexHttpClient } from "../node_modules/convex/dist/esm/browser/index.js";

const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const URL_ = env.CONVEX_URL || env.VITE_CONVEX_URL || "https://elegant-echidna-735.convex.cloud";
if (!URL_.includes("elegant-echidna-735")) throw new Error("Refusing to run outside the dev deployment");
const OUT = "/workspace/samples";
const run = Date.now().toString(36);
const PW = "Smoke-Test-" + run + "-Pw1!";
const emails = { owner: `owner+${run}@smoke.test`, client: `clara+${run}@smoke.test`, eng: `eng+${run}@smoke.test` };

const results = []; let failures = 0;
async function step(name, fn) { try { const r = await fn(); results.push(["PASS", name]); return r; } catch (e) { failures++; results.push(["FAIL", name, String(e?.data ?? e?.message ?? e).slice(0, 300)]); return undefined; } }
async function refused(name, fn, match) {
  try { await fn(); failures++; results.push(["FAIL", name, "expected refusal"]); }
  catch (e) { const m = String(e?.data ?? e?.message ?? e); if (match && !match.test(m)) { failures++; results.push(["FAIL", name, "wrong error: " + m.slice(0, 200)]); } else results.push(["PASS", `${name}  -> refused: ${m.slice(0, 80)}`]); }
}
const assert = (c, m) => { if (!c) throw new Error("assert: " + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function user(email) { const c = new ConvexHttpClient(URL_); const r = await c.action("auth:signIn", { provider: "password", params: { email, password: PW, flow: "signUp" } }); c.setAuth(r.tokens.token); return c; }
async function upload(url, file) { const r = await fetch(url, { method: "POST", headers: { "Content-Type": "image/png" }, body: readFileSync(file) }); return (await r.json()).storageId; }
/** Wait until getPdf reports ready with a hash different from `prev`. */
async function waitPdf(fn, prev = null) {
  for (let i = 0; i < 40; i++) { const p = await fn(); if (p.pdfStatus === "failed") throw new Error("render failed: " + p.pdfError); if (p.pdfStatus === "ready" && p.sha256 && p.sha256 !== prev) return p; await sleep(500); }
  throw new Error("timed out waiting for PDF");
}
async function download(url, file, expectSha) {
  const r = await fetch(url); assert(r.ok, `HTTP ${r.status} for ${url}`);
  assert((r.headers.get("content-type") ?? "").includes("pdf"), "content-type pdf");
  const b = Buffer.from(await r.arrayBuffer()); const sha = createHash("sha256").update(b).digest("hex");
  if (expectSha) assert(sha === expectSha, "SHA-256 matches stored fingerprint");
  writeFileSync(file, b); return { bytes: b.length, sha };
}

const A = await user(emails.owner); const C = await user(emails.client); const E = await user(emails.eng);
const anon = new ConvexHttpClient(URL_);

const { orgId } = await A.mutation("organizations:createWithOwner", { name: "Beacon Fire & Security", disciplines: ["fire_alarm", "emergency_lighting", "fire_extinguishers"], email: "accounts@beaconfire.example" });
await step("org: profile (legal name, company/VAT no., accreditations)", () => A.mutation("organizations:updateProfile", {
  orgId, legalName: "Beacon Fire & Security Ltd", registrationNumber: "09876543", vatNumber: "GB 123 4567 89", phone: "0113 496 0123", email: "accounts@beaconfire.example",
  address: { line1: "Unit 7, Kirkstall Trade Park", line2: "Kirkstall Road", city: "Leeds", region: "West Yorkshire", postcode: "LS4 2AZ" },
  accreditations: [{ body: "BAFE", scheme: "SP203-1", number: "BF-000123" }, { body: "NSI", scheme: "Gold", number: "NSI-4567" }, { body: "FIA", scheme: "Member" }], defaultTaxRate: 20,
}));
await step("org: logo", async () => { const url = await A.mutation("organizations:generateLogoUploadUrl", { orgId }); await A.mutation("organizations:setLogo", { orgId, storageId: await upload(url, "/tmp/pdfseed/logo.png") }); });
await refused("org: bad sort code rejected", () => A.mutation("organizations:updateBillingSettings", { orgId, bankDetails: { sortCode: "12-34" } }), /Sort code/);
await step("org: bank details + payment instructions", () => A.mutation("organizations:updateBillingSettings", { orgId, bankDetails: { bankName: "Barclays Bank UK PLC", accountName: "Beacon Fire & Security Ltd", sortCode: "20-45-77", accountNumber: "43218765", paymentInstructions: "Please pay by BACS or Faster Payments quoting the invoice number. Remittance advice to accounts@beaconfire.example." } }));

// team engineer (for permission check)
const tinv = await A.mutation("team:invite", { orgId, email: emails.eng, name: "Eddie Engineer", role: "engineer" });
await E.mutation("team:acceptInvitation", { token: tinv.token });

const clientId = await A.mutation("clients:create", { orgId, name: "Northgate Property Management Ltd", type: "commercial", primaryContact: { name: "Clara Whitfield", email: emails.client, phone: "0113 555 0199" }, billingAddress: { line1: "Accounts Payable, 4th Floor", line2: "12 Park Row", city: "Leeds", postcode: "LS1 5HD" } });
const siteId = await A.mutation("sites:create", { orgId, clientId, name: "Northgate House", reference: "NG-HSE", address: { line1: "48 Wellington Street", city: "Leeds", postcode: "LS1 2DE" } });
const d1 = await A.mutation("defects:raise", { siteId, discipline: "fire_alarm", title: "Zone 3 optical smoke detector failed functional test (2nd floor corridor)", severity: "major", recommendedAction: "Replace detector head and retest zone." });
const d2 = await A.mutation("defects:raise", { siteId, discipline: "emergency_lighting", title: "Two emergency luminaires fail 3-hour duration test (stairwell B)", severity: "minor", recommendedAction: "Replace batteries in both fittings." });

const quoteId = await step("quote: create with labour/material/service + optional lines", () => A.mutation("quotes:create", {
  clientId, siteId, title: "Remedial works following annual fire alarm and emergency lighting inspection", defectIds: [d1, d2],
  introduction: "Following our inspection on 21 October we recommend the remedial works below to restore the fire detection and emergency lighting systems at Northgate House to full compliance with BS 5839-1:2017 and BS 5266-1:2016. All works are carried out by BAFE-registered engineers during normal working hours.",
  lines: [
    { kind: "material", description: "Apollo Soteria optical smoke detector head", productCode: "SA5100-600", quantity: 1, unitPrice: 6850, defectId: d1 },
    { kind: "material", description: "Emergency lighting replacement battery pack (NiCd 3.6V 4Ah)", productCode: "EL-BAT-4AH", quantity: 2, unitPrice: 2475, defectId: d2 },
    { kind: "labour", description: "Engineer labour: replace, commission and test (per hour)", quantity: 2.5, unitPrice: 6500, discountPercent: 10 },
    { kind: "service", description: "Zone 3 and stairwell B functional retest and certificate update", quantity: 1, unitPrice: 4500 },
    { kind: "other", description: "Access equipment: podium steps hire (zero-rated example)", quantity: 1, unitPrice: 1500, taxRate: 0 },
  ],
}));
const optA = await A.mutation("quotes:addLine", { quoteId, kind: "service", description: "Optional: upgrade stairwell B fittings to self-test LED units", quantity: 2, unitPrice: 8950, optional: true });
await A.mutation("quotes:addLine", { quoteId, kind: "service", description: "Optional: out-of-hours working supplement (evening visit)", quantity: 1, unitPrice: 12000, optional: true });

let qp = await step("quote: draft preview via regeneratePdf (DRAFT)", async () => { await A.mutation("quotes:regeneratePdf", { quoteId }); const p = await waitPdf(() => A.query("quotes:getPdf", { quoteId })); assert(p.url && !p.publicUrl, "url, no public link for draft"); await download(p.url, "/tmp/pdfseed/quote-draft.pdf", p.sha256); return p; });
const sent = await step("quote: send generates PDF, email carries PDF link", async () => {
  const r = await A.mutation("quotes:send", { quoteId }); assert(r.pdfUrl.includes("/pdf/q/"), "pdfUrl");
  const p = await waitPdf(() => A.query("quotes:getPdf", { quoteId }), qp?.sha256);
  const n = (await A.query("reminders:listNotifications", { orgId })).find((x) => x.type === "quote_sent");
  const full = await A.query("reminders:getNotification", { notificationId: n._id });
  assert(full.html.includes(r.pdfUrl) && full.body.includes("Download PDF copy"), "link in email"); assert(full.status === "skipped_no_provider" || full.status === "queued", "dry run: " + full.status);
  return { ...r, p };
});
await step("quote: public /pdf/q link serves the stored file (SHA-256 verified)", () => download(sent.pdfUrl, `${OUT}/sample-quote-sent.pdf`, sent.p.sha256));

const pInv = await A.mutation("portal:createInvitation", { clientId, email: emails.client, name: "Clara Whitfield" });
await C.mutation("portal:acceptInvitation", { token: pInv.token });
await step("portal: client can get sent quote PDF", async () => { const p = await C.query("quotes:getPdf", { quoteId }); assert(p.url && p.pdfStatus === "ready", "client url"); });
await refused("portal: client can't regenerate", () => C.mutation("quotes:regeneratePdf", { quoteId }), /permission/i);

const token = sent.acceptUrl.split("/").pop();
const acc = await step("quote: public accept (signature, PO, 1 optional) -> regenerated ACCEPTED copy", async () => {
  const url = await anon.mutation("quotes:generateSignatureUploadUrl", { token });
  const sig = await upload(url, "/tmp/pdfseed/signature.png");
  await anon.mutation("quotes:respond", { token, decision: "accepted", signedByName: "Clara Whitfield", signedByRole: "Facilities Manager", signatureImageId: sig, purchaseOrderNumber: "NPM-PO-20417", selectedOptionalLineIds: [optA.lineId] });
  const p = await waitPdf(() => A.query("quotes:getPdf", { quoteId }), sent.p.sha256);
  await download(sent.pdfUrl, `${OUT}/sample-quote.pdf`, p.sha256);
  return p;
});

// invoice from the accepted quote
const invoiceId = await step("invoice: createFromQuote", () => A.mutation("invoices:createFromQuote", { quoteId, paymentTermsDays: 30 }));
await refused("portal: client can't get draft invoice PDF", () => C.query("invoices:getPdf", { invoiceId }), /not found/i);
const isent = await step("invoice: send generates PDF + email link", async () => {
  const r = await A.mutation("invoices:send", { invoiceId }); assert(r.pdfUrl.includes("/pdf/i/"), "pdfUrl");
  const p = await waitPdf(() => A.query("invoices:getPdf", { invoiceId }));
  const n = (await A.query("reminders:listNotifications", { orgId })).find((x) => x.type === "invoice_sent");
  const full = await A.query("reminders:getNotification", { notificationId: n._id }); assert(full.html.includes(r.pdfUrl), "link in email");
  return { ...r, p };
});
const inv = await A.query("invoices:get", { invoiceId });
const part = await step("invoice: part payment re-renders (payments + balance)", async () => {
  await A.mutation("invoices:recordPayment", { invoiceId, amount: 25000, method: "bank_transfer", reference: "NPM BACS 20417", paidAt: Date.now() - 2 * 864e5 });
  const p = await waitPdf(() => A.query("invoices:getPdf", { invoiceId }), isent.p.sha256);
  await download(isent.pdfUrl, `${OUT}/sample-invoice.pdf`, p.sha256); return p;
});
await step("portal: client can get sent invoice PDF", async () => { const p = await C.query("invoices:getPdf", { invoiceId }); assert(p.url, "url"); });
await refused("engineer can't get invoice PDF", () => E.query("invoices:getPdf", { invoiceId }), /permission/i);
await step("invoice: paid in full -> PAID watermark", async () => {
  await A.mutation("invoices:recordPayment", { invoiceId, amount: inv.total - 25000, method: "card", reference: "Card ending 4242" });
  const p = await waitPdf(() => A.query("invoices:getPdf", { invoiceId }), part.sha256);
  await download(isent.pdfUrl, `${OUT}/sample-invoice-paid.pdf`, p.sha256);
});
await step("invoice: manual invoice sent then voided -> VOID watermark", async () => {
  const id = await A.mutation("invoices:create", { clientId, siteId, lines: [{ description: "Call-out: false alarm investigation", quantity: 1, unitPrice: 9500 }], paymentTermsDays: 14 });
  const r = await A.mutation("invoices:send", { invoiceId: id });
  const p1 = await waitPdf(() => A.query("invoices:getPdf", { invoiceId: id }));
  await A.mutation("invoices:voidInvoice", { invoiceId: id, reason: "Raised in error - covered under maintenance contract" });
  const p2 = await waitPdf(() => A.query("invoices:getPdf", { invoiceId: id }), p1.sha256);
  await download(r.pdfUrl, `${OUT}/sample-invoice-void.pdf`, p2.sha256);
});
await step("http: unknown token -> 404", async () => { const r = await fetch(sent.pdfUrl.replace(/q\/.*/, "q/ZZZZZZZZZZZZZZZZZZZZZZZZ")); assert(r.status === 404, "404"); });

for (const r of results) console.log(r.join("  "));
console.log(`\n${results.length - failures}/${results.length} passed`);
process.exit(failures ? 1 : 0);
