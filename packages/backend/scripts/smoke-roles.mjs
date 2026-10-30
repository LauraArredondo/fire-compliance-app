// Smoke test: server-side role scoping (owner/admin/office see all; engineer only assigned jobs + their sites;
// client_user portal unchanged). Creates a temp org "Smoke Roles <run>" and deletes it at the end
// via internal testing:cleanupSmokeOrg (needs ALLOW_TEST_CLEANUP=1 on the dev deployment). DEV only.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { ConvexHttpClient } from "../node_modules/convex/dist/esm/browser/index.js";
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const URL_ = env.CONVEX_URL || env.VITE_CONVEX_URL || "https://elegant-echidna-735.convex.cloud";
if (!URL_.includes("elegant-echidna-735")) throw new Error("Refusing to run outside the dev deployment");
const run = Date.now().toString(36); const PW = "Smoke-Test-" + run + "-Pw1!";
const results = []; let failures = 0;
async function step(name, fn) { try { const r = await fn(); results.push(["PASS", name]); return r; } catch (e) { failures++; results.push(["FAIL", name, String(e?.data ?? e?.message ?? e).slice(0, 300)]); } }
async function refused(name, fn, match) {
  try { await fn(); failures++; results.push(["FAIL", name, "expected refusal but call succeeded"]); }
  catch (e) {
    const msg = String(e?.data ?? e?.message ?? e);
    if (match && !match.test(msg)) { failures++; results.push(["FAIL", name, "wrong error: " + msg.slice(0, 200)]); }
    else results.push(["PASS", name + "  -> " + msg.slice(0, 70)]);
  }
}
const assert = (c, m) => { if (!c) throw new Error("assert: " + m); };
async function user(email) { const c = new ConvexHttpClient(URL_); const r = await c.action("auth:signIn", { provider: "password", params: { email, password: PW, flow: "signUp" } }); c.setAuth(r.tokens.token); return c; }
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
async function upload(url) { const r = await fetch(url, { method: "POST", headers: { "Content-Type": "image/png" }, body: PNG }); return (await r.json()).storageId; }
const P = { numItems: 50, cursor: null };
const NOT_JOB = /not assigned to this job/, NOT_SITE = /not assigned to a job at this site|Site not found|not found/, NOPERM = /Insufficient permissions/;

let orgId;
try {
  // ---------- setup (owner) ----------
  const A = await user(`owner+${run}@smoke.test`), E = await user(`eng+${run}@smoke.test`), C = await user(`clara+${run}@smoke.test`);
  ({ orgId } = await A.mutation("organizations:createWithOwner", { name: `Smoke Roles ${run}`, disciplines: ["fire_alarm"] }));
  const t = await A.mutation("team:invite", { orgId, email: `eng+${run}@smoke.test`, name: "Eddie", role: "engineer" }); await E.mutation("team:acceptInvitation", { token: t.token });
  const eId = (await A.query("team:list", { orgId })).find((m) => m.role === "engineer").userId;
  await A.mutation("qualifications:create", { orgId, userId: eId, discipline: "fire_alarm", title: "BAFE", expiresAt: Date.now() + 400 * 864e5 });
  await A.mutation("organizations:updateBillingSettings", { orgId, bankDetails: { bankName: "Barclays", accountName: "Smoke Ltd", sortCode: "204577", accountNumber: "43218765" }, quoteTerms: "30 days", invoiceFooter: "Thanks" });
  const cX = await A.mutation("clients:create", { orgId, name: "Assigned Client", type: "commercial", accountNumber: "ACC-1", notes: "internal note", billingAddress: { line1: "1 Bill St" }, primaryContact: { name: "Clara", email: `clara+${run}@smoke.test` } });
  const cY = await A.mutation("clients:create", { orgId, name: "Other Client", type: "commercial", accountNumber: "ACC-2", notes: "secret" });
  const s1 = await A.mutation("sites:create", { orgId, clientId: cX, name: "Assigned Site", address: { line1: "1 High St", city: "Leeds" } });
  const s2 = await A.mutation("sites:create", { orgId, clientId: cY, name: "Other Site", address: { line1: "2 Low St", city: "York" } });
  const s1b = await A.mutation("sites:create", { orgId, clientId: cX, name: "Assigned Client Annex", address: { line1: "3 Side St", city: "Leeds" } });
  const pi = await A.mutation("portal:createInvitation", { clientId: cX, email: `clara+${run}@smoke.test`, name: "Clara" }); await C.mutation("portal:acceptInvitation", { token: pi.token });
  const soon = Date.now() + 3600e3;
  const j1 = await A.mutation("jobs:create", { siteId: s1, type: "routine_service", disciplines: ["fire_alarm"], title: "Assigned job", scheduledStart: soon, assignedEngineerIds: [eId] });
  const j2 = await A.mutation("jobs:create", { siteId: s2, type: "routine_service", disciplines: ["fire_alarm"], title: "Unassigned job", scheduledStart: soon });
  const typeId = await A.mutation("assetTypes:create", { orgId, discipline: "fire_alarm", name: "Detector" });
  const a1 = await A.mutation("assets:create", { siteId: s1, assetTypeId: typeId, reference: "A1" });
  const a2 = await A.mutation("assets:create", { siteId: s2, assetTypeId: typeId, reference: "A2" });
  const l2 = await A.mutation("locations:create", { siteId: s2, kind: "building", name: "Other building" });
  const d1 = await A.mutation("defects:raise", { siteId: s1, discipline: "fire_alarm", title: "D1", severity: "minor" });
  const d2 = await A.mutation("defects:raise", { siteId: s2, discipline: "fire_alarm", title: "D2", severity: "minor" });
  const ct = await A.mutation("certificateTypes:create", { orgId, discipline: "fire_alarm", name: "FA", code: "FA", numberPrefix: "FA-", validityMonths: 12, requiresClientSignature: false });
  const cert2 = await A.mutation("certificates:createDraft", { certificateTypeId: ct, siteId: s2 });
  const q1 = await A.mutation("quotes:create", { clientId: cX, siteId: s1, title: "Quote", lines: [{ kind: "service", description: "x", quantity: 1, unitPrice: 1000 }] }); await A.mutation("quotes:send", { quoteId: q1 });
  const sched = await A.mutation("serviceSchedules:create", { siteId: s1, discipline: "fire_alarm", name: "Annual", frequency: { interval: 12, unit: "month" }, nextDueAt: Date.now() + 7 * 864e5 });
  const v1 = await E.mutation("visits:start", { jobId: j1 });
  const v2 = await A.mutation("visits:start", { jobId: j2 });
  await A.mutation("attachments:attach", { orgId, entityType: "job", entityId: j2, storageId: await upload(await A.mutation("attachments:generateUploadUrl", { orgId })), fileName: "j2.png" });
  await A.mutation("reminders:runNow", { orgId });
  let rem = []; for (let i = 0; i < 20 && !rem.length; i++) { await new Promise((r) => setTimeout(r, 500)); for (const status of ["pending", "dispatched", "no_recipients"]) rem = rem.length ? rem : await A.query("reminders:list", { orgId, status }); }
  const notif = (await A.query("reminders:listNotifications", { orgId }))[0];
  const sitesOf = (rows) => rows.map((r) => r.siteId).sort().join();

  // 1. job detail + job children
  await step("1 jobs:get assigned job ok", async () => { const j = await E.query("jobs:get", { jobId: j1 }); assert(j._id === j1, "job"); });
  await refused("1 jobs:get unassigned job refused", () => E.query("jobs:get", { jobId: j2 }), NOT_JOB);
  await step("1 visits:listByJob assigned ok", async () => { const l = await E.query("visits:listByJob", { jobId: j1 }); assert(l.length === 1, "1 visit"); });
  await refused("1 visits:listByJob unassigned refused", () => E.query("visits:listByJob", { jobId: j2 }), NOT_JOB);
  await step("1 inspections:listForVisit assigned ok", () => E.query("inspections:listForVisit", { visitId: v1 }));
  await refused("1 inspections:listForVisit unassigned refused", () => E.query("inspections:listForVisit", { visitId: v2 }), NOT_SITE);
  await step("1 attachments:listForEntity job assigned ok", () => E.query("attachments:listForEntity", { orgId, entityType: "job", entityId: j1 }));
  await refused("1 attachments:listForEntity job unassigned refused", () => E.query("attachments:listForEntity", { orgId, entityType: "job", entityId: j2 }), NOT_JOB);
  await refused("1 attachments:listForEntity quote refused", () => E.query("attachments:listForEntity", { orgId, entityType: "quote", entityId: q1 }), NOPERM);
  await step("1 owner still sees job 2 + its attachment", async () => { await A.query("jobs:get", { jobId: j2 }); const l = await A.query("attachments:listForEntity", { orgId, entityType: "job", entityId: j2 }); assert(l.length === 1, "1 file"); });

  // 2. jobs:list
  await step("2 jobs:list engineer -> only assigned", async () => { const r = (await E.query("jobs:list", { orgId, paginationOpts: P })).page; assert(r.length === 1 && r[0]._id === j1 && r[0].siteName === "Assigned Site", JSON.stringify(r.map((x) => x.title))); });
  await step("2 jobs:list engineer siteId=other -> empty; status filter works", async () => { const a = (await E.query("jobs:list", { orgId, siteId: s2, paginationOpts: P })).page; const b = (await E.query("jobs:list", { orgId, status: "cancelled", paginationOpts: P })).page; assert(a.length === 0 && b.length === 0, "empty"); });
  await step("2 jobs:list owner -> both", async () => { const r = (await A.query("jobs:list", { orgId, paginationOpts: P })).page; assert(r.length >= 2 && r.some((x) => x._id === j2), String(r.length)); /* schedule auto-job may add a 3rd */ });

  // 3. site-scoped reads
  await step("3 sites:list engineer -> only assigned site", async () => { const r = (await E.query("sites:list", { orgId, paginationOpts: P })); assert(r.page.length === 1 && r.page[0]._id === s1 && r.page[0].clientName === "Assigned Client" && r.isDone, JSON.stringify(r.page.map((x) => x.name))); });
  await step("3 sites:list owner -> all 3", async () => { assert((await A.query("sites:list", { orgId, paginationOpts: P })).page.length === 3, "3"); });
  await step("3 sites:get assigned ok", () => E.query("sites:get", { siteId: s1 }));
  await refused("3 sites:get other refused", () => E.query("sites:get", { siteId: s2 }), NOT_SITE);
  await refused("3 sites:get same-client unassigned site refused", () => E.query("sites:get", { siteId: s1b }), NOT_SITE);
  await step("3 assets:list/get assigned ok", async () => { await E.query("assets:list", { siteId: s1, paginationOpts: P }); await E.query("assets:get", { assetId: a1 }); });
  await refused("3 assets:list other refused", () => E.query("assets:list", { siteId: s2, paginationOpts: P }), NOT_SITE);
  await refused("3 assets:get other refused", () => E.query("assets:get", { assetId: a2 }), NOT_SITE);
  await refused("3 locations:listBySite other refused", () => E.query("locations:listBySite", { siteId: s2 }), NOT_SITE);
  await refused("3 defects:openForSite other refused", () => E.query("defects:openForSite", { orgId, siteId: s2 }), NOT_SITE);
  await refused("3 certificates:listBySite other refused", () => E.query("certificates:listBySite", { orgId, siteId: s2 }), NOT_SITE);
  await step("3 defects:openForSite + certificates:listBySite assigned ok", async () => { await E.query("defects:openForSite", { orgId, siteId: s1 }); await E.query("certificates:listBySite", { orgId, siteId: s1 }); });

  // 4. clients
  await step("4 clients:list engineer -> only {_id,name} of assigned client", async () => { const r = (await E.query("clients:list", { orgId, paginationOpts: P })).page; assert(r.length === 1 && r[0]._id === cX && Object.keys(r[0]).sort().join() === "_id,name", JSON.stringify(r)); });
  await step("4 clients:get engineer -> {_id,name}", async () => { const c = await E.query("clients:get", { clientId: cX }); assert(Object.keys(c).sort().join() === "_id,name", JSON.stringify(c)); });
  await refused("4 clients:get engineer other client refused", () => E.query("clients:get", { clientId: cY }), /not assigned/);
  await step("4 clients:get portal user -> no notes/accountNumber/externalAccountingId", async () => { const c = await C.query("clients:get", { clientId: cX }); assert(c.name && c.billingAddress && !("notes" in c) && !("accountNumber" in c) && !("externalAccountingId" in c), JSON.stringify(Object.keys(c))); });
  await step("4 clients:get owner -> full record", async () => { const c = await A.query("clients:get", { clientId: cX }); assert(c.accountNumber === "ACC-1" && c.notes === "internal note", "full"); });

  // 5. quotes
  await refused("5 quotes:list engineer refused", () => E.query("quotes:list", { orgId, paginationOpts: P }), NOPERM);
  await refused("5 quotes:get engineer refused", () => E.query("quotes:get", { quoteId: q1 }), NOPERM);
  await refused("5 quotes:getPdf engineer refused", () => E.query("quotes:getPdf", { quoteId: q1 }), NOPERM);
  await step("5 quotes:list/get portal user still ok", async () => { const r = (await C.query("quotes:list", { orgId, paginationOpts: P })).page; assert(r.length === 1, "1 quote"); await C.query("quotes:get", { quoteId: q1 }); });

  // 6. organizations:get
  await step("6 organizations:get engineer -> no bank/billing settings", async () => { const o = await E.query("organizations:get", { orgId }); assert(o.name && o.role === "engineer" && !("bankDetails" in o) && !("quoteTerms" in o) && !("invoiceFooter" in o) && !("defaultTaxRate" in o), JSON.stringify(Object.keys(o))); });
  await step("6 organizations:get owner -> bank details present", async () => { const o = await A.query("organizations:get", { orgId }); assert(o.bankDetails?.sortCode && o.quoteTerms, "bank"); });

  // 7. schedules
  await refused("7 serviceSchedules:list engineer refused", () => E.query("serviceSchedules:list", { orgId, paginationOpts: P }), NOPERM);
  await refused("7 serviceSchedules:get engineer refused", () => E.query("serviceSchedules:get", { scheduleId: sched }), NOPERM);
  await refused("7 serviceSchedules:dueSoon engineer refused", () => E.query("serviceSchedules:dueSoon", { orgId }), NOPERM);
  await step("7 serviceSchedules:list portal user (own site) still ok", () => C.query("serviceSchedules:list", { orgId, siteId: s1, paginationOpts: P }));

  // 8. reminders
  await refused("8 reminders:list engineer refused", () => E.query("reminders:list", { orgId }), NOPERM);
  await refused("8 reminders:listNotifications engineer refused", () => E.query("reminders:listNotifications", { orgId }), NOPERM);
  await step("8 fixtures: reminder + notification exist", () => assert(rem.length > 0 && notif, `reminders ${rem.length}, notification ${!!notif}`));
  if (notif) await refused("8 reminders:getNotification engineer refused", () => E.query("reminders:getNotification", { notificationId: notif._id }), NOPERM);
  if (rem[0]) await refused("8 reminders:snooze engineer refused", () => E.mutation("reminders:snooze", { reminderId: rem[0]._id, days: 3 }), NOPERM);
  if (rem[0]) await refused("8 reminders:dismiss engineer refused", () => E.mutation("reminders:dismiss", { reminderId: rem[0]._id }), NOPERM);

  // 9. defects
  await step("9 defects:list engineer -> only assigned sites", async () => { const r = (await E.query("defects:list", { orgId, status: "all", paginationOpts: P })).page; assert(r.length === 1 && r[0]._id === d1, sitesOf(r)); });
  await step("9 defects:list owner -> both", async () => { assert((await A.query("defects:list", { orgId, status: "all", paginationOpts: P })).page.length === 2, "2"); });
  await refused("9 defects:list engineer siteId=other refused", () => E.query("defects:list", { orgId, siteId: s2, paginationOpts: P }), NOT_SITE);
  await step("9 defects:raise on assigned site ok", () => E.mutation("defects:raise", { siteId: s1, discipline: "fire_alarm", title: "Eng defect", severity: "minor" }));
  await refused("9 defects:raise on other site refused", () => E.mutation("defects:raise", { siteId: s2, discipline: "fire_alarm", title: "x", severity: "minor" }), NOT_SITE);
  await refused("9 defects:update other site refused", () => E.mutation("defects:update", { defectId: d2, title: "x" }), NOT_SITE);
  await step("9 defects:update assigned site ok", () => E.mutation("defects:update", { defectId: d1, title: "D1 edited" }));

  // 10. certificates
  const cert1 = await step("10 certificates:createDraft from assigned job ok", () => E.mutation("certificates:createDraft", { certificateTypeId: ct, jobId: j1 }));
  await refused("10 certificates:createDraft other site refused", () => E.mutation("certificates:createDraft", { certificateTypeId: ct, siteId: s2 }), NOT_SITE);
  await refused("10 certificates:createDraft unassigned job refused", () => E.mutation("certificates:createDraft", { certificateTypeId: ct, jobId: j2 }), NOT_SITE);
  await refused("10 certificates:updateDraft other site refused", () => E.mutation("certificates:updateDraft", { certificateId: cert2, summary: "x" }), NOT_SITE);
  await refused("10 certificates:sign other site refused", () => E.mutation("certificates:sign", { certificateId: cert2, as: "engineer", signature: { signedByName: "Eddie" } }), NOT_SITE);
  await refused("10 certificates:issue other site refused", () => E.mutation("certificates:issue", { certificateId: cert2 }), NOT_SITE);
  await refused("10 certificates:get/getPdf other site refused", async () => { await E.query("certificates:getPdf", { certificateId: cert2 }).catch(async (e) => { await E.query("certificates:get", { certificateId: cert2 }); throw e; }); }, NOT_SITE);
  await step("10 certificates:updateDraft + sign + issue on assigned job ok", async () => { await E.mutation("certificates:updateDraft", { certificateId: cert1, summary: "All good" }); await E.mutation("certificates:sign", { certificateId: cert1, as: "engineer", signature: { signedByName: "Eddie" } }); await E.mutation("certificates:issue", { certificateId: cert1 }); });
  await step("10 certificates:list engineer -> only assigned sites", async () => { const r = (await E.query("certificates:list", { orgId, status: "all", paginationOpts: P })).page; assert(r.length === 1 && r[0]._id === cert1, sitesOf(r)); });
  await step("10 certificates:list owner -> both", async () => { assert((await A.query("certificates:list", { orgId, status: "all", paginationOpts: P })).page.length === 2, "2"); });
  await refused("10 certificates:reissue engineer refused (office+)", () => E.mutation("certificates:reissue", { certificateId: cert1 }), NOPERM);
  await step("10 certificates:reissue owner ok", () => A.mutation("certificates:reissue", { certificateId: cert1 }));

  // 11. assets / locations mutations
  await step("11 assets:create/update on assigned site ok", async () => { const id = await E.mutation("assets:create", { siteId: s1, assetTypeId: typeId, reference: "E1" }); await E.mutation("assets:update", { assetId: id, reference: "E1b" }); });
  await refused("11 assets:create other site refused", () => E.mutation("assets:create", { siteId: s2, assetTypeId: typeId, reference: "x" }), NOT_SITE);
  await refused("11 assets:update other site refused", () => E.mutation("assets:update", { assetId: a2, reference: "x" }), NOT_SITE);
  await refused("11 assets:setStatus other site refused", () => E.mutation("assets:setStatus", { assetId: a2, status: "defective" }), NOT_SITE);
  await refused("11 assets:move to unassigned site refused", () => E.mutation("assets:move", { assetId: a1, siteId: s1b }), NOT_SITE);
  await refused("11 assets:decommission other site refused", () => E.mutation("assets:decommission", { assetId: a2, status: "removed", reason: "x" }), NOT_SITE);
  await step("11 locations:create on assigned site ok", () => E.mutation("locations:create", { siteId: s1, kind: "building", name: "Main" }));
  await refused("11 locations:create other site refused", () => E.mutation("locations:create", { siteId: s2, kind: "building", name: "x" }), NOT_SITE);
  await refused("11 locations:update other site refused", () => E.mutation("locations:update", { locationId: l2, name: "x" }), NOT_SITE);
  await refused("11 locations:remove other site refused", () => E.mutation("locations:remove", { locationId: l2 }), NOT_SITE);

  // assignment sync: unassign -> access gone; reassign -> back
  await step("sync: unassigning removes site + job access; reassigning restores it", async () => {
    await A.mutation("jobs:assignEngineers", { jobId: j1, engineerIds: [] });
    let gone = false; try { await E.query("sites:get", { siteId: s1 }); } catch { gone = true; }
    const l = (await E.query("jobs:list", { orgId, paginationOpts: P })).page;
    assert(gone && l.length === 0, "still visible after unassign");
    await A.mutation("jobs:assignEngineers", { jobId: j2, engineerIds: [eId] });
    await E.query("sites:get", { siteId: s2 }); await E.query("jobs:get", { jobId: j2 });
  });
} catch (e) { failures++; results.push(["FAIL", "setup/crash", String(e?.data ?? e?.message ?? e).slice(0, 400)]); }
finally {
  if (orgId) {
    try {
      const out = execFileSync("npx", ["convex", "run", "testing:cleanupSmokeOrg", JSON.stringify({ orgId })], { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      results.push(["PASS", "cleanup: temp org deleted " + out.replace(/\s+/g, " ").slice(0, 160)]);
    } catch (e) { failures++; results.push(["FAIL", "cleanup", String(e?.stderr ?? e).slice(0, 300)]); }
  }
}
for (const r of results) console.log(r.join("  "));
console.log(`\n${results.length - failures}/${results.length} passed  (run ${run})`);
process.exit(failures ? 1 : 0);
