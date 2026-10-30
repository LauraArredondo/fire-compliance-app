/**
 * Role-based access, shared by the web app (apps/web) and the mobile app (apps/mobile).
 *
 * This decides what each role is SHOWN. The Convex backend is the real security boundary:
 * every query/mutation checks the caller's role itself. Keep this map in line with the
 * backend (see packages/backend/convex/lib/util.ts: STAFF / OFFICE / MANAGERS / ANY).
 *
 * Pure TypeScript, no dependencies, so it works in Next.js and React Native alike.
 */

export const ROLES = ["owner", "admin", "office", "engineer", "client_user"] as const;
export type Role = (typeof ROLES)[number];

export const STAFF_ROLES: readonly Role[] = ["owner", "admin", "office", "engineer"];
export const OFFICE_ROLES: readonly Role[] = ["owner", "admin", "office"];
export const MANAGER_ROLES: readonly Role[] = ["owner", "admin"];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  office: "Office",
  engineer: "Engineer",
  client_user: "Client portal",
};

/** Everything the apps can show or do, by area. */
export const PERMISSIONS = [
  "dashboard.view",
  "profile.view",
  // Jobs
  "jobs.viewAll", // every job in the company
  "jobs.viewAssigned", // only jobs the user is assigned to
  "jobs.manage", // create / edit / schedule / assign / cancel
  "jobs.workAssigned", // start / pause / complete own jobs, start and finish visits
  // Clients & sites
  "clients.view", // client list, contacts, account details
  "clients.manage",
  "sites.viewAll",
  "sites.viewAssigned", // sites of the user's own jobs
  "sites.manage", // create, edit name/address, archive
  "sites.editAccess", // access notes, contacts, hazards, locations
  // Assets
  "assets.view",
  "assets.edit",
  // Defects
  "defects.viewAll",
  "defects.viewAssigned",
  "defects.raise",
  "defects.verifyClose", // verify a fix or close without action
  "defects.quote", // turn a defect into a quote
  // Certificates
  "certificates.viewAll",
  "certificates.viewAssigned",
  "certificates.create",
  "certificates.signAsEngineer",
  "certificates.issue",
  "certificates.reissue",
  "certificates.deleteDraft",
  "certificates.revoke",
  "certificates.overrideQualification",
  // Office-only areas
  "schedules.view",
  "schedules.manage",
  "quotes.view",
  "quotes.manage",
  "invoices.view",
  "invoices.manage",
  "invoices.void",
  "team.view",
  "team.manage", // invite, change roles, deactivate
  "qualifications.manage",
  "portal.manage", // client portal invites and access
  "settings.view",
  "settings.company", // company profile, logo, bank details, quote/invoice terms
  "settings.reminders",
  "settings.automation",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ENGINEER: Permission[] = [
  "dashboard.view",
  "profile.view",
  "jobs.viewAssigned",
  "jobs.workAssigned",
  "sites.viewAssigned",
  "sites.editAccess",
  "assets.view",
  "assets.edit",
  "defects.viewAssigned",
  "defects.raise",
  "certificates.viewAssigned",
  "certificates.create",
  "certificates.signAsEngineer",
  "certificates.issue",
];

const OFFICE: Permission[] = PERMISSIONS.filter(
  (p) =>
    ![
      // Owner/admin only (enforced by the backend).
      "invoices.void",
      "team.manage",
      "settings.company",
      "settings.reminders",
      "certificates.revoke",
      "certificates.overrideQualification",
      // The backend refuses an engineer signature from office staff.
      "certificates.signAsEngineer",
      // Office sees everything rather than an assigned subset.
      "jobs.viewAssigned",
      "sites.viewAssigned",
      "defects.viewAssigned",
      "certificates.viewAssigned",
    ].includes(p),
);

const MANAGER: Permission[] = PERMISSIONS.filter(
  (p) => !["jobs.viewAssigned", "sites.viewAssigned", "defects.viewAssigned", "certificates.viewAssigned"].includes(p),
);

/** The single source of truth: which permissions each role has. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: MANAGER,
  admin: MANAGER,
  office: OFFICE,
  engineer: ENGINEER,
  // Client portal users use the separate read-only portal, not the staff app.
  client_user: [],
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return !!role && ROLE_PERMISSIONS[role].includes(permission);
}

export function canAny(role: Role | null | undefined, permissions: readonly Permission[]): boolean {
  return permissions.some((p) => can(role, p));
}

/** How much of an area a role sees: everything, only their own assigned work, or nothing. */
export type Scope = "all" | "assigned" | "none";
export type ScopedArea = "jobs" | "sites" | "defects" | "certificates";

export function scopeFor(role: Role | null | undefined, area: ScopedArea): Scope {
  if (can(role, `${area}.viewAll` as Permission)) return "all";
  if (can(role, `${area}.viewAssigned` as Permission)) return "assigned";
  return "none";
}

export const isStaff = (role: Role | null | undefined) => !!role && STAFF_ROLES.includes(role);
export const isOffice = (role: Role | null | undefined) => !!role && OFFICE_ROLES.includes(role);
export const isManager = (role: Role | null | undefined) => !!role && MANAGER_ROLES.includes(role);

/**
 * App sections, in menu order. `web` is the staff web route; mobile screens can reuse the
 * same keys. A section shows when the role has ANY of `anyOf`.
 */
export type Section = { key: string; label: string; web: string; anyOf: readonly Permission[]; engineerLabel?: string };
export const SECTIONS: readonly Section[] = [
  { key: "dashboard", label: "Dashboard", web: "/app", anyOf: ["dashboard.view"] },
  { key: "jobs", label: "Jobs", engineerLabel: "My jobs", web: "/app/jobs", anyOf: ["jobs.viewAll", "jobs.viewAssigned"] },
  { key: "clients", label: "Clients", web: "/app/clients", anyOf: ["clients.view"] },
  { key: "sites", label: "Sites", web: "/app/sites", anyOf: ["sites.viewAll"] },
  { key: "defects", label: "Defects", web: "/app/defects", anyOf: ["defects.viewAll", "defects.viewAssigned"] },
  { key: "certificates", label: "Certificates", web: "/app/certificates", anyOf: ["certificates.viewAll", "certificates.viewAssigned"] },
  { key: "schedules", label: "Service schedules", web: "/app/schedules", anyOf: ["schedules.view"] },
  { key: "quotes", label: "Quotes", web: "/app/quotes", anyOf: ["quotes.view"] },
  { key: "invoices", label: "Invoices", web: "/app/invoices", anyOf: ["invoices.view"] },
  { key: "team", label: "Team", web: "/app/team", anyOf: ["team.view"] },
  { key: "settings", label: "Settings", web: "/app/settings", anyOf: ["settings.view"] },
  { key: "profile", label: "My profile", web: "/app/profile", anyOf: ["profile.view"] },
];

export function sectionsFor(role: Role | null | undefined): Section[] {
  return SECTIONS.filter((s) => canAny(role, s.anyOf)).map((s) =>
    role === "engineer" && s.engineerLabel ? { ...s, label: s.engineerLabel } : s,
  );
}

/**
 * Web routes under /app and the permissions needed (ANY of). First match wins, so specific
 * paths come before their parents. `:id` matches one path segment.
 */
export const WEB_ROUTES: readonly { path: string; anyOf: readonly Permission[]; exact?: boolean }[] = [
  { path: "/app/jobs/new", anyOf: ["jobs.manage"] },
  { path: "/app/jobs/:id/edit", anyOf: ["jobs.manage"] },
  { path: "/app/jobs", anyOf: ["jobs.viewAll", "jobs.viewAssigned"] },
  { path: "/app/clients", anyOf: ["clients.view"] },
  { path: "/app/sites/new", anyOf: ["sites.manage"] },
  { path: "/app/sites/:id/edit", anyOf: ["sites.manage"] },
  { path: "/app/sites/:id", anyOf: ["sites.viewAll", "sites.viewAssigned"] },
  { path: "/app/sites", anyOf: ["sites.viewAll"] },
  { path: "/app/assets", anyOf: ["assets.view"] },
  { path: "/app/defects/new", anyOf: ["defects.raise"] },
  { path: "/app/defects", anyOf: ["defects.viewAll", "defects.viewAssigned"] },
  { path: "/app/certificates/new", anyOf: ["certificates.create"] },
  { path: "/app/certificates", anyOf: ["certificates.viewAll", "certificates.viewAssigned"] },
  { path: "/app/schedules", anyOf: ["schedules.view"] },
  { path: "/app/quotes", anyOf: ["quotes.view"] },
  { path: "/app/invoices", anyOf: ["invoices.view"] },
  { path: "/app/team", anyOf: ["team.view"] },
  { path: "/app/settings", anyOf: ["settings.view"] },
  { path: "/app/profile", anyOf: ["profile.view"] },
  { path: "/app", anyOf: ["dashboard.view"], exact: true },
];

function matches(pattern: string, pathname: string, exact = false): boolean {
  const p = pattern.split("/").filter(Boolean);
  const a = pathname.split("?")[0].split("/").filter(Boolean);
  if (a.length < p.length || (exact && a.length !== p.length)) return false;
  // A pattern also covers everything below it (e.g. "/app/quotes" covers "/app/quotes/123").
  return p.every((seg, i) => seg === ":id" || seg === a[i]);
}

/** Can this role open this web path? Unknown /app paths are allowed only for office and above. */
export function canAccessWebPath(role: Role | null | undefined, pathname: string): boolean {
  const rule = WEB_ROUTES.find((r) => matches(r.path, pathname, r.exact));
  if (!rule) return isOffice(role);
  return canAny(role, rule.anyOf);
}
