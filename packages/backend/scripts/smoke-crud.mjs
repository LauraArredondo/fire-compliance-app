// Smoke test for the create/edit API on the DEV deployment. Usage: node scripts/smoke-crud.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { ConvexHttpClient } from "../node_modules/convex/dist/esm/browser/index.js";

const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const URL_ = env.CONVEX_URL || env.VITE_CONVEX_URL || "https://elegant-echidna-735.convex.cloud";
if (!URL_.includes("elegant-echidna-735")) throw new Error("Refusing to run outside the dev deployment");
const run = Date.now().toString(36);
const PW = "Smoke-Test-" + run + "-Pw1!";
const emails = { owner: `owner+${run}@smoke.test`, eng: `eng+${run}@smoke.test`, client: `client+${run}@smoke.test`, other: `other+${run}@smoke.test` };
writeFileSync("/tmp/smoke-emails.json", JSON.stringify(Object.values(emails)));
const storageIds = [];

const results = [];
let failures = 0;
async function step(name, fn) {
  try { const r = await fn(); results.push(["PASS", name]); return r; }
  catch (e) { failures++; results.push(["FAIL", name, String(e?.data ?? e?.message ?? e).slice(0, 300)]); return undefined; }
}
async function refused(name, fn, match) {
  try { await fn(); failures++; results.push(["FAIL", name, "expected refusal but call succeeded"]); }
  catch (e) {
    const msg = String(e?.data ?? e?.message ?? e);
    if (match && !match.test(msg)) { failures++; results.push(["FAIL", name, "wrong error: " + msg.slice(0, 200)]); }
    else results.push(["PASS", name + "  -> refused: " + msg.slice(0, 90)]);
  }
}
const assert = (c, m) => { if (!c) throw new Error("assert: " + m); };

async function user(email, flow = "signUp") {
  const c = new ConvexHttpClient(URL_);
  const r = await c.action("auth:signIn", { provider: "password", params: { email, password: PW, flow } });
  c.setAuth(r.tokens.token);
  return c;
}
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
async function upload(url, body = PNG, type = "image/png") {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": type }, body });
  const { storageId } = await r.json();
  storageIds.push(storageId);
  return storageId;
}
const page = { numItems: 50, cursor: null };

const A = await user(emails.owner);
const B = await user(emails.other);
const E = await user(emails.eng);
const C = await user(emails.client);

// ---------- organizations ----------
const orgA = await step("org: createWithOwner", () => A.mutation("organizations:createWithOwner", { name: `Smoke Fire ${run}`, disciplines: ["fire_alarm", "emergency_lighting"], email: `office+${run}@smoke.test` }));
const orgId = typeof orgA === "object" ? orgA.orgId : orgA;
const orgB = await step("org: second org (other tenant)", () => B.mutation("organizations:createWithOwner", { name: `Other Co ${run}`, disciplines: ["cctv"] }));
const orgBId = typeof orgB === "object" ? orgB.orgId : orgB;
await step("org: updateProfile (VAT, accreditations)", () => A.mutation("organizations:updateProfile", { orgId, vatNumber: "GB123456789", defaultTaxRate: 20, accreditations: [{ body: "BAFE", scheme: "SP203-1", number: "12345" }] }));
await step("org: logo upload + setLogo", async () => { const url = await A.mutation("organizations:generateLogoUploadUrl", { orgId }); const id = await upload(url); await A.mutation("organizations:setLogo", { orgId, storageId: id }); const o = await A.query("organizations:get", { orgId }); assert(o.logoUrl, "logoUrl"); });

// ---------- team ----------
const inv = await step("team: invite engineer", () => A.mutation("team:invite", { orgId, email: emails.eng, name: "Eddie Engineer", role: "engineer" }));
await step("team: engineer accepts invite", () => E.mutation("team:acceptInvitation", { token: inv.token }));
const team = await step("team: list", () => A.query("team:list", { orgId }));
const engUserId = team?.find((m) => m.role === "engineer")?.userId;
const engMembership = team?.find((m) => m.role === "engineer")?.membershipId;
await step("team: updateRole engineer->office->engineer", async () => { await A.mutation("team:updateRole", { membershipId: engMembership, role: "office" }); await A.mutation("team:updateRole", { membershipId: engMembership, role: "engineer" }); });
await refused("team: engineer can't invite", () => E.mutation("team:invite", { orgId, email: `x+${run}@smoke.test`, role: "engineer" }), /permission/i);

// ---------- qualifications ----------
const qual = await step("qualifications: create", () => A.mutation("qualifications:create", { orgId, userId: engUserId, discipline: "fire_alarm", title: "FIA Unit 3", issuer: "FIA", expiresAt: Date.now() + 300 * 864e5 }));
await step("qualifications: engineer lists own", async () => { const l = await E.query("qualifications:list", { orgId }); assert(l.length === 1, "one qual"); });
await step("qualifications: update", () => A.mutation("qualifications:update", { qualificationId: qual, reference: "FIA-0001" }));

// ---------- clients / sites / locations ----------
const clientId = await step("clients: create", () => A.mutation("clients:create", { orgId, name: "Acme Offices Ltd", type: "commercial", primaryContact: { name: "Clara Client", email: emails.client }, billingAddress: { line1: "1 High St", city: "Leeds", postcode: "ls1 4ap" } }));
await step("clients: list (paginated)", async () => { const r = await A.query("clients:list", { orgId, paginationOpts: page }); assert(r.page.length === 1, "1 client"); });
await step("clients: update", () => A.mutation("clients:update", { clientId, reminderEmails: ["facilities@acme.example"] }));
const siteId = await step("sites: create", () => A.mutation("sites:create", { orgId, clientId, name: "Acme HQ", address: { line1: "1 High St", city: "Leeds", postcode: "LS1 4AP" }, geo: { lat: 53.8, lng: -1.55 } }));
const site2 = await step("sites: create second site", () => A.mutation("sites:create", { orgId, clientId, name: "Acme Warehouse", address: { line1: "Unit 4", city: "Leeds" } }));
await step("sites: engineer updates access notes", () => E.mutation("sites:update", { siteId, accessNotes: "Keys at reception" }));
await refused("sites: engineer can't change address", () => E.mutation("sites:update", { siteId, address: { line1: "Elsewhere" } }));
const bldg = await step("locations: create building", () => A.mutation("locations:create", { siteId, kind: "building", name: "Main" }));
const floor = await step("locations: create floor", () => A.mutation("locations:create", { siteId, kind: "floor", name: "Ground", parentId: bldg }));
await refused("locations: can't delete with children", () => A.mutation("locations:remove", { locationId: bldg }));

// ---------- types & templates ----------
const tplId = await step("checklistTemplates: create", () => A.mutation("checklistTemplates:create", { orgId, discipline: "fire_alarm", name: "BS 5839 detector test", scope: "asset", standard: "BS 5839-1:2017", items: [{ key: "functional", label: "Functional test", responseType: "pass_fail", required: true }, { key: "clean", label: "Clean & undamaged", responseType: "yes_no_na", required: false }] }));
await step("checklistTemplates: update bumps version", async () => { await A.mutation("checklistTemplates:update", { templateId: tplId, items: [{ key: "functional", label: "Functional test (heat/smoke)", responseType: "pass_fail", required: true }] }); const t = await A.query("checklistTemplates:get", { templateId: tplId }); assert(t.version === 2, "v2"); });
const typeId = await step("assetTypes: create", () => A.mutation("assetTypes:create", { orgId, discipline: "fire_alarm", name: "Smoke detector", expectedLifeYears: 10, checklistTemplateId: tplId, readingDefinitions: [{ key: "sensitivity", label: "Sensitivity", unit: "%obs/m", valueType: "number", min: 1, max: 4 }] }));
const elType = await step("assetTypes: create EL type", () => A.mutation("assetTypes:create", { orgId, discipline: "emergency_lighting", name: "EL bulkhead" }));
const certType = await step("certificateTypes: create", () => A.mutation("certificateTypes:create", { orgId, discipline: "fire_alarm", name: "BS 5839-1 Inspection & Servicing", code: "FA-IS", numberPrefix: "FA-", validityMonths: 6, requiresClientSignature: true }));

// ---------- assets ----------
const asset1 = await step("assets: create", () => A.mutation("assets:create", { siteId, assetTypeId: typeId, reference: "L1-D001", locationId: floor, installedAt: Date.UTC(2022, 0, 1) }));
const bulk = await step("assets: bulkImport 3 rows (+1 dupe)", async () => { const r = await A.mutation("assets:bulkImport", { siteId, rows: [{ assetTypeId: typeId, reference: "L1-D002", locationName: "Plant room" }, { assetTypeId: typeId, reference: "L1-D003", locationName: "Plant room" }, { assetTypeId: elType, reference: "EL-01" }, { assetTypeId: typeId, reference: "l1-d001" }] }); assert(r.created === 3 && r.skipped === 1, JSON.stringify(r)); return r; });
await step("assets: list (paginated)", async () => { const r = await A.query("assets:list", { siteId, paginationOpts: page }); assert(r.page.length === 4, "4 assets"); });
await step("assets: move to site 2", async () => { await A.mutation("assets:move", { assetId: bulk.ids[2], siteId: site2 }); const a = await A.query("assets:get", { assetId: bulk.ids[2] }); assert(a.siteId === site2, "moved"); });
await step("assets: decommission", () => A.mutation("assets:decommission", { assetId: bulk.ids[1], status: "removed", reason: "Area demolished" }));
await refused("assets: can't edit decommissioned", () => A.mutation("assets:update", { assetId: bulk.ids[1], description: "x" }), /decommissioned/);

// ---------- schedules ----------
const schedId = await step("serviceSchedules: create", () => A.mutation("serviceSchedules:create", { siteId, discipline: "fire_alarm", name: "FA 6-monthly service", frequency: { interval: 6, unit: "month" }, nextDueAt: Date.now() + 5 * 864e5 }));
await step("serviceSchedules: pause/resume", async () => { await A.mutation("serviceSchedules:setStatus", { scheduleId: schedId, status: "paused" }); await A.mutation("serviceSchedules:setStatus", { scheduleId: schedId, status: "active" }); });

// ---------- jobs & visits ----------
const jobId = await step("jobs: create (JOB- number)", async () => { const id = await A.mutation("jobs:create", { siteId, type: "routine_service", disciplines: ["fire_alarm"], title: "FA service", scheduleId: schedId, scheduledStart: Date.now() + 3600e3 }); const j = await A.query("jobs:get", { jobId: id }); assert(/^JOB-\d{6}$/.test(j.jobNumber), j.jobNumber); return id; });
await step("jobs: assignEngineers", () => A.mutation("jobs:assignEngineers", { jobId, engineerIds: [engUserId] }));
await step("jobs: engineer sees myJobs", async () => { const l = await E.query("jobs:myJobs", { orgId }); assert(l.some((j) => j._id === jobId), "in myJobs"); });
const visitId = await step("visits: start with GPS (idempotent)", async () => { const a = await E.mutation("visits:start", { jobId, geo: { lat: 53.8, lng: -1.55 }, clientGeneratedId: `v-${run}` }); const b = await E.mutation("visits:start", { jobId, geo: { lat: 53.8, lng: -1.55 }, clientGeneratedId: `v-${run}` }); assert(a === b, "same id"); return a; });
await step("inspections: record bulk (idempotent) + readings", async () => {
  const batch = { visitId, inspections: [
    { clientGeneratedId: `i1-${run}`, assetId: asset1, templateId: tplId, responses: [{ itemKey: "functional", result: "pass" }], overallResult: "pass", readings: [{ key: "sensitivity", value: 2.5, clientGeneratedId: `r1-${run}` }] },
    { clientGeneratedId: `i2-${run}`, assetId: bulk.ids[0], templateId: tplId, responses: [{ itemKey: "functional", result: "fail", comment: "No response" }], overallResult: "fail" },
  ] };
  const r1 = await E.mutation("inspections:record", batch);
  const r2 = await E.mutation("inspections:record", batch);
  assert(r1.every((x) => !x.duplicate) && r2.every((x) => x.duplicate) && r1[0].inspectionId === r2[0].inspectionId, "idempotent");
  const rd = await A.query("inspections:readingsForAsset", { assetId: asset1, key: "sensitivity" });
  assert(rd.length === 1 && rd[0].withinTolerance === true, "reading once, within tolerance");
  return r1;
});
await refused("inspections: missing required item", () => E.mutation("inspections:record", { visitId, inspections: [{ assetId: asset1, templateId: tplId, responses: [], overallResult: "pass" }] }), /required/i);
const defectId = await step("defects: raise (DEF- number, idempotent)", async () => { const args = { siteId, assetId: bulk.ids[0], visitId, title: "Detector failed functional test", severity: "major", clientGeneratedId: `d-${run}` }; const a = await E.mutation("defects:raise", args); const b = await E.mutation("defects:raise", args); assert(a === b, "idempotent"); const d = await A.query("defects:get", { defectId: a }); assert(d.reference.startsWith("DEF-"), "ref"); return a; });
await step("attachments: upload + attach photo to defect", async () => { const url = await E.mutation("attachments:generateUploadUrl", { orgId }); const sid = await upload(url); await E.mutation("attachments:attach", { orgId, entityType: "defect", entityId: defectId, storageId: sid, fileName: "photo.png", visibleToClient: true, clientGeneratedId: `a-${run}` }); const l = await A.query("attachments:listForEntity", { orgId, entityType: "defect", entityId: defectId }); assert(l.length === 1 && l[0].url, "listed"); });
await step("visits: finish with signatures", async () => { const url = await E.mutation("visits:generateUploadUrl", { orgId }); const sig = await upload(url); await E.mutation("visits:finish", { visitId, notes: "Serviced, one detector failed", engineerSignature: { signedByName: "Eddie Engineer", signatureImageId: sig }, customerSignature: { signedByName: "Clara Client", signedByRole: "Facilities" } }); });

// ---------- certificates ----------
const certId = await step("certificates: createDraft from job (prefilled)", async () => { const id = await E.mutation("certificates:createDraft", { certificateTypeId: certType, jobId }); const c = await A.query("certificates:get", { certificateId: id }); assert(c.inspectionIds.length === 2 && c.defectIds.length === 1 && c.overallResult === "unsatisfactory" && c.certificateNumber === "FA-000001", JSON.stringify({ n: c.certificateNumber, i: c.inspectionIds.length, d: c.defectIds.length, r: c.overallResult })); return id; });
await step("certificates: updateDraft summary", () => E.mutation("certificates:updateDraft", { certificateId: certId, summary: "System serviced; one detector to replace." }));
await step("certificates: sign engineer + client", async () => { await E.mutation("certificates:sign", { certificateId: certId, as: "engineer", signature: { signedByName: "Eddie Engineer" } }); const r = await E.mutation("certificates:sign", { certificateId: certId, as: "client", signature: { signedByName: "Clara Client" } }); assert(r.readyToIssue, "ready"); });
await step("certificates: issue advances schedule", async () => { const before = await A.query("serviceSchedules:get", { scheduleId: schedId }); await E.mutation("certificates:issue", { certificateId: certId }); const after = await A.query("serviceSchedules:get", { scheduleId: schedId }); assert(after.nextDueAt > before.nextDueAt + 100 * 864e5 && after.lastCompletedAt, "advanced ~6 months"); });
await refused("certificates: issued can't be edited", () => A.mutation("certificates:updateDraft", { certificateId: certId, summary: "tamper" }), /issued/);
await refused("attachments: can't attach to issued certificate", async () => { const url = await A.mutation("attachments:generateUploadUrl", { orgId }); const sid = await upload(url); await A.mutation("attachments:attach", { orgId, entityType: "certificate", entityId: certId, storageId: sid, fileName: "x.png" }); }, /issued/);
await step("jobs: complete job", () => E.mutation("jobs:setStatus", { jobId, status: "completed" }));
await refused("jobs: completed job is locked", () => A.mutation("jobs:update", { jobId, title: "changed" }), /can't be edited/);

// ---------- portal ----------
const pInv = await step("portal: createInvitation (site-limited)", () => A.mutation("portal:createInvitation", { clientId, email: emails.client, name: "Clara Client", siteIds: [siteId] }));
await step("portal: client accepts", () => C.mutation("portal:acceptInvitation", { token: pInv.token }));
await step("portal: client reads own site, certs, defects", async () => {
  const s = await C.query("sites:list", { orgId, paginationOpts: page });
  assert(s.page.length === 1 && s.page[0]._id === siteId, "only the granted site");
  const certs = await C.query("certificates:list", { orgId, paginationOpts: page });
  assert(certs.page.length === 1, "issued cert visible");
  const d = await C.query("defects:list", { orgId, paginationOpts: page });
  assert(d.page.length === 1, "client-visible defect");
});
await refused("portal: client can't see non-granted site", () => C.query("sites:get", { siteId: site2 }), /not found/i);
await refused("portal: client_user can't create a site", () => C.mutation("sites:create", { orgId, clientId, name: "Hack", address: { line1: "x" } }), /permission/i);
await refused("portal: client_user can't raise a defect", () => C.mutation("defects:raise", { siteId, title: "x", severity: "minor", discipline: "fire_alarm" }), /permission/i);
await refused("portal: client_user can't edit asset", () => C.mutation("assets:update", { assetId: asset1, description: "x" }), /permission/i);

// ---------- quotes ----------
const quoteId = await step("quotes: create (Q- number) with lines + defect", () => A.mutation("quotes:create", { clientId, siteId, title: "Replace failed detector", defectIds: [defectId], lines: [{ kind: "material", description: "Optical smoke detector", quantity: 1, unitPrice: 4500, defectId }, { kind: "labour", description: "Engineer labour (hour)", quantity: 1.5, unitPrice: 6000, discountPercent: 10 }] }));
const optLine = await step("quotes: addLine (optional) + totals", async () => { const r = await A.mutation("quotes:addLine", { quoteId, kind: "service", description: "Extra cleaning", quantity: 1, unitPrice: 2000, optional: true }); const q = await A.query("quotes:get", { quoteId }); assert(q.subtotal === 4500 + 9000 + 2000 && q.discountTotal === 900 && q.total === Math.round((4500 + 8100 + 2000) * 1.2), JSON.stringify([q.subtotal, q.discountTotal, q.total])); return r.lineId; });
const sent = await step("quotes: send (dry-run email)", () => A.mutation("quotes:send", { quoteId }));
const token = sent?.acceptUrl?.split("/quotes/")[1];
await refused("quotes: sent quote is locked", () => A.mutation("quotes:addLine", { quoteId, description: "x", quantity: 1, unitPrice: 1 }), /revision/);
const rev = await step("quotes: revise -> new draft rev 1", async () => { const id = await A.mutation("quotes:revise", { quoteId }); const q = await A.query("quotes:get", { quoteId: id }); assert(q.revision === 1 && q.lines.length === 3, "copied"); return id; });
const sent2 = await step("quotes: send revision", () => A.mutation("quotes:send", { quoteId: rev }));
const token2 = sent2?.acceptUrl?.split("/quotes/")[1];
const anon = new ConvexHttpClient(URL_);
await refused("quotes: old token can't be accepted (superseded)", () => anon.mutation("quotes:respond", { token, decision: "accepted", signedByName: "X" }), /no longer open/);
await step("quotes: public getByToken + markViewed", async () => { const q = await anon.query("quotes:getByToken", { token: token2 }); assert(q.canRespond && q.lines.length === 3, "view"); await anon.mutation("quotes:markViewed", { token: token2 }); });
await step("quotes: public accept with signature, opting out of optional line", async () => { const url = await anon.mutation("quotes:generateSignatureUploadUrl", { token: token2 }); const sig = await upload(url); await anon.mutation("quotes:respond", { token: token2, decision: "accepted", signedByName: "Clara Client", signatureImageId: sig, purchaseOrderNumber: "PO-778", selectedOptionalLineIds: [] }); const q = await A.query("quotes:get", { quoteId: rev }); assert(q.status === "accepted" && q.total === Math.round((4500 + 8100) * 1.2) && q.acceptance.signature.contentHash, "accepted, total excl. optional"); });
await refused("quotes: can't respond twice", () => anon.mutation("quotes:respond", { token: token2, decision: "declined" }), /already/);
const remJob = await step("quotes: convertToJob -> remedial job, defect scheduled", async () => { const id = await A.mutation("quotes:convertToJob", { quoteId: rev, assignedEngineerIds: [engUserId] }); const d = await A.query("defects:get", { defectId }); assert(d.status === "scheduled" && d.remedialJobId === id, d.status); return id; });

// ---------- invoices ----------
const invId = await step("invoices: createFromJob (from accepted quote, INV- number)", async () => { await A.mutation("jobs:setStatus", { jobId: remJob, status: "in_progress" }); await A.mutation("jobs:setStatus", { jobId: remJob, status: "completed" }); const id = await A.mutation("invoices:createFromJob", { jobId: remJob }); const i = await A.query("invoices:get", { invoiceId: id }); assert(/^INV-\d{6}$/.test(i.invoiceNumber) && i.total === Math.round((4500 + 8100) * 1.2), JSON.stringify([i.invoiceNumber, i.total])); const d = await A.query("defects:get", { defectId }); assert(d.status === "resolved", "defect resolved on remedial completion " + d.status); return id; });
await refused("invoices: second invoice for same quote refused", () => A.mutation("invoices:createFromQuote", { quoteId: rev }), /already been invoiced/);
await step("invoices: update draft notes", () => A.mutation("invoices:update", { invoiceId: invId, notes: "Thanks for your business", paymentTermsDays: 14 }));
await step("invoices: send (dueAt = +14d)", async () => { const r = await A.mutation("invoices:send", { invoiceId: invId }); assert(Math.abs(r.dueAt - Date.now() - 14 * 864e5) < 600e3, "due"); });
await refused("invoices: sent invoice is locked", () => A.mutation("invoices:update", { invoiceId: invId, notes: "x" }), /draft/);
await step("invoices: part payment then full", async () => { const i = await A.query("invoices:get", { invoiceId: invId }); const r1 = await A.mutation("invoices:recordPayment", { invoiceId: invId, amount: 5000, method: "bank_transfer" }); assert(r1.status === "partially_paid", "part"); const r2 = await A.mutation("invoices:recordPayment", { invoiceId: invId, amount: i.total - 5000, method: "card" }); assert(r2.status === "paid", "paid"); });
await refused("invoices: overpayment refused", () => A.mutation("invoices:recordPayment", { invoiceId: invId, amount: 1, method: "cash" }));
await step("invoices: manual invoice + void", async () => { const id = await A.mutation("invoices:create", { clientId, lines: [{ description: "Call-out", quantity: 1, unitPrice: 9500 }] }); await A.mutation("invoices:voidInvoice", { invoiceId: id, reason: "Raised in error" }); });
await step("portal: client sees sent invoice, not drafts", async () => { const r = await C.query("invoices:list", { orgId, paginationOpts: page }); assert(r.page.length === 1 && r.page[0]._id === invId, "one invoice " + r.page.length); });
await refused("invoices: engineer can't read invoices", () => E.query("invoices:list", { orgId, paginationOpts: page }), /permission/i);
await refused("invoices: office can't void (managers only)", async () => { await A.mutation("team:updateRole", { membershipId: engMembership, role: "office" }); try { const id = await A.mutation("invoices:create", { clientId, lines: [{ description: "x", quantity: 1, unitPrice: 100 }] }); await E.mutation("invoices:voidInvoice", { invoiceId: id, reason: "x" }); } finally { await A.mutation("team:updateRole", { membershipId: engMembership, role: "engineer" }); } }, /permission/i);

// ---------- cross-tenant ----------
await refused("other org: can't list clients", () => B.query("clients:list", { orgId, paginationOpts: page }), /member/i);
await refused("other org: can't get site", () => B.query("sites:get", { siteId }), /member/i);
await refused("other org: can't read certificate", () => B.query("certificates:get", { certificateId: certId }), /member/i);
await refused("other org: can't edit asset", () => B.mutation("assets:update", { assetId: asset1, description: "x" }), /member/i);
await refused("other org: can't attach to org A's defect", async () => { const url = await B.mutation("attachments:generateUploadUrl", { orgId: orgBId }); const sid = await upload(url); await B.mutation("attachments:attach", { orgId: orgBId, entityType: "defect", entityId: defectId, storageId: sid, fileName: "x.png" }); }, /not found/i);

// ---------- misc ----------
await step("team: deactivate + reactivate engineer", async () => { await A.mutation("team:setActive", { membershipId: engMembership, active: false }); let blocked = false; try { await E.query("jobs:myJobs", { orgId }); } catch { blocked = true; } assert(blocked, "deactivated user blocked"); await A.mutation("team:setActive", { membershipId: engMembership, active: true }); });
await step("portal: revoke access blocks client", async () => { const acc = await A.query("portal:listAccess", { clientId }); await A.mutation("portal:revokeAccess", { accessId: acc[0]._id }); let blocked = false; try { await C.query("sites:list", { orgId, paginationOpts: page }); } catch { blocked = true; } assert(blocked, "blocked"); });
await step("clients: archive pauses schedules", async () => { await A.mutation("clients:setArchived", { clientId, archived: true }); const s = await A.query("serviceSchedules:get", { scheduleId: schedId }); assert(s.status === "paused", s.status); });

writeFileSync("/tmp/smoke-storage.json", JSON.stringify(storageIds));
for (const r of results) console.log(r.join("  "));
console.log(`\n${results.length - failures}/${results.length} passed`);
process.exit(failures ? 1 : 0);
