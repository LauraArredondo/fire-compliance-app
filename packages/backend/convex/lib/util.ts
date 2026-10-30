import { ConvexError, v } from "convex/values";
import { TableNames, Doc, Id } from "../_generated/dataModel";
import { MutationCtx, QueryCtx } from "../_generated/server";
import { requireMember, canSeeClient } from "./auth";

type Ctx = QueryCtx | MutationCtx;
export type Role = Doc<"memberships">["role"];

/** Role groups. client_user is read-only everywhere (portal). */
export const STAFF: Role[] = ["owner", "admin", "office", "engineer"];
export const OFFICE: Role[] = ["owner", "admin", "office"];
export const MANAGERS: Role[] = ["owner", "admin"];
export const ANY: Role[] = ["owner", "admin", "office", "engineer", "client_user"];

export const DAY = 24 * 60 * 60 * 1000;

/** User-facing error (message is shown to the app, also in production). */
export function fail(message: string): never {
  throw new ConvexError(message);
}

export async function audit(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  actorUserId: Id<"users"> | undefined,
  action: string,
  entityType: string,
  entityId: string,
  changes?: unknown,
) {
  await ctx.db.insert("auditLog", { orgId, actorUserId, action, entityType, entityId, changes, at: Date.now() });
}

/** Next reference from the org's number sequence, e.g. nextNumber(ctx, org, "job", "JOB-") -> "JOB-000001". */
export async function nextNumber(ctx: MutationCtx, orgId: Id<"organizations">, key: string, prefix: string, width = 6): Promise<string> {
  const seq = await ctx.db.query("numberSequences").withIndex("by_org_and_key", (q) => q.eq("orgId", orgId).eq("key", key)).unique();
  const n = seq?.next ?? 1;
  if (seq) await ctx.db.patch(seq._id, { next: n + 1 });
  else await ctx.db.insert("numberSequences", { orgId, key, next: n + 1 });
  return `${prefix}${String(n).padStart(width, "0")}`;
}

/* ---------------- loading with permission checks ---------------- */

export async function loadDoc<T extends TableNames>(ctx: Ctx, id: Id<T>, label: string): Promise<Doc<T>> {
  const d = (await ctx.db.get(id)) as Doc<T> | null;
  if (!d) fail(`${label} not found`);
  return d;
}

/** Load a record, require org membership (optionally specific roles) and client scoping. */
export async function loadForMember<T extends TableNames>(ctx: Ctx, id: Id<T>, label: string, roles?: Role[]) {
  const doc = await loadDoc(ctx, id, label);
  const orgId = (doc as unknown as { orgId?: Id<"organizations"> }).orgId;
  if (!orgId) fail(`${label} not found`);
  const { user, membership } = await requireMember(ctx, orgId, roles);
  const clientId = (doc as unknown as { clientId?: Id<"clients"> }).clientId;
  if (clientId && !canSeeClient(membership, clientId)) fail(`${label} not found`);
  return { doc, user, membership, orgId };
}

/** Ensure a referenced record belongs to the org (and return it). */
export async function inOrg<T extends TableNames>(ctx: Ctx, id: Id<T>, orgId: Id<"organizations">, label: string): Promise<Doc<T>> {
  const d = await loadDoc(ctx, id, label);
  const o = (d as unknown as { orgId?: Id<"organizations"> }).orgId;
  if (o !== orgId) fail(`${label} not found`);
  return d;
}

/* ---------------- validation ---------------- */

export function str(value: string, field: string, max = 200): string {
  const t = value.trim();
  if (!t) fail(`${field} is required`);
  if (t.length > max) fail(`${field} must be ${max} characters or fewer`);
  return t;
}
export function optStr(value: string | undefined, field: string, max = 5000): string | undefined {
  if (value === undefined) return undefined;
  const t = value.trim();
  if (t.length > max) fail(`${field} must be ${max} characters or fewer`);
  return t || undefined;
}
export function email(value: string, field = "Email"): string {
  const e = value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) || e.length > 254) fail(`${field} is not a valid email address`);
  return e;
}
export function emails(list: string[] | undefined, field: string): string[] | undefined {
  if (list === undefined) return undefined;
  if (list.length > 20) fail(`${field}: at most 20 addresses`);
  return [...new Set(list.map((e) => email(e, field)))];
}
export function num(value: number, field: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isFinite(value) || value < min || value > max) fail(`${field} must be between ${min} and ${max}`);
  return value;
}
export function int(value: number, field: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value)) fail(`${field} must be a whole number`);
  return num(value, field, min, max);
}
export function ukPostcode(value: string | undefined): string | undefined {
  if (!value) return value;
  const p = value.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/.test(p)) return value.trim().toUpperCase(); // keep non-UK as typed
  return p.replace(/^(.+)(\d[A-Z]{2})$/, "$1 $2");
}

/** Strip keys whose value is undefined (so patches don't clear fields unintentionally). */
export function defined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, x]) => x !== undefined)) as Partial<T>;
}

/* ---------------- shared validators ---------------- */

export const addressV = v.object({
  line1: v.string(),
  line2: v.optional(v.string()),
  city: v.optional(v.string()),
  region: v.optional(v.string()),
  postcode: v.optional(v.string()),
  country: v.optional(v.string()),
});
export const contactV = v.object({ name: v.string(), email: v.optional(v.string()), phone: v.optional(v.string()), role: v.optional(v.string()) });
export const geoV = v.object({ lat: v.number(), lng: v.number() });
export const frequencyV = v.object({ interval: v.number(), unit: v.union(v.literal("day"), v.literal("week"), v.literal("month"), v.literal("year")) });
/** Signature as sent by the app: image uploaded via an upload URL first. */
export const signatureInputV = v.object({
  signedByName: v.string(),
  signedByRole: v.optional(v.string()),
  signatureImageId: v.optional(v.id("_storage")),
  deviceInfo: v.optional(v.string()),
});

export function cleanAddress(a: { line1: string; line2?: string; city?: string; region?: string; postcode?: string; country?: string }) {
  return defined({
    line1: str(a.line1, "Address line 1"),
    line2: optStr(a.line2, "Address line 2", 200),
    city: optStr(a.city, "Town/City", 100),
    region: optStr(a.region, "County", 100),
    postcode: ukPostcode(optStr(a.postcode, "Postcode", 12)),
    country: optStr(a.country, "Country", 60) ?? "GB",
  }) as { line1: string; line2?: string; city?: string; region?: string; postcode?: string; country?: string };
}
export function cleanContact(c: { name: string; email?: string; phone?: string; role?: string }) {
  return defined({
    name: str(c.name, "Contact name"),
    email: c.email?.trim() ? email(c.email, "Contact email") : undefined,
    phone: optStr(c.phone, "Phone", 30),
    role: optStr(c.role, "Contact role", 80),
  }) as { name: string; email?: string; phone?: string; role?: string };
}
export function cleanFrequency(f: { interval: number; unit: "day" | "week" | "month" | "year" }) {
  int(f.interval, "Frequency interval", 1, f.unit === "day" ? 3650 : f.unit === "week" ? 520 : f.unit === "month" ? 120 : 10);
  return f;
}

/** Validate an uploaded file id: it must exist and match the allowed types/size. */
export async function requireFile(ctx: Ctx, storageId: Id<"_storage">, opts: { types?: RegExp; maxBytes?: number; label?: string } = {}) {
  const meta = await ctx.db.system.get(storageId);
  const label = opts.label ?? "File";
  if (!meta) fail(`${label} upload not found`);
  if (opts.maxBytes && meta.size > opts.maxBytes) fail(`${label} is too large (max ${Math.round(opts.maxBytes / 1024 / 1024)} MB)`);
  if (opts.types && !opts.types.test(meta.contentType ?? "")) fail(`${label} has an unsupported file type`);
  return meta;
}
export const IMAGE = /^image\/(png|jpeg|webp|gif|svg\+xml)$/;

export async function makeSignature(
  ctx: Ctx,
  s: { signedByName: string; signedByRole?: string; signatureImageId?: Id<"_storage">; deviceInfo?: string },
  userId?: Id<"users">,
) {
  if (s.signatureImageId) await requireFile(ctx, s.signatureImageId, { types: IMAGE, maxBytes: 2 * 1024 * 1024, label: "Signature" });
  return defined({
    signedByName: str(s.signedByName, "Signed by name", 120),
    signedByRole: optStr(s.signedByRole, "Signed by role", 80),
    signatureImageId: s.signatureImageId,
    deviceInfo: optStr(s.deviceInfo, "Device info", 300),
    signedByUserId: userId,
    signedAt: Date.now(),
  }) as { signedByName: string; signedAt: number; signedByRole?: string; signatureImageId?: Id<"_storage">; deviceInfo?: string; signedByUserId?: Id<"users"> };
}

/* ---------------- dates ---------------- */

export function addMonths(ms: number, months: number): number {
  const d = new Date(ms);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.getTime();
}
export function addFrequency(ms: number, f: { interval: number; unit: "day" | "week" | "month" | "year" }): number {
  switch (f.unit) {
    case "day":
      return ms + f.interval * DAY;
    case "week":
      return ms + f.interval * 7 * DAY;
    case "month":
      return addMonths(ms, f.interval);
    case "year":
      return addMonths(ms, f.interval * 12);
  }
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------------- money (pence) ---------------- */

export type LineIn = { quantity: number; unitPrice: number; discountPercent?: number; taxRate: number };
export function lineNet(l: LineIn): number {
  return Math.round(l.quantity * l.unitPrice * (1 - (l.discountPercent ?? 0) / 100));
}
export function lineTax(l: LineIn): number {
  return Math.round((lineNet(l) * l.taxRate) / 100);
}
export function validateLine(l: LineIn) {
  num(l.quantity, "Quantity", 0, 1_000_000);
  int(l.unitPrice, "Unit price (pence)", -100_000_000, 100_000_000);
  num(l.discountPercent ?? 0, "Discount %", 0, 100);
  num(l.taxRate, "VAT rate %", 0, 100);
}
