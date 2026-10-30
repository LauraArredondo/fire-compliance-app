import { v, ConvexError } from "convex/values";
import { query, mutation, internalQuery, internalMutation, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { requireMember, canSeeClient } from "./lib/auth";
import { newPublicToken } from "./lib/tokens";
import { advanceSchedulesForCertificate } from "./lib/schedules";
import { checkQualification } from "./lib/qualifications";
import { paginationOptsValidator } from "convex/server";
import { canSeeSite } from "./lib/auth";
import * as U from "./lib/util";
import { buildCertificateVerification, buildAssetStatus, buildSiteStatus, certificateVerifyUrl } from "./lib/verification";

const STAFF = ["owner", "admin", "office", "engineer"] as const;
const MANAGERS = ["owner", "admin"] as const;

/* ------------------------------------------------------------------ */
/* Public read                                                         */
/* ------------------------------------------------------------------ */

/** PUBLIC: QR-code verification by token. Returns only non-sensitive fields. */
export const verify = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const r = await buildCertificateVerification(ctx, token);
    if (!r.found) return { valid: false as const, found: false as const };
    const { certificateId: _omit, ...rest } = r;
    return rest;
  },
});

/** Certificates for a site (staff, or the site's client portal users). Newest first. */
export const listBySite = query({
  args: { orgId: v.id("organizations"), siteId: v.id("sites") },
  handler: async (ctx, { orgId, siteId }) => {
    const { membership } = await requireMember(ctx, orgId);
    const site = await ctx.db.get(siteId);
    if (!site || site.orgId !== orgId || !canSeeClient(membership, site.clientId)) {
      throw new ConvexError("Site not found");
    }
    const certs = await ctx.db
      .query("certificates")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .order("desc")
      .take(200);
    const visible =
      membership.role === "client_user" ? certs.filter((c) => c.status !== "draft" && c.status !== "pending_signature") : certs;
    return await Promise.all(
      visible.map(async (c) => ({
        ...c,
        pdfUrl: c.pdfStorageId ? await ctx.storage.getUrl(c.pdfStorageId) : null,
        verifyUrl: certificateVerifyUrl(c.verificationToken),
      })),
    );
  },
});

/** Download URL + status of a certificate's PDF (staff or the client's portal users). */
export const getPdf = query({
  args: { certificateId: v.id("certificates") },
  handler: async (ctx, { certificateId }) => {
    const cert = await ctx.db.get(certificateId);
    if (!cert) throw new ConvexError("Certificate not found");
    const { membership } = await requireMember(ctx, cert.orgId);
    if (!canSeeClient(membership, cert.clientId)) throw new ConvexError("Certificate not found");
    if (membership.role === "client_user" && (cert.status === "draft" || cert.status === "pending_signature")) {
      throw new ConvexError("Certificate not found");
    }
    return {
      status: cert.status,
      pdfStatus: cert.pdfStatus ?? null,
      pdfError: cert.pdfError ?? null,
      pdfHash: cert.pdfHash ?? null,
      pdfGeneratedAt: cert.pdfGeneratedAt ?? null,
      url: cert.pdfStorageId ? await ctx.storage.getUrl(cert.pdfStorageId) : null,
      verifyUrl: certificateVerifyUrl(cert.verificationToken),
    };
  },
});

/* ------------------------------------------------------------------ */
/* Issue / reissue / revoke                                            */
/* ------------------------------------------------------------------ */

function addMonths(ms: number, months: number): number {
  const d = new Date(ms);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.getTime();
}

type QualCheck = NonNullable<Doc<"certificates">["qualificationChecks"]>[number];

/**
 * Engineer qualification gate for signing / issuing. Returns the check to record, or throws a clear error.
 * An unqualified engineer is only allowed through with `overrideReason` from an owner/admin
 * (or an earlier override for the same signature, passed as `inherited`).
 */
async function qualificationGate(
  ctx: MutationCtx,
  cert: Doc<"certificates">,
  engineerUserId: Id<"users">,
  actor: { user: Doc<"users">; role: string },
  stage: "sign" | "issue",
  overrideReason: string | undefined,
  signatureSignedAt: number | undefined,
  inherited?: QualCheck["override"],
): Promise<QualCheck> {
  const now = Date.now();
  const org = await ctx.db.get(cert.orgId);
  const r = await checkQualification(ctx, cert.orgId, engineerUserId, cert.discipline, now, org?.timezone);
  const check: QualCheck = { stage, engineerUserId, engineerName: r.name, discipline: cert.discipline, qualified: r.qualified, qualificationIds: r.qualificationIds, detail: r.detail, signatureSignedAt, at: now };
  if (r.qualified) return check;
  const reason = overrideReason?.trim();
  if (reason) {
    if (actor.role !== "owner" && actor.role !== "admin") throw new ConvexError(`${r.detail}. Only an owner or admin can override the qualification check.`);
    if (reason.length < 5) throw new ConvexError("Please give a reason for the qualification override (at least 5 characters)");
    return { ...check, override: { byUserId: actor.user._id, byName: actor.user.name ?? actor.user.email ?? "Owner/admin", reason: reason.slice(0, 500), at: now } };
  }
  if (inherited) return { ...check, override: inherited };
  const verb = stage === "sign" ? "sign" : "issue";
  throw new ConvexError(
    `Can't ${verb} this certificate: ${r.detail}. Add or renew the qualification on the engineer's profile, or ask an owner/admin to ${verb} with a qualification override reason.`,
  );
}

async function audit(ctx: MutationCtx, orgId: Id<"organizations">, actor: Id<"users">, action: string, id: string, changes?: unknown) {
  await ctx.db.insert("auditLog", { orgId, actorUserId: actor, action, entityType: "certificate", entityId: id, changes, at: Date.now() });
}

/**
 * Finalise a draft certificate: checks signatures, sets status `issued`, dates and
 * verification token, supersedes the previous revision, and queues PDF generation.
 */
export const issue = mutation({
  args: {
    certificateId: v.id("certificates"),
    /** Owner/admin only: issue even though the signing engineer isn't qualified for the discipline. Recorded on the certificate. */
    qualificationOverrideReason: v.optional(v.string()),
  },
  handler: async (ctx, { certificateId, qualificationOverrideReason }) => {
    const cert = await ctx.db.get(certificateId);
    if (!cert) throw new ConvexError("Certificate not found");
    const { user, membership } = await requireMember(ctx, cert.orgId, [...STAFF]);
    if (cert.status !== "draft" && cert.status !== "pending_signature") {
      throw new ConvexError(`Certificate is already ${cert.status}`);
    }
    const type = await ctx.db.get(cert.certificateTypeId);
    if (!type) throw new ConvexError("Certificate type missing");
    if (!cert.engineerSignature) throw new ConvexError("Engineer signature is required before issuing");
    if (type.requiresClientSignature && !cert.clientSignature) {
      throw new ConvexError("Customer / responsible person signature is required for this certificate type");
    }

    // Qualification gate: the signing engineer (and an engineer issuing someone else's certificate).
    const actor = { user, role: membership.role };
    const checks: QualCheck[] = [];
    const signer = cert.engineerSignature.signedByUserId;
    if (signer) {
      const sigAt = cert.engineerSignature.signedAt;
      const prior = (cert.qualificationChecks ?? []).filter((c) => c.stage === "sign" && c.engineerUserId === signer && c.signatureSignedAt === sigAt && c.override).pop();
      checks.push(await qualificationGate(ctx, cert, signer, actor, "issue", qualificationOverrideReason, sigAt, prior?.override));
    }
    if (membership.role === "engineer" && signer !== user._id) {
      checks.push(await qualificationGate(ctx, cert, user._id, actor, "issue", qualificationOverrideReason, undefined));
    }
    for (const c of checks) {
      if (c.override && qualificationOverrideReason?.trim()) {
        await audit(ctx, cert.orgId, user._id, "certificate.qualification_override", certificateId, { stage: "issue", engineerUserId: c.engineerUserId, discipline: c.discipline, detail: c.detail, reason: c.override.reason });
      }
    }

    const now = Date.now();
    const issuedAt = now;
    const expiresAt = cert.expiresAt ?? (type.validityMonths ? addMonths(cert.inspectionDate, type.validityMonths) : undefined);
    await ctx.db.patch(certificateId, {
      status: "issued",
      issuedAt,
      issuedBy: user._id,
      expiresAt,
      nextInspectionDueAt: cert.nextInspectionDueAt ?? expiresAt,
      verificationToken: cert.verificationToken || newPublicToken(),
      pdfStatus: "pending",
      pdfError: undefined,
      qualificationChecks: [...(cert.qualificationChecks ?? []), ...checks],
      updatedAt: now,
    });

    if (cert.supersedesId) {
      const prev = await ctx.db.get(cert.supersedesId);
      if (prev && prev.status === "issued") {
        await ctx.db.patch(prev._id, { status: "superseded", supersededById: certificateId, updatedAt: now });
        await audit(ctx, cert.orgId, user._id, "certificate.superseded", prev._id, { by: certificateId });
      }
    }
    await audit(ctx, cert.orgId, user._id, "certificate.issued", certificateId);
    const issuedCert = (await ctx.db.get(certificateId))!;
    await advanceSchedulesForCertificate(ctx, issuedCert, user._id);
    await ctx.scheduler.runAfter(0, internal.certificatePdf.generate, { certificateId });
    return { certificateId, verifyUrl: certificateVerifyUrl(cert.verificationToken) };
  },
});

/**
 * Start a reissue: copies an issued certificate into a new draft revision
 * (new number suffix /R1, /R2…, new QR token, signatures cleared). When the new
 * draft is issued, the original becomes `superseded`.
 */
export const reissue = mutation({
  args: { certificateId: v.id("certificates"), reason: v.optional(v.string()) },
  handler: async (ctx, { certificateId, reason }) => {
    const cert = await ctx.db.get(certificateId);
    if (!cert) throw new ConvexError("Certificate not found");
    const { user } = await requireMember(ctx, cert.orgId, [...STAFF]);
    if (cert.status !== "issued") throw new ConvexError("Only issued certificates can be reissued");
    const revision = (cert.revision ?? 0) + 1;
    const baseNumber = cert.certificateNumber.replace(/\/R\d+$/, "");
    const now = Date.now();
    const {
      _id, _creationTime, status, issuedAt, issuedBy, pdfStorageId, pdfHash, pdfStatus, pdfGeneratedAt, pdfError,
      engineerSignature, clientSignature, verificationToken, supersededById, revokedReason, revokedAt,
      clientGeneratedId, capturedAt, syncedAt, deviceId, qualificationChecks, ...content
    } = cert;
    const newId = await ctx.db.insert("certificates", {
      ...content,
      certificateNumber: `${baseNumber}/R${revision}`,
      revision,
      status: "draft",
      verificationToken: newPublicToken(),
      supersedesId: certificateId,
      createdAt: now,
      updatedAt: now,
    });
    await audit(ctx, cert.orgId, user._id, "certificate.reissue_started", newId, { from: certificateId, reason });
    return { certificateId: newId };
  },
});

/** Withdraw an issued certificate (owner/admin). The QR page will show REVOKED. */
export const revoke = mutation({
  args: { certificateId: v.id("certificates"), reason: v.string() },
  handler: async (ctx, { certificateId, reason }) => {
    const cert = await ctx.db.get(certificateId);
    if (!cert) throw new ConvexError("Certificate not found");
    const { user } = await requireMember(ctx, cert.orgId, [...MANAGERS]);
    if (cert.status !== "issued") throw new ConvexError("Only issued certificates can be revoked");
    await ctx.db.patch(certificateId, { status: "revoked", revokedReason: reason, revokedAt: Date.now(), updatedAt: Date.now() });
    await audit(ctx, cert.orgId, user._id, "certificate.revoked", certificateId, { reason });
  },
});

/** Re-render the PDF of an issued certificate, e.g. after a logo change (owner/admin). */
export const regeneratePdf = mutation({
  args: { certificateId: v.id("certificates") },
  handler: async (ctx, { certificateId }) => {
    const cert = await ctx.db.get(certificateId);
    if (!cert) throw new ConvexError("Certificate not found");
    const { user } = await requireMember(ctx, cert.orgId, [...MANAGERS]);
    if (cert.status !== "issued") throw new ConvexError("Only issued certificates have a PDF");
    await ctx.db.patch(certificateId, { pdfStatus: "pending", pdfError: undefined });
    await audit(ctx, cert.orgId, user._id, "certificate.pdf_regenerated", certificateId);
    await ctx.scheduler.runAfter(0, internal.certificatePdf.generate, { certificateId });
  },
});

/* ------------------------------------------------------------------ */
/* Internal: PDF rendering support                                     */
/* ------------------------------------------------------------------ */

/** Everything the PDF renderer needs, resolved in one query. */
export const getRenderData = internalQuery({
  args: { certificateId: v.id("certificates") },
  handler: async (ctx, { certificateId }) => {
    const cert = await ctx.db.get(certificateId);
    if (!cert) return null;
    const [org, client, site, type, job] = await Promise.all([
      ctx.db.get(cert.orgId),
      ctx.db.get(cert.clientId),
      ctx.db.get(cert.siteId),
      ctx.db.get(cert.certificateTypeId),
      cert.jobId ? ctx.db.get(cert.jobId) : null,
    ]);
    if (!org || !client || !site || !type) return null;

    const inspections = (await Promise.all(cert.inspectionIds.map((id) => ctx.db.get(id)))).filter(
      (x): x is Doc<"inspections"> => x !== null,
    );
    const resultByAsset = new Map<string, string>();
    for (const i of inspections) if (i.assetId) resultByAsset.set(i.assetId, i.overallResult);

    const typeNames = new Map<string, string>();
    const locationNames = new Map<string, string>();
    const assets = [];
    for (const id of cert.assetIds) {
      const a = await ctx.db.get(id);
      if (!a) continue;
      if (!typeNames.has(a.assetTypeId)) typeNames.set(a.assetTypeId, (await ctx.db.get(a.assetTypeId))?.name ?? "");
      if (a.locationId && !locationNames.has(a.locationId)) locationNames.set(a.locationId, (await ctx.db.get(a.locationId))?.name ?? "");
      assets.push({
        reference: a.reference,
        type: typeNames.get(a.assetTypeId) ?? "",
        description: a.description ?? "",
        location: a.locationId ? (locationNames.get(a.locationId) ?? "") : "",
        result: resultByAsset.get(a._id) ?? a.lastResult ?? "not_tested",
      });
    }

    const defects = (await Promise.all(cert.defectIds.map((id) => ctx.db.get(id))))
      .filter((d): d is Doc<"defects"> => d !== null)
      .map((d) => ({
        reference: d.reference,
        title: d.title,
        description: d.description ?? "",
        recommendedAction: d.recommendedAction ?? "",
        severity: d.severity,
        status: d.status,
      }));

    const engineerUserId = cert.engineerSignature?.signedByUserId ?? cert.issuedBy;
    let qualification: string | null = null;
    if (engineerUserId) {
      const quals = await ctx.db
        .query("engineerQualifications")
        .withIndex("by_org_and_user", (q) => q.eq("orgId", cert.orgId).eq("userId", engineerUserId))
        .take(20);
      const q = quals.find((x) => x.discipline === cert.discipline) ?? quals[0];
      if (q) qualification = [q.title, q.reference].filter(Boolean).join(" · ");
    }
    const previous = cert.supersedesId ? await ctx.db.get(cert.supersedesId) : null;

    return {
      cert: {
        certificateNumber: cert.certificateNumber,
        verificationToken: cert.verificationToken,
        discipline: cert.discipline,
        overallResult: cert.overallResult,
        summary: cert.summary ?? "",
        variations: typeof cert.data?.variations === "string" ? (cert.data.variations as string) : "",
        status: cert.status,
        inspectionDate: cert.inspectionDate,
        issuedAt: cert.issuedAt ?? null,
        expiresAt: cert.expiresAt ?? null,
        nextInspectionDueAt: cert.nextInspectionDueAt ?? null,
        engineerSignature: cert.engineerSignature ?? null,
        clientSignature: cert.clientSignature ?? null,
        supersedesNumber: previous?.certificateNumber ?? null,
      },
      type: { name: type.name, standard: type.standard ?? null, code: type.code },
      org: {
        name: org.name,
        legalName: org.legalName ?? null,
        registrationNumber: org.registrationNumber ?? null,
        vatNumber: org.vatNumber ?? null,
        address: org.address ?? null,
        email: org.email ?? null,
        phone: org.phone ?? null,
        logoId: org.logoId ?? null,
        timezone: org.timezone,
        accreditations: org.accreditations ?? [],
      },
      client: { name: client.name, address: client.billingAddress ?? null },
      site: { name: site.name, reference: site.reference ?? null, address: site.address, responsiblePerson: site.responsiblePerson ?? null },
      job: job ? { jobNumber: job.jobNumber, purchaseOrderNumber: job.purchaseOrderNumber ?? null } : null,
      assets,
      defects,
      qualification,
      verifyUrl: certificateVerifyUrl(cert.verificationToken),
    };
  },
});

export const savePdf = internalMutation({
  args: { certificateId: v.id("certificates"), storageId: v.id("_storage"), sha256: v.string() },
  handler: async (ctx, { certificateId, storageId, sha256 }) => {
    const cert = await ctx.db.get(certificateId);
    if (!cert) {
      await ctx.storage.delete(storageId);
      return;
    }
    if (cert.pdfStorageId && cert.pdfStorageId !== storageId) await ctx.storage.delete(cert.pdfStorageId);
    await ctx.db.patch(certificateId, {
      pdfStorageId: storageId,
      pdfHash: sha256,
      pdfStatus: "ready",
      pdfGeneratedAt: Date.now(),
      pdfError: undefined,
    });
  },
});

export const markPdfFailed = internalMutation({
  args: { certificateId: v.id("certificates"), error: v.string() },
  handler: async (ctx, { certificateId, error }) => {
    if (await ctx.db.get(certificateId)) await ctx.db.patch(certificateId, { pdfStatus: "failed", pdfError: error.slice(0, 500) });
  },
});

/* ------------------------------------------------------------------ */
/* Internal: QR scan pages (used by the public HTTP route)             */
/* ------------------------------------------------------------------ */

async function logScan(
  ctx: MutationCtx,
  kind: "certificate" | "asset" | "site",
  token: string,
  found: boolean,
  meta: { userAgent?: string; ipHash?: string },
  certificateId?: Id<"certificates">,
) {
  await ctx.db.insert("verificationScans", { kind, token, found, certificateId, scannedAt: Date.now(), ...meta });
}

const scanMeta = { token: v.string(), userAgent: v.optional(v.string()), ipHash: v.optional(v.string()) };

export const scanCertificate = internalMutation({
  args: scanMeta,
  handler: async (ctx, { token, ...meta }) => {
    const r = await buildCertificateVerification(ctx, token);
    await logScan(ctx, "certificate", token.slice(0, 64), r.found, meta, r.found ? r.certificateId : undefined);
    return r;
  },
});

export const scanAsset = internalMutation({
  args: scanMeta,
  handler: async (ctx, { token, ...meta }) => {
    const r = await buildAssetStatus(ctx, token);
    await logScan(ctx, "asset", token.slice(0, 64), r !== null, meta);
    return r;
  },
});

export const scanSite = internalMutation({
  args: scanMeta,
  handler: async (ctx, { token, ...meta }) => {
    const r = await buildSiteStatus(ctx, token);
    await logScan(ctx, "site", token.slice(0, 64), r !== null, meta);
    return r;
  },
});

/* ------------------------------------------------------------------ */
/* Internal: QR labels                                                 */
/* ------------------------------------------------------------------ */

/** Check staff access, make sure the asset/site has a QR token, return label content. */
export const prepareLabel = internalMutation({
  args: { userId: v.id("users"), assetId: v.optional(v.id("assets")), siteId: v.optional(v.id("sites")) },
  handler: async (ctx, { userId, assetId, siteId }) => {
    if (!!assetId === !!siteId) throw new ConvexError("Pass exactly one of assetId or siteId");
    const target = assetId ? await ctx.db.get(assetId) : await ctx.db.get(siteId!);
    if (!target) throw new ConvexError("Not found");
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_org_and_user", (q) => q.eq("orgId", target.orgId).eq("userId", userId))
      .unique();
    if (!membership || membership.status !== "active" || membership.role === "client_user") {
      throw new ConvexError("Insufficient permissions");
    }
    const org = await ctx.db.get(target.orgId);
    if (assetId) {
      const asset = target as Doc<"assets">;
      let tag = asset.tagCode;
      if (!tag) {
        tag = newPublicToken(10);
        await ctx.db.patch(asset._id, { tagCode: tag });
      }
      const [type, site] = await Promise.all([ctx.db.get(asset.assetTypeId), ctx.db.get(asset.siteId)]);
      return { kind: "asset" as const, orgName: org?.name ?? "", title: asset.reference, subtitle: type?.name ?? "", place: site?.name ?? "", code: tag };
    }
    const site = target as Doc<"sites">;
    let token = site.qrToken;
    if (!token) {
      token = newPublicToken(10);
      await ctx.db.patch(site._id, { qrToken: token });
    }
    return { kind: "site" as const, orgName: org?.name ?? "", title: site.name, subtitle: "Fire & security compliance", place: site.address.city ?? "", code: token };
  },
});

export const saveLabel = internalMutation({
  args: { assetId: v.optional(v.id("assets")), siteId: v.optional(v.id("sites")), storageId: v.id("_storage") },
  handler: async (ctx, { assetId, siteId, storageId }) => {
    const target = assetId ? await ctx.db.get(assetId) : siteId ? await ctx.db.get(siteId) : null;
    if (!target) {
      await ctx.storage.delete(storageId);
      return null;
    }
    if (target.labelPdfId && target.labelPdfId !== storageId) await ctx.storage.delete(target.labelPdfId);
    await ctx.db.patch(target._id, { labelPdfId: storageId });
    return await ctx.storage.getUrl(storageId);
  },
});

/* ------------------------------------------------------------------ */
/* Drafts: create / edit / sign / delete, list & get                   */
/* ------------------------------------------------------------------ */


const certStatus = v.union(v.literal("draft"), v.literal("pending_signature"), v.literal("issued"), v.literal("superseded"), v.literal("revoked"));
const overall = v.union(v.literal("satisfactory"), v.literal("unsatisfactory"), v.literal("satisfactory_with_observations"));
const EDITABLE: Doc<"certificates">["status"][] = ["draft", "pending_signature"];

/** Certificates by status (staff; client users see their client's issued ones). Paginated, newest first. */
export const list = query({
  args: { orgId: v.id("organizations"), status: v.optional(certStatus), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { orgId, status, paginationOpts }) => {
    const { membership } = await requireMember(ctx, orgId, U.ANY);
    if (membership.role === "client_user") {
      const page = await ctx.db.query("certificates").withIndex("by_client", (q) => q.eq("clientId", membership.clientId!)).order("desc").paginate(paginationOpts);
      const out = [];
      for (const c of page.page) {
        if (EDITABLE.includes(c.status) || (status && c.status !== status)) continue;
        const site = await ctx.db.get(c.siteId);
        if (site && (await canSeeSite(ctx, membership, site))) out.push(c);
      }
      return { ...page, page: out };
    }
    return await ctx.db.query("certificates").withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", status ?? "issued")).order("desc").paginate(paginationOpts);
  },
});

export const get = query({
  args: { certificateId: v.id("certificates") },
  handler: async (ctx, { certificateId }) => {
    const { doc, membership } = await U.loadForMember(ctx, certificateId, "Certificate", U.ANY);
    const site = await U.loadDoc(ctx, doc.siteId, "Site");
    if (membership.role === "client_user" && (EDITABLE.includes(doc.status) || !(await canSeeSite(ctx, membership, site)))) U.fail("Certificate not found");
    const type = await ctx.db.get(doc.certificateTypeId);
    const { qualificationChecks, ...rest } = doc;
    const isClient = membership.role === "client_user";
    const overrides = (qualificationChecks ?? []).filter((c) => c.override);
    return {
      ...rest,
      // Staff only: qualification checks made at sign/issue (incl. owner/admin overrides with reason).
      qualificationChecks: isClient ? undefined : qualificationChecks,
      qualificationOverridden: isClient ? undefined : overrides.length > 0,
      typeName: type?.name ?? "", siteName: site.name,
      pdfUrl: doc.pdfStorageId ? await ctx.storage.getUrl(doc.pdfStorageId) : null,
      verifyUrl: certificateVerifyUrl(doc.verificationToken),
      editable: EDITABLE.includes(doc.status),
    };
  },
});

async function checkCovered(ctx: MutationCtx, cert: { orgId: Id<"organizations">; siteId: Id<"sites"> }, a: { assetIds?: Id<"assets">[]; inspectionIds?: Id<"inspections">[]; defectIds?: Id<"defects">[] }) {
  for (const [ids, label] of [[a.assetIds, "Asset"], [a.inspectionIds, "Inspection"], [a.defectIds, "Defect"]] as const) {
    if (!ids) continue;
    if (ids.length > 5000) U.fail(`Too many ${label.toLowerCase()}s`);
    for (const id of ids) {
      const d = (await ctx.db.get(id)) as { orgId: Id<"organizations">; siteId: Id<"sites"> } | null;
      if (!d || d.orgId !== cert.orgId || d.siteId !== cert.siteId) U.fail(`${label} not found at this site`);
    }
  }
}

/**
 * Create a draft certificate from a job, a visit, or just a site. With a job/visit, the draft is
 * pre-filled with its inspections, the inspected assets and the defects raised on it.
 */
export const createDraft = mutation({
  args: {
    certificateTypeId: v.id("certificateTypes"),
    jobId: v.optional(v.id("jobs")), visitId: v.optional(v.id("visits")), siteId: v.optional(v.id("sites")),
    inspectionDate: v.optional(v.number()), overallResult: v.optional(overall), summary: v.optional(v.string()),
    clientGeneratedId: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const visit = a.visitId ? await U.loadDoc(ctx, a.visitId, "Visit") : null;
    const jobId = a.jobId ?? visit?.jobId;
    const job = jobId ? await U.loadDoc(ctx, jobId, "Job") : null;
    if (visit && job && visit.jobId !== job._id) U.fail("That visit belongs to another job");
    const siteId = job?.siteId ?? a.siteId;
    if (!siteId) U.fail("Pass a jobId, visitId or siteId");
    const { doc: site, user } = await U.loadForMember(ctx, siteId, "Site", U.STAFF);
    if (a.siteId && a.siteId !== site._id) U.fail("Site doesn't match the job");
    const type = await U.loadDoc(ctx, a.certificateTypeId, "Certificate type");
    if ((type.orgId && type.orgId !== site.orgId) || !type.isActive) U.fail("Certificate type not found");
    if (job && !job.disciplines.includes(type.discipline)) U.fail("This job doesn't cover that discipline");

    let inspections: Doc<"inspections">[] = [];
    if (visit) inspections = await ctx.db.query("inspections").withIndex("by_visit", (q) => q.eq("visitId", visit._id)).take(5000);
    else if (job) inspections = await ctx.db.query("inspections").withIndex("by_job", (q) => q.eq("jobId", job._id)).take(5000);
    inspections = inspections.filter((i) => i.discipline === type.discipline);
    const inspIds = new Set(inspections.map((i) => i._id));
    const visitIds = new Set(inspections.map((i) => i.visitId).filter(Boolean));
    const openDefects = await ctx.db.query("defects").withIndex("by_site_and_status", (q) => q.eq("siteId", site._id).eq("status", "open")).take(2000);
    const defects = openDefects.filter((d) => d.discipline === type.discipline && ((d.inspectionId && inspIds.has(d.inspectionId)) || (d.visitId && visitIds.has(d.visitId)) || (!job && !visit)));
    const assetIds = [...new Set(inspections.map((i) => i.assetId).filter((x): x is Id<"assets"> => !!x))];
    const inspectionDate = a.inspectionDate ?? (inspections.length ? Math.max(...inspections.map((i) => i.performedAt)) : Date.now());
    const result = a.overallResult ?? (defects.some((d) => d.severity === "critical" || d.severity === "major") ? "unsatisfactory" : defects.length ? "satisfactory_with_observations" : "satisfactory");

    const now = Date.now();
    const certificateNumber = await U.nextNumber(ctx, site.orgId, `certificate:${type.numberPrefix}`, type.numberPrefix);
    const id = await ctx.db.insert("certificates", {
      orgId: site.orgId, clientId: site.clientId, siteId: site._id, certificateTypeId: type._id, discipline: type.discipline, certificateNumber,
      jobId: job?._id, visitId: visit?._id, assetIds, inspectionIds: [...inspIds], defectIds: defects.map((d) => d._id),
      overallResult: result, summary: U.optStr(a.summary, "Summary", 10000), status: "draft", inspectionDate,
      nextInspectionDueAt: type.validityMonths ? U.addMonths(inspectionDate, type.validityMonths) : undefined,
      verificationToken: newPublicToken(), revision: 0, clientGeneratedId: a.clientGeneratedId, createdAt: now, updatedAt: now,
    });
    await U.audit(ctx, site.orgId, user._id, "certificate.draft_created", "certificate", id, { certificateNumber });
    return id;
  },
});

/** Edit a draft (content, covered assets/inspections/defects, dates). Issued certificates are locked; use reissue. */
export const updateDraft = mutation({
  args: {
    certificateId: v.id("certificates"),
    assetIds: v.optional(v.array(v.id("assets"))), inspectionIds: v.optional(v.array(v.id("inspections"))), defectIds: v.optional(v.array(v.id("defects"))),
    addAssetIds: v.optional(v.array(v.id("assets"))), addInspectionIds: v.optional(v.array(v.id("inspections"))), addDefectIds: v.optional(v.array(v.id("defects"))),
    overallResult: v.optional(overall), summary: v.optional(v.string()), data: v.optional(v.any()),
    inspectionDate: v.optional(v.number()), expiresAt: v.optional(v.number()), nextInspectionDueAt: v.optional(v.number()),
  },
  handler: async (ctx, { certificateId, ...a }) => {
    const { doc, user } = await U.loadForMember(ctx, certificateId, "Certificate", U.STAFF);
    if (!EDITABLE.includes(doc.status)) U.fail(`This certificate is ${doc.status} and can't be edited`);
    const merge = <T,>(base: T[], set?: T[], add?: T[]) => (set || add ? [...new Set([...(set ?? base), ...(add ?? [])])] : undefined);
    const assetIds = merge(doc.assetIds, a.assetIds, a.addAssetIds);
    const inspectionIds = merge(doc.inspectionIds, a.inspectionIds, a.addInspectionIds);
    const defectIds = merge(doc.defectIds, a.defectIds, a.addDefectIds);
    await checkCovered(ctx, doc, { assetIds: a.assetIds || a.addAssetIds ? assetIds : undefined, inspectionIds: a.inspectionIds || a.addInspectionIds ? inspectionIds : undefined, defectIds: a.defectIds || a.addDefectIds ? defectIds : undefined });
    if (a.data !== undefined && JSON.stringify(a.data).length > 200_000) U.fail("Certificate data is too large");
    const inspectionDate = a.inspectionDate ?? doc.inspectionDate;
    if (a.inspectionDate !== undefined && a.inspectionDate > Date.now() + U.DAY) U.fail("Inspection date can't be in the future");
    if (a.expiresAt !== undefined && a.expiresAt <= inspectionDate) U.fail("Expiry must be after the inspection date");
    const patch = U.defined({
      assetIds, inspectionIds, defectIds, overallResult: a.overallResult, summary: U.optStr(a.summary, "Summary", 10000), data: a.data,
      inspectionDate: a.inspectionDate, expiresAt: a.expiresAt, nextInspectionDueAt: a.nextInspectionDueAt,
    });
    // Content changed after signing: signatures no longer cover it.
    const contentChanged = Object.keys(patch).length > 0;
    await ctx.db.patch(certificateId, { ...patch, ...(contentChanged && (doc.engineerSignature || doc.clientSignature) ? { engineerSignature: undefined, clientSignature: undefined, status: "draft" as const } : {}), updatedAt: Date.now() });
    await U.audit(ctx, doc.orgId, user._id, "certificate.draft_updated", "certificate", certificateId, { fields: Object.keys(patch), signaturesCleared: contentChanged && !!(doc.engineerSignature || doc.clientSignature) });
  },
});

/** Add the engineer's or the client's signature to a draft (image uploaded via visits.generateUploadUrl). */
export const sign = mutation({
  args: {
    certificateId: v.id("certificates"),
    as: v.union(v.literal("engineer"), v.literal("client")),
    signature: U.signatureInputV,
    /** Owner/admin only, engineer signature: sign even though not qualified for the discipline. Recorded on the certificate. */
    qualificationOverrideReason: v.optional(v.string()),
  },
  handler: async (ctx, { certificateId, as, signature, qualificationOverrideReason }) => {
    const { doc, user, membership } = await U.loadForMember(ctx, certificateId, "Certificate", U.STAFF);
    if (!EDITABLE.includes(doc.status)) U.fail(`This certificate is ${doc.status}`);
    const type = await U.loadDoc(ctx, doc.certificateTypeId, "Certificate type");
    if (as === "engineer") {
      if (membership.role === "office") U.fail("The engineer signature must be given by an engineer or manager");
    }
    const sig = await U.makeSignature(ctx, signature, as === "engineer" ? user._id : undefined);
    let checks = doc.qualificationChecks;
    let check: QualCheck | undefined;
    if (as === "engineer") {
      check = await qualificationGate(ctx, doc, user._id, { user, role: membership.role }, "sign", qualificationOverrideReason, sig.signedAt);
      checks = [...(doc.qualificationChecks ?? []), check];
      if (check.override) await U.audit(ctx, doc.orgId, user._id, "certificate.qualification_override", "certificate", certificateId, { stage: "sign", engineerUserId: user._id, discipline: doc.discipline, detail: check.detail, reason: check.override.reason });
    }
    const next = { ...doc, [as === "engineer" ? "engineerSignature" : "clientSignature"]: sig };
    const status = type.requiresClientSignature && next.engineerSignature && !next.clientSignature ? "pending_signature" : "draft";
    await ctx.db.patch(certificateId, { [as === "engineer" ? "engineerSignature" : "clientSignature"]: sig, qualificationChecks: checks, status, updatedAt: Date.now() });
    await U.audit(ctx, doc.orgId, user._id, `certificate.signed_${as}`, "certificate", certificateId, { signedByName: sig.signedByName });
    return {
      readyToIssue: !!next.engineerSignature && (!type.requiresClientSignature || !!next.clientSignature),
      qualification: check ? { qualified: check.qualified, detail: check.detail, overridden: !!check.override } : undefined,
    };
  },
});

/**
 * Staff: would this engineer pass the qualification check for this certificate right now?
 * Defaults to the current user (engineer signing) or, if already signed, the signing engineer.
 * Use before showing the sign / issue buttons; `canOverride` = current user is owner/admin.
 */
export const qualificationCheck = query({
  args: { certificateId: v.id("certificates"), engineerUserId: v.optional(v.id("users")) },
  handler: async (ctx, { certificateId, engineerUserId }) => {
    const { doc, user, membership } = await U.loadForMember(ctx, certificateId, "Certificate", U.STAFF);
    const org = await ctx.db.get(doc.orgId);
    const target = engineerUserId ?? doc.engineerSignature?.signedByUserId ?? user._id;
    const r = await checkQualification(ctx, doc.orgId, target, doc.discipline, Date.now(), org?.timezone);
    const sig = doc.engineerSignature;
    const priorOverride = !!sig && (doc.qualificationChecks ?? []).some((c) => c.stage === "sign" && c.engineerUserId === target && c.signatureSignedAt === sig.signedAt && c.override);
    return { ...r, canOverride: membership.role === "owner" || membership.role === "admin", coveredByPriorOverride: !r.qualified && priorOverride };
  },
});

/** Delete a draft that was never issued (office). */
export const removeDraft = mutation({
  args: { certificateId: v.id("certificates") },
  handler: async (ctx, { certificateId }) => {
    const { doc, user } = await U.loadForMember(ctx, certificateId, "Certificate", U.OFFICE);
    if (!EDITABLE.includes(doc.status)) U.fail("Only drafts can be deleted; revoke an issued certificate instead");
    await ctx.db.delete(certificateId);
    await U.audit(ctx, doc.orgId, user._id, "certificate.draft_deleted", "certificate", certificateId, { certificateNumber: doc.certificateNumber });
  },
});
