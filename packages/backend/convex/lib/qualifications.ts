import { QueryCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { disciplineLabel, formatDate } from "./labels";

type Discipline = Doc<"engineerQualifications">["discipline"];

export type QualificationResult = {
  userId: Id<"users">;
  name: string;
  discipline: Discipline;
  qualified: boolean;
  /** Valid qualifications that cover the discipline at `at`. */
  qualificationIds: Id<"engineerQualifications">[];
  /** Human-readable explanation, e.g. "Fire Detection & Alarm: BAFE SP203-1 module 4, valid to 12 Mar 2027". */
  detail: string;
};

/**
 * Does `userId` hold a qualification for `discipline` that is valid at `at`?
 * Valid = same org + discipline, issued on/before `at` (if an issue date is set) and not expired at `at`.
 * (engineerQualifications has no "verified" field and certificate types don't name a required qualification yet.)
 */
export async function checkQualification(ctx: QueryCtx, orgId: Id<"organizations">, userId: Id<"users">, discipline: Discipline, at: number, tz = "Europe/London"): Promise<QualificationResult> {
  const user = await ctx.db.get(userId);
  const name = user?.name ?? user?.email ?? "This engineer";
  const all = (await ctx.db.query("engineerQualifications").withIndex("by_org_and_user", (q) => q.eq("orgId", orgId).eq("userId", userId)).take(200)).filter((q) => q.discipline === discipline);
  const valid = all.filter((q) => (q.issuedAt === undefined || q.issuedAt <= at) && (q.expiresAt === undefined || q.expiresAt > at));
  const label = disciplineLabel(discipline);
  if (valid.length) {
    const best = valid.sort((a, b) => (b.expiresAt ?? Infinity) - (a.expiresAt ?? Infinity))[0];
    return { userId, name, discipline, qualified: true, qualificationIds: valid.map((q) => q._id), detail: `${label}: ${best.title}${best.expiresAt ? `, valid to ${formatDate(best.expiresAt, tz)}` : ""}` };
  }
  let detail: string;
  if (!all.length) detail = `${name} has no ${label} qualification on record`;
  else {
    const expired = all.filter((q) => q.expiresAt !== undefined && q.expiresAt <= at).sort((a, b) => b.expiresAt! - a.expiresAt!)[0];
    const future = all.find((q) => q.issuedAt !== undefined && q.issuedAt > at);
    detail = expired
      ? `${name}'s ${label} qualification "${expired.title}" expired on ${formatDate(expired.expiresAt, tz)}`
      : `${name}'s ${label} qualification "${future!.title}" is not valid until ${formatDate(future!.issuedAt, tz)}`;
  }
  return { userId, name, discipline, qualified: false, qualificationIds: [], detail };
}

export type AssignmentWarning = { engineerId: Id<"users">; engineerName: string; discipline: Discipline; message: string };

/** Warnings (not errors) for engineers who aren't qualified for a job's disciplines on `at`. */
export async function assignmentWarnings(ctx: QueryCtx, orgId: Id<"organizations">, engineerIds: Id<"users">[], disciplines: Discipline[], at: number, tz = "Europe/London"): Promise<AssignmentWarning[]> {
  const out: AssignmentWarning[] = [];
  for (const id of engineerIds) {
    for (const d of new Set(disciplines)) {
      const r = await checkQualification(ctx, orgId, id, d, at, tz);
      if (!r.qualified) out.push({ engineerId: id, engineerName: r.name, discipline: d, message: `${r.detail}${at > Date.now() + 86_400_000 ? ` (on ${formatDate(at, tz)})` : ""}. They can be assigned, but won't be able to sign the ${disciplineLabel(d)} certificate without an owner/admin override.` });
    }
  }
  return out;
}
