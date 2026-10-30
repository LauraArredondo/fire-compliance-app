// Smoke test: A) auto jobs from schedules, B) qualification checks, C) overdue invoices. DEV only.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { ConvexHttpClient } from "../node_modules/convex/dist/esm/browser/index.js";

const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const URL_ = env.CONVEX_URL || env.VITE_CONVEX_URL || "https://elegant-echidna-735.convex.cloud";
if (!URL_.includes("elegant-echidna-735")) throw new Error("Refusing to run outside the dev deployment");
const run = Date.now().toString(36);
const PW = "Smoke-Test-" + run + "-Pw1!";
const emails = { owner: `owner+${run}@smoke.test`, eng: `eng+${run}@smoke.test`, eng2: `eng2+${run}@smoke.test`, client: `clara+${run}@smoke.test` };
const D = 864e5; const T0 = Date.now();

const results = []; let failures = 0;
async function step(name, fn) { try { const r = await fn(); results.push(["PASS", name]); return r; } catch (e) { failures++; results.push(["FAIL", name, String(e?.data ?? e?.message ?? e).slice(0, 400)]); return undefined; } }
async function refused(name, fn, match) {
  try { await fn(); failures++; results.push(["FAIL", name, "expected refusal"]); }
  catch (e) { const m = String(e?.data ?? e?.message ?? e); if (match && !match.test(m)) { failures++; results.push(["FAIL", name, "wrong error: " + m.slice(0, 300)]); } else results.push(["PASS", `${name}  -> "${m.replace(/^.*?Uncaught (ConvexError|Error): /s, "").split("\n")[0].slice(0, 170)}"`]); }
}
const assert = (c, m) => { if (!c) throw new Error("assert: " + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cx = (fn, args) => JSON.parse(execFileSync("npx", ["convex", "run", fn, JSON.stringify(args)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
async function user(email) { const c = new ConvexHttpClient(URL_); const r = await c.action("auth:signIn", { provider: "password", params: { email, password: PW, flow: "signUp" } }); c.setAuth(r.tokens.token); return c; }
const plan = (orgId, now) => cx("reminders:planForOrg", { orgId, ...(now ? { now } : {}) });
const peek = (orgId) => cx("zzTest:peek", { orgId });
async function settle() { await sleep(2500); }

const A = await user(emails.owner); const E = await user(emails.eng); const E2 = await user(emails.eng2);
const { orgId } = await A.mutation("organizations:createWithOwner", { name: "Beacon Fire & Security", disciplines: ["fire_alarm", "emergency_lighting", "fire_extinguishers"], email: "office@beaconfire.example" });
await A.mutation("organizations:updateBillingSettings", { orgId, bankDetails: { bankName: "Barclays Bank UK PLC", accountName: "Beacon Fire & Security Ltd", sortCode: "204577", accountNumber: "43218765" } });
for (const [c, email, name] of [[E, emails.eng, "Eddie Engineer"], [E2, emails.eng2, "Nina Newstarter"]]) { const t = await A.mutation("team:invite", { orgId, email, name, role: "engineer" }); await c.mutation("team:acceptInvitation", { token: t.token }); }
const outsiderId = (await (await user(`outsider+${run}@smoke.test`)).query("users:me", {}))._id;
const team = await A.query("team:list", { orgId });
const uid = (email) => { const m = (team.members ?? team).find((x) => (x.email ?? x.user?.email) === email); return m.userId ?? m.user?._id; };
const eId = uid(emails.eng), e2Id = uid(emails.eng2), aId = uid(emails.owner);
await A.mutation("qualifications:create", { orgId, userId: eId, discipline: "fire_alarm", title: "BAFE SP203-1 / FIA Module 4", issuedAt: T0 - 300 * D, expiresAt: T0 + 400 * D });
const elQual = await A.mutation("qualifications:create", { orgId, userId: eId, discipline: "emergency_lighting", title: "FIA Emergency Lighting", issuedAt: T0 - 900 * D, expiresAt: T0 - 20 * D });
const clientId = await A.mutation("clients:create", { orgId, name: "Northgate Property Management Ltd", type: "commercial", primaryContact: { name: "Clara Whitfield", email: emails.client } });
const siteId = await A.mutation("sites:create", { orgId, clientId, name: "Northgate House", address: { line1: "48 Wellington Street", city: "Leeds", postcode: "LS1 2DE" } });

/* ======================= A) auto jobs ======================= */
const mk = (a) => A.mutation("serviceSchedules:create", { siteId, frequency: { interval: 12, unit: "month" }, ...a });
const s1 = await mk({ discipline: "fire_alarm", name: "FA annual service", nextDueAt: T0 + 10 * D, defaultEngineerId: eId });
const s2 = await mk({ discipline: "emergency_lighting", name: "EL annual test", nextDueAt: T0 + 60 * D });
const s3 = await mk({ discipline: "fire_extinguishers", name: "Extinguisher service", nextDueAt: T0 + 45 * D, autoJobLeadDays: 60, defaultEngineerId: e2Id });
const s4 = await mk({ discipline: "fire_alarm", name: "FA annex (paused)", nextDueAt: T0 + 5 * D });
const s5 = await mk({ discipline: "fire_alarm", name: "FA manual-only", nextDueAt: T0 + 5 * D, autoCreateJob: false });
await A.mutation("serviceSchedules:setStatus", { scheduleId: s4, status: "paused" });
await step("A: schedules.create defaults autoCreateJob=true, stores lead override + default engineer", async () => { const g = await A.query("serviceSchedules:get", { scheduleId: s3 }); assert(g.autoCreateJob === true && g.autoJobLeadDays === 60 && g.defaultEngineerId === e2Id, JSON.stringify(g)); });
await refused("A: default engineer must be a team member", () => mk({ discipline: "fire_alarm", name: "x", nextDueAt: T0 + 5 * D, defaultEngineerId: outsiderId }), /team member|engineer/i);
await refused("A: lead override > 365 refused", () => mk({ discipline: "fire_alarm", name: "x", nextDueAt: T0 + 5 * D, autoJobLeadDays: 400 }), /365/);
await step("A: settings defaults (enabled, 30 days, notify office)", async () => { const s = await A.query("organizations:getJobAutomationSettings", { orgId }); assert(s.settings.enabled && s.settings.leadDays === 30 && s.settings.notifyOffice, JSON.stringify(s)); });
await refused("A: engineer can't change automation settings", () => E.mutation("organizations:updateJobAutomationSettings", { orgId, enabled: false }), /permission|not allowed|role/i);
await refused("A: leadDays 400 refused", () => A.mutation("organizations:updateJobAutomationSettings", { orgId, leadDays: 400 }), /365/);

let r1;
const job1 = await step("A: daily run creates jobs for s1 (10d) + s3 (45d, 60d override); skips 60d, paused, autoCreateJob=false", async () => {
  r1 = plan(orgId); assert(r1.automation.jobsCreated === 2, JSON.stringify(r1.automation));
  const jobs = (await A.query("jobs:list", { orgId, paginationOpts: { numItems: 50, cursor: null } })).page;
  const j1 = jobs.find((j) => j.scheduleId === s1), j3 = jobs.find((j) => j.scheduleId === s3);
  assert(j1 && j3 && !jobs.some((j) => [s2, s4, s5].includes(j.scheduleId)), "right schedules");
  const g = await A.query("jobs:get", { jobId: j1._id });
  assert(g.status === "draft" && g.autoCreated && g.scheduleDueAt === T0 + 10 * D && g.type === "routine_service" && g.siteId === siteId && g.clientId === clientId && g.disciplines[0] === "fire_alarm", "fields " + JSON.stringify({ s: g.status, a: g.autoCreated, t: g.type }));
  assert(g.assignedEngineerIds[0] === eId && g.qualificationWarnings.length === 0, "default engineer, qualified");
  const g3 = await A.query("jobs:get", { jobId: j3._id });
  assert(g3.assignedEngineerIds[0] === e2Id && g3.qualificationWarnings.length === 1, "E2 unqualified warning");
  return { j1: j1._id, j3: j3._id };
});
await step("A: audit job.auto_created (system actor) with qualification warning for E2", async () => { const p = peek(orgId); const a = p.audit.filter((x) => x.action === "job.auto_created"); assert(a.length === 2 && a.every((x) => x.actor === null) && a.some((x) => x.changes.qualificationWarnings?.length === 1), JSON.stringify(a).slice(0, 300)); });
await step("A: office summary email (dry run) lists the jobs", async () => { await settle(); const p = peek(orgId); const r = p.reminders.find((x) => x.sourceType === "jobs_auto_created"); assert(r && r.jobIds.length === 2, "reminder"); const n = p.notifications.filter((x) => x.reminderId === r._id); assert(n.length >= 1 && n.every((x) => x.status === "skipped_no_provider") && /2 routine jobs/.test(n[0].subject) && n[0].body.includes("Northgate House"), JSON.stringify(n).slice(0, 300)); });
await step("A: re-run is deduped (0 created)", async () => { const r = plan(orgId); assert(r.automation.jobsCreated === 0 && r.automation.jobsSkipped.already_has_job === 2, JSON.stringify(r.automation)); });
await step("A: runAutoJobsNow (office) also deduped", async () => { const r = await A.mutation("serviceSchedules:runAutoJobsNow", { orgId }); assert(r.created.length === 0, JSON.stringify(r)); });
await refused("A: engineer can't runAutoJobsNow", () => E.mutation("serviceSchedules:runAutoJobsNow", { orgId }), /permission|not allowed|role/i);
await step("A: unpause s4 -> job created; end s4 -> its unscheduled auto job cancelled", async () => {
  await A.mutation("serviceSchedules:setStatus", { scheduleId: s4, status: "active" });
  const r = await A.mutation("serviceSchedules:runAutoJobsNow", { orgId }); assert(r.created.length === 1, "created");
  await A.mutation("serviceSchedules:setStatus", { scheduleId: s4, status: "ended" });
  assert((await A.query("jobs:get", { jobId: r.created[0] })).status === "cancelled", "cancelled");
});
await step("A: paused schedule keeps its existing job, gets no new one", async () => {
  await A.mutation("serviceSchedules:setStatus", { scheduleId: s3, status: "paused" });
  const r = plan(orgId, T0 + 50 * D); assert(r.automation.jobsCreated === 1, "only s2 (now in window) " + JSON.stringify(r.automation)); // s2 due T0+60 within 30 of T0+50
  assert((await A.query("jobs:get", { jobId: job1.j3 })).status === "draft", "s3 job kept");
  await A.mutation("serviceSchedules:setStatus", { scheduleId: s3, status: "active" });
});
await step("A: completing the auto job advances the schedule; next cycle gets the next job", async () => {
  await E.mutation("jobs:setStatus", { jobId: job1.j1, status: "in_progress" });
  await E.mutation("jobs:setStatus", { jobId: job1.j1, status: "completed" });
  const s = await A.query("serviceSchedules:get", { scheduleId: s1 }); assert(s.nextDueAt > T0 + 300 * D, "advanced ~12 months");
  assert(plan(orgId).automation.jobsCreated === 0, "next cycle outside 30d window today");
  const r = plan(orgId, s.nextDueAt - 20 * D); assert(r.automation.jobsCreated === 1, JSON.stringify(r.automation));
  const jobs = (await A.query("jobs:list", { orgId, paginationOpts: { numItems: 50, cursor: null } })).page.filter((j) => j.scheduleId === s1);
  assert(jobs.length === 2 && jobs.some((j) => j.scheduleDueAt === s.nextDueAt && j.status === "draft"), "new cycle job");
});
await step("A: org toggle off -> nothing created (s3 next cycle etc.), on again -> resumes", async () => {
  await A.mutation("organizations:updateJobAutomationSettings", { orgId, enabled: false });
  const sched = await A.query("serviceSchedules:get", { scheduleId: s5 });
  await A.mutation("serviceSchedules:update", { scheduleId: s5, autoCreateJob: true });
  const off = plan(orgId); assert(off.automation.jobAutomationDisabled && off.automation.jobsCreated === 0, JSON.stringify(off.automation));
  await A.mutation("organizations:updateJobAutomationSettings", { orgId, enabled: true });
  const on = plan(orgId); assert(on.automation.jobsCreated === 1, JSON.stringify(on.automation));
});
await step("A: due-date edit re-points the open auto job (no duplicate)", async () => {
  const before = (await A.query("jobs:list", { orgId, paginationOpts: { numItems: 50, cursor: null } })).page.filter((j) => j.scheduleId === s5);
  await A.mutation("serviceSchedules:update", { scheduleId: s5, nextDueAt: T0 + 8 * D });
  const r = plan(orgId); assert(r.automation.jobsCreated === 0, "no dup");
  const j = await A.query("jobs:get", { jobId: before[0]._id }); assert(j.scheduleDueAt === T0 + 8 * D, "re-pointed");
});

/* ======================= B) qualification checks ======================= */
const faType = await A.mutation("certificateTypes:create", { orgId, discipline: "fire_alarm", name: "BS 5839-1 Inspection & Servicing", code: "FA-IS", numberPrefix: "FA-", validityMonths: 12, requiresClientSignature: false });
const elType = await A.mutation("certificateTypes:create", { orgId, discipline: "emergency_lighting", name: "BS 5266-1 Periodic Test", code: "EL-PT", numberPrefix: "EL-", validityMonths: 12, requiresClientSignature: false });
const sig = (n) => ({ signedByName: n });
const faCert = await step("B: engineer creates FA draft", () => E.mutation("certificates:createDraft", { certificateTypeId: faType, siteId }));
await step("B: qualificationCheck query (qualified engineer)", async () => { const q = await E.query("certificates:qualificationCheck", { certificateId: faCert }); assert(q.qualified && /valid to/.test(q.detail) && q.canOverride === false, JSON.stringify(q)); });
await refused("B: engineer with no qualification can't sign", () => E2.mutation("certificates:sign", { certificateId: faCert, as: "engineer", signature: sig("Nina") }), /no Fire.*qualification on record/i);
await step("B: qualified engineer signs; check recorded", async () => { const r = await E.mutation("certificates:sign", { certificateId: faCert, as: "engineer", signature: sig("Eddie Engineer") }); assert(r.qualification.qualified && !r.qualification.overridden, JSON.stringify(r)); const c = await A.query("certificates:get", { certificateId: faCert }); assert(c.qualificationChecks.length === 1 && c.qualificationChecks[0].stage === "sign" && c.qualificationOverridden === false, "recorded"); });
await refused("B: other unqualified engineer can't issue someone else's certificate", () => E2.mutation("certificates:issue", { certificateId: faCert }), /Nina|no Fire/i);
await step("B: qualification expires between sign and issue -> issue blocked", async () => {
  const quals = await A.query("qualifications:list", { orgId, userId: eId }); const fa = quals.find((q) => q.discipline === "fire_alarm");
  await A.mutation("qualifications:update", { qualificationId: fa._id, expiresAt: T0 - 1 * D });
  try { await E.mutation("certificates:issue", { certificateId: faCert }); throw new Error("not blocked"); } catch (e) { assert(/expired on/.test(String(e.data ?? e.message)), String(e.data ?? e.message)); }
  return fa._id;
});
await refused("B: engineer can't use override reason", () => E.mutation("certificates:issue", { certificateId: faCert, qualificationOverrideReason: "I'm renewing next week" }), /Only an owner or admin/);
await refused("B: owner without reason still blocked", () => A.mutation("certificates:issue", { certificateId: faCert }), /ask an owner\/admin/);
await refused("B: override reason too short", () => A.mutation("certificates:issue", { certificateId: faCert, qualificationOverrideReason: "ok" }), /at least 5/);
await step("B: owner issues with override reason; recorded on certificate + audit", async () => {
  const r = await A.mutation("certificates:issue", { certificateId: faCert, qualificationOverrideReason: "Renewal certificate seen, awaiting upload" }); assert(r.certificateId, "issued");
  const c = await A.query("certificates:get", { certificateId: faCert });
  const ic = c.qualificationChecks.find((x) => x.stage === "issue");
  assert(c.status === "issued" && c.qualificationOverridden && ic.override.reason.startsWith("Renewal") && ic.override.byUserId === aId && !ic.qualified, JSON.stringify(c.qualificationChecks));
  const a = peek(orgId).audit.filter((x) => x.action === "certificate.qualification_override"); assert(a.length === 1 && a[0].changes.stage === "issue", "audit");
});
const elCert = await E.mutation("certificates:createDraft", { certificateTypeId: elType, siteId });
await refused("B: expired qualification blocks signing (clear message)", () => E.mutation("certificates:sign", { certificateId: elCert, as: "engineer", signature: sig("Eddie") }), /qualification "FIA Emergency Lighting" expired on .*Add or renew/);
await step("B: owner (unqualified) signs with override; issue inherits sign override (no second reason)", async () => {
  const r = await A.mutation("certificates:sign", { certificateId: elCert, as: "engineer", signature: sig("Owner"), qualificationOverrideReason: "Sole qualified engineer off sick; owner supervised test" });
  assert(r.qualification.overridden, "overridden");
  const q = await A.query("certificates:qualificationCheck", { certificateId: elCert }); assert(!q.qualified && q.coveredByPriorOverride && q.canOverride, JSON.stringify(q));
  await A.mutation("certificates:issue", { certificateId: elCert });
  const c = await A.query("certificates:get", { certificateId: elCert }); assert(c.qualificationChecks.length === 2 && c.qualificationChecks.every((x) => x.override), "both stages carry override");
});
await step("B: reissue draft starts with no qualification checks", async () => { const { certificateId } = await A.mutation("certificates:reissue", { certificateId: elCert, reason: "typo" }); const c = await A.query("certificates:get", { certificateId }); assert(!c.qualificationChecks?.length, "cleared"); });
await step("B: assignEngineers returns warnings (expired EL), still assigns", async () => {
  const jobId = await A.mutation("jobs:create", { siteId, type: "remedial", disciplines: ["emergency_lighting"], title: "Replace EL batteries" });
  const r = await A.mutation("jobs:assignEngineers", { jobId, engineerIds: [eId] });
  assert(r.warnings.length === 1 && /expired on/.test(r.warnings[0].message), JSON.stringify(r));
  const g = await A.query("jobs:get", { jobId }); assert(g.assignedEngineerIds[0] === eId && g.qualificationWarnings.length === 1, "assigned + get warnings");
});
await step("B: checkAssignment preview", async () => { const r = await A.query("jobs:checkAssignment", { orgId, engineerIds: [eId, e2Id], disciplines: ["fire_alarm", "emergency_lighting"] }); assert(r.warnings.length === 4, JSON.stringify(r.warnings.map((w) => w.message))); });

/* ======================= C) overdue invoices ======================= */
const mkInv = async () => { const id = await A.mutation("invoices:create", { clientId, siteId, paymentTermsDays: 0, lines: [{ description: "Annual fire alarm service", quantity: 1, unitPrice: 25000 }] }); await A.mutation("invoices:send", { invoiceId: id }); return id; };
const inv1 = await mkInv(); const inv2 = await mkInv(); const inv3 = await mkInv();
await refused("C: invoiceOverdueDays 0 refused", () => A.mutation("organizations:updateReminderSettings", { orgId, invoiceOverdueDays: [0, 7] }), /1-365/);
await step("C: day 1 -> flagged overdue (overdueSince, audit, still 'sent' stored) + od1 reminder to client and office (dry run)", async () => {
  const t = T0 + 1 * D + 3600e3; const r = plan(orgId, t);
  assert(r.automation.invoicesFlaggedOverdue === 3 && r.created.invoice_overdue === 3, JSON.stringify(r));
  const g = await A.query("invoices:get", { invoiceId: inv1 }); assert(g.status === "overdue" && g.overdueSince === t, JSON.stringify({ s: g.status, o: g.overdueSince }));
  await settle(); const p = peek(orgId);
  const rem = p.reminders.find((x) => x.invoiceId === inv1 && x.stage === "od1"); assert(rem && rem.audience === "both", "reminder");
  const n = p.notifications.filter((x) => x.reminderId === rem._id); const cl = n.find((x) => x.recipientType === "client"), of = n.find((x) => x.recipientType === "org");
  assert(cl && of && n.every((x) => x.status === "skipped_no_provider"), JSON.stringify(n.map((x) => [x.recipientType, x.status])));
  assert(/Payment reminder/.test(cl.subject) && cl.body.includes("£300.00") && cl.body.includes("20-45-77") && cl.body.includes("/pdf/i/"), cl.subject + cl.body.slice(0, 200));
  assert(/^Chase: invoice/.test(of.subject), of.subject);
  assert(p.audit.filter((x) => x.action === "invoice.overdue" && x.actor === null).length === 3, "audit");
});
await step("C: list(status:'overdue') returns them", async () => { const l = await A.query("invoices:list", { orgId, status: "overdue", paginationOpts: { numItems: 20, cursor: null } }); assert(l.page.length === 3, String(l.page.length)); });
await step("C: same day re-run deduped; day 3 nothing new; day 8 -> od7", async () => {
  assert(plan(orgId, T0 + 1 * D + 7200e3).created.invoice_overdue === 0, "dedupe");
  assert(plan(orgId, T0 + 3 * D).created.invoice_overdue === 0, "between stages");
  assert(plan(orgId, T0 + 8 * D).created.invoice_overdue === 3, "od7");
});
await step("C: part payment stays overdue; full payment clears overdueSince (audit) and stops reminders", async () => {
  await A.mutation("invoices:recordPayment", { invoiceId: inv1, amount: 10000, method: "bank_transfer" });
  let g = await A.query("invoices:get", { invoiceId: inv1 }); assert(g.status === "overdue" && g.overdueSince, "still overdue");
  await A.mutation("invoices:recordPayment", { invoiceId: inv1, amount: g.total - 10000, method: "bank_transfer" });
  g = await A.query("invoices:get", { invoiceId: inv1 }); assert(g.status === "paid" && g.overdueSince === undefined, "cleared");
  assert(peek(orgId).audit.some((x) => x.action === "invoice.overdue_cleared" && x.entityId === inv1), "audit");
});
await step("C: void clears overdueSince", async () => { await A.mutation("invoices:voidInvoice", { invoiceId: inv2, reason: "Raised in error" }); const g = await A.query("invoices:get", { invoiceId: inv2 }); assert(g.status === "void" && g.overdueSince === undefined, "void"); });
await step("C: client reminders off + custom stages [15] -> office-only od15, only for the open invoice", async () => {
  await A.mutation("organizations:updateReminderSettings", { orgId, invoiceOverdueDays: [15], invoiceRemindClient: false });
  const r = plan(orgId, T0 + 16 * D); assert(r.created.invoice_overdue === 1, JSON.stringify(r.created));
  const rem = peek(orgId).reminders.find((x) => x.stage === "od15"); assert(rem.invoiceId === inv3 && rem.audience === "org", JSON.stringify(rem));
});
await step("C: with reminders disabled, overdue flag still recorded (no reminders)", async () => {
  await A.mutation("organizations:updateReminderSettings", { orgId, enabled: false });
  const inv4 = await mkInv(); const r = plan(orgId, T0 + 2 * D);
  assert(r.disabled && r.automation.invoicesFlaggedOverdue === 1, JSON.stringify(r));
  assert((await A.query("invoices:get", { invoiceId: inv4 })).overdueSince, "flagged");
});
await step("C: reminder queued, invoice then paid -> cancelled at dispatch ('invoice paid or void')", async () => {
  await A.mutation("organizations:updateReminderSettings", { orgId, enabled: true, invoiceOverdueDays: [1, 7, 14, 30], invoiceRemindClient: true });
  const t = T0 + 31 * D; const r = cx("reminders:planForOrg", { orgId, now: t, dispatch: false }); assert(r.created.invoice_overdue === 2, JSON.stringify(r.created));
  const g = await A.query("invoices:get", { invoiceId: inv3 }); await A.mutation("invoices:recordPayment", { invoiceId: inv3, amount: g.total, method: "card" });
  cx("reminders:dispatchForOrg", { orgId, now: t });
  const od30 = peek(orgId).reminders.filter((x) => x.stage === "od30"); const a = od30.find((x) => x.invoiceId === inv3), b = od30.find((x) => x.invoiceId !== inv3);
  assert(a.status === "cancelled" && a.cancelReason === "invoice paid or void" && b.status !== "pending" && b.status !== "cancelled", JSON.stringify(od30));
});

console.log(results.map((r) => r.join("  ")).join("\n"));
console.log(`\n${results.length - failures}/${results.length} passed  (run ${run}, orgId ${orgId})`);
process.exit(failures ? 1 : 0);
