import { QueryCtx } from "../_generated/server";
import { Doc } from "../_generated/dataModel";
import { normalizeToken } from "./tokens";

/** Base URL encoded in QR codes. VERIFY_BASE_URL wins; else the Convex HTTP route. */
export function verifyBaseUrl(): string {
  const explicit = process.env.VERIFY_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  return `${(process.env.CONVEX_SITE_URL ?? "").replace(/\/+$/, "")}/verify`;
}
export const certificateVerifyUrl = (token: string) => `${verifyBaseUrl()}/${token}`;
export const assetVerifyUrl = (tag: string) => `${verifyBaseUrl()}/a/${tag}`;
export const siteVerifyUrl = (token: string) => `${verifyBaseUrl()}/s/${token}`;

export type PublicCertStatus = "issued" | "expired" | "superseded" | "revoked";

export type CertificateVerification =
  | { found: false }
  | {
      found: true;
      certificateId: Doc<"certificates">["_id"];
      valid: boolean;
      status: PublicCertStatus;
      certificateNumber: string;
      certificateType: string | null;
      standard: string | null;
      discipline: string;
      overallResult: Doc<"certificates">["overallResult"];
      issuedBy: string | null;
      orgLogoUrl: string | null;
      accreditations: string[];
      siteName: string | null;
      siteTown: string | null;
      inspectionDate: number;
      issuedAt: number | null;
      expiresAt: number | null;
      nextInspectionDueAt: number | null;
      engineerName: string | null;
      signedAt: number | null;
      pdfHash: string | null;
      supersededByNumber: string | null;
      revokedReason: string | null;
    };

function publicStatus(cert: Doc<"certificates">, now: number): PublicCertStatus | null {
  if (cert.status === "draft" || cert.status === "pending_signature") return null;
  if (cert.status === "issued") return cert.expiresAt !== undefined && cert.expiresAt < now ? "expired" : "issued";
  return cert.status;
}

export async function buildCertificateVerification(ctx: QueryCtx, rawToken: string): Promise<CertificateVerification> {
  const token = normalizeToken(rawToken);
  if (!token) return { found: false };
  const cert = await ctx.db
    .query("certificates")
    .withIndex("by_verification_token", (q) => q.eq("verificationToken", token))
    .unique();
  if (!cert) return { found: false };
  const status = publicStatus(cert, Date.now());
  if (!status) return { found: false };
  const [org, site, type, next] = await Promise.all([
    ctx.db.get(cert.orgId),
    ctx.db.get(cert.siteId),
    ctx.db.get(cert.certificateTypeId),
    cert.supersededById ? ctx.db.get(cert.supersededById) : null,
  ]);
  return {
    found: true,
    certificateId: cert._id,
    valid: status === "issued",
    status,
    certificateNumber: cert.certificateNumber,
    certificateType: type?.name ?? null,
    standard: type?.standard ?? null,
    discipline: cert.discipline,
    overallResult: cert.overallResult,
    issuedBy: org?.name ?? null,
    orgLogoUrl: org?.logoId ? await ctx.storage.getUrl(org.logoId) : null,
    accreditations: org?.accreditations?.map((a) => [a.body, a.scheme, a.number].filter(Boolean).join(" ")) ?? [],
    siteName: site?.name ?? null,
    siteTown: site?.address.city ?? null,
    inspectionDate: cert.inspectionDate,
    issuedAt: cert.issuedAt ?? null,
    expiresAt: cert.expiresAt ?? null,
    nextInspectionDueAt: cert.nextInspectionDueAt ?? null,
    engineerName: cert.engineerSignature?.signedByName ?? null,
    signedAt: cert.engineerSignature?.signedAt ?? null,
    pdfHash: cert.pdfHash ?? null,
    supersededByNumber: next?.certificateNumber ?? null,
    revokedReason: cert.status === "revoked" ? (cert.revokedReason ?? null) : null,
  };
}

/** Latest issued certificate per discipline for a site (public summary). */
async function latestCertsForSite(ctx: QueryCtx, siteId: Doc<"sites">["_id"], discipline?: string) {
  const certs = await ctx.db
    .query("certificates")
    .withIndex("by_site", (q) => q.eq("siteId", siteId))
    .order("desc")
    .take(300);
  const now = Date.now();
  const byDiscipline = new Map<string, { certificateNumber: string; status: PublicCertStatus; expiresAt: number | null; discipline: string; nextDueAt: number | null }>();
  for (const c of certs) {
    if (discipline && c.discipline !== discipline) continue;
    if (c.status !== "issued") continue;
    if (byDiscipline.has(c.discipline)) continue;
    byDiscipline.set(c.discipline, {
      certificateNumber: c.certificateNumber,
      status: publicStatus(c, now) ?? "issued",
      expiresAt: c.expiresAt ?? null,
      discipline: c.discipline,
      nextDueAt: c.nextInspectionDueAt ?? null,
    });
  }
  return [...byDiscipline.values()];
}

export async function buildAssetStatus(ctx: QueryCtx, rawTag: string) {
  const tag = normalizeToken(rawTag);
  const asset = await ctx.db.query("assets").withIndex("by_tag_code", (q) => q.eq("tagCode", tag)).unique();
  if (!asset || asset.status === "removed") return null;
  const [org, site, type, location] = await Promise.all([
    ctx.db.get(asset.orgId),
    ctx.db.get(asset.siteId),
    ctx.db.get(asset.assetTypeId),
    asset.locationId ? ctx.db.get(asset.locationId) : null,
  ]);
  return {
    assetId: asset._id,
    issuedBy: org?.name ?? null,
    orgLogoUrl: org?.logoId ? await ctx.storage.getUrl(org.logoId) : null,
    reference: asset.reference,
    assetType: type?.name ?? null,
    discipline: asset.discipline,
    location: location?.name ?? null,
    status: asset.status,
    lastInspectedAt: asset.lastInspectedAt ?? null,
    lastResult: asset.lastResult ?? null,
    nextDueAt: asset.nextDueAt ?? null,
    siteName: site?.name ?? null,
    siteTown: site?.address.city ?? null,
    certificates: site ? await latestCertsForSite(ctx, site._id, asset.discipline) : [],
  };
}

export async function buildSiteStatus(ctx: QueryCtx, rawToken: string) {
  const token = normalizeToken(rawToken);
  const site = await ctx.db.query("sites").withIndex("by_qr_token", (q) => q.eq("qrToken", token)).unique();
  if (!site || site.status !== "active") return null;
  const org = await ctx.db.get(site.orgId);
  return {
    siteId: site._id,
    issuedBy: org?.name ?? null,
    orgLogoUrl: org?.logoId ? await ctx.storage.getUrl(org.logoId) : null,
    siteName: site.name,
    siteTown: site.address.city ?? null,
    certificates: await latestCertsForSite(ctx, site._id),
  };
}
