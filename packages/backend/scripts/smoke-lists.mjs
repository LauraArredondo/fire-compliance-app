// Smoke test: list enrichment (clientName/siteName) + status "all" on staff lists. DEV only.
import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "../node_modules/convex/dist/esm/browser/index.js";
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const URL_ = env.CONVEX_URL || env.VITE_CONVEX_URL || "https://elegant-echidna-735.convex.cloud";
if (!URL_.includes("elegant-echidna-735")) throw new Error("Refusing to run outside the dev deployment");
const run = Date.now().toString(36); const PW = "Smoke-Test-" + run + "-Pw1!";
const results = []; let failures = 0;
async function step(name, fn) { try { await fn(); results.push(["PASS", name]); } catch (e) { failures++; results.push(["FAIL", name, String(e?.data ?? e?.message ?? e).slice(0, 300)]); } }
const assert = (c, m) => { if (!c) throw new Error("assert: " + m); };
async function user(email) { const c = new ConvexHttpClient(URL_); const r = await c.action("auth:signIn", { provider: "password", params: { email, password: PW, flow: "signUp" } }); c.setAuth(r.tokens.token); return c; }
const P = { numItems: 50, cursor: null };
const A = await user(`owner+${run}@smoke.test`); const E = await user(`eng+${run}@smoke.test`); const C = await user(`clara+${run}@smoke.test`);
const { orgId } = await A.mutation("organizations:createWithOwner", { name: "Lists Ltd", disciplines: ["fire_alarm"] });
const t = await A.mutation("team:invite", { orgId, email: `eng+${run}@smoke.test`, name: "Eddie", role: "engineer" }); await E.mutation("team:acceptInvitation", { token: t.token });
const eId = (await A.query("team:list", { orgId })).find((m) => m.role === "engineer").userId;
await A.mutation("qualifications:create", { orgId, userId: eId, discipline: "fire_alarm", title: "BAFE", expiresAt: Date.now() + 400 * 864e5 });
const clientId = await A.mutation("clients:create", { orgId, name: "Acme Estates", type: "commercial", primaryContact: { name: "Clara", email: `clara+${run}@smoke.test` } });
const siteId = await A.mutation("sites:create", { orgId, clientId, name: "Acme Tower", address: { line1: "1 High St", city: "Leeds", postcode: "LS1 1AA" } });
const pi = await A.mutation("portal:createInvitation", { clientId, email: `clara+${run}@smoke.test`, name: "Clara" }).catch(() => null);
if (pi?.token) await C.mutation("portal:acceptInvitation", { token: pi.token }).catch(() => null);

const jobId = await A.mutation("jobs:create", { siteId, type: "remedial", disciplines: ["fire_alarm"], title: "Fix", assignedEngineerIds: [eId] });
await A.mutation("serviceSchedules:create", { siteId, discipline: "fire_alarm", name: "Annual", frequency: { interval: 12, unit: "month" }, nextDueAt: Date.now() + 90 * 864e5 });
await A.mutation("defects:raise", { siteId, discipline: "fire_alarm", title: "Open defect", severity: "minor", visibleToClient: true });
const d2 = await A.mutation("defects:raise", { siteId, discipline: "fire_alarm", title: "Resolved defect", severity: "minor", visibleToClient: false });
await A.mutation("defects:setStatus", { defectId: d2, status: "resolved" }).catch(() => {});
const q1 = await A.mutation("quotes:create", { clientId, siteId, title: "Draft quote", lines: [{ kind: "service", description: "x", quantity: 1, unitPrice: 1000 }] });
const q2 = await A.mutation("quotes:create", { clientId, siteId, title: "Sent quote", lines: [{ kind: "service", description: "x", quantity: 1, unitPrice: 1000 }] }); await A.mutation("quotes:send", { quoteId: q2 });
const i1 = await A.mutation("invoices:create", { clientId, siteId, lines: [{ description: "x", quantity: 1, unitPrice: 1000 }] });
const i2 = await A.mutation("invoices:create", { clientId, siteId, lines: [{ description: "y", quantity: 1, unitPrice: 1000 }] }); await A.mutation("invoices:send", { invoiceId: i2 });
const ct = await A.mutation("certificateTypes:create", { orgId, discipline: "fire_alarm", name: "FA", code: "FA", numberPrefix: "FA-", validityMonths: 12, requiresClientSignature: false });
const c1 = await E.mutation("certificates:createDraft", { certificateTypeId: ct, siteId });
const c2 = await E.mutation("certificates:createDraft", { certificateTypeId: ct, siteId }); await E.mutation("certificates:sign", { certificateId: c2, as: "engineer", signature: { signedByName: "Eddie" } }); await E.mutation("certificates:issue", { certificateId: c2 });

const named = (rows) => rows.length > 0 && rows.every((r) => r.clientName === "Acme Estates" && r.siteName === "Acme Tower");
const L = (fn, a) => A.query(fn, { orgId, paginationOpts: P, ...a });
await step("certificates: default (issued) unchanged + names", async () => { const r = (await L("certificates:list", {})).page; assert(r.length === 1 && r[0]._id === c2 && named(r), JSON.stringify(r.map((x) => [x.status, x.clientName, x.siteName]))); });
await step("certificates: status 'all' returns draft + issued, newest first", async () => { const r = (await L("certificates:list", { status: "all" })).page; assert(r.length === 2 && r[0]._id === c2 && named(r), JSON.stringify(r.map((x) => x.status))); });
await step("certificates: specific status still works", async () => { const r = (await L("certificates:list", { status: "draft" })).page; assert(r.length === 1 && r[0]._id === c1, "draft"); });
await step("quotes: default draft, 'all' = 2, names", async () => { const d = (await L("quotes:list", {})).page, a = (await L("quotes:list", { status: "all" })).page; assert(d.length === 1 && d[0]._id === q1 && a.length === 2 && named(a), `${d.length}/${a.length}`); });
await step("quotes: clientId + 'all'", async () => { const a = (await L("quotes:list", { clientId, status: "all" })).page; assert(a.length === 2 && named(a), String(a.length)); });
await step("invoices: default draft, 'all' = 2 (sent one effective status), names", async () => { const d = (await L("invoices:list", {})).page, a = (await L("invoices:list", { status: "all" })).page; assert(d.length === 1 && d[0]._id === i1 && a.length === 2 && named(a) && a.some((x) => x.status === "sent"), `${d.length}/${a.length}`); });
await step("invoices: status 'sent' + names", async () => { const a = (await L("invoices:list", { status: "sent" })).page; assert(a.length === 1 && named(a), String(a.length)); });
await step("defects: default open, 'all' = 2, by site 'all', names", async () => { const d = (await L("defects:list", {})).page, a = (await L("defects:list", { status: "all" })).page, s = (await L("defects:list", { status: "all", siteId })).page; assert(d.length === 1 && a.length === 2 && s.length === 2 && named(a) && named(s), `${d.length}/${a.length}/${s.length}`); });
await step("jobs: names (all + by status + by site)", async () => { const a = (await L("jobs:list", {})).page, b = (await L("jobs:list", { status: "draft" })).page, s = (await L("jobs:list", { siteId })).page; assert(named(a) && named(b) && named(s) && a[0]._id === jobId, "names"); });
await step("schedules: names", async () => { assert(named((await L("serviceSchedules:list", {})).page), "names"); });
await step("sites: clientName", async () => { const r = (await L("sites:list", {})).page; assert(r[0].clientName === "Acme Estates", JSON.stringify(r[0]).slice(0, 100)); });
await step("bad status still rejected", async () => { try { await L("quotes:list", { status: "bogus" }); throw new Error("NOT_REJECTED"); } catch (e) { assert(!/NOT_REJECTED/.test(e.message), "bogus status was accepted"); } });
if (pi?.token) await step("portal user: lists carry names; certificate rows have no qualificationChecks", async () => {
  const cs = (await C.query("certificates:list", { orgId, status: "all", paginationOpts: P })).page; const ds = (await C.query("defects:list", { orgId, status: "all", paginationOpts: P })).page;
  assert(cs.length === 1 && named(cs) && cs[0].qualificationChecks === undefined, JSON.stringify(cs.map((x) => [x.status, !!x.qualificationChecks]))); assert(ds.length === 1 && named(ds), String(ds.length));
});
console.log(results.map((r) => r.join("  ")).join("\n")); console.log(`\n${results.length - failures}/${results.length} passed`); process.exit(failures ? 1 : 0);
