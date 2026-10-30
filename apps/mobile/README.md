# apps/mobile (planned)

Placeholder for the Expo (React Native) app. It will import:

- the Convex API types from `@fire/backend` (`packages/backend/convex/_generated/api`)
- the **role & permission map** from `@fire/shared` (`packages/shared/src/permissions.ts`) — the
  same map the web app uses, so web and mobile always agree on who can see what.

## Planned role behaviour

### Engineer (primary user of the mobile app)

Engineer-first. Tabs: **Today · My jobs · Defects · Certificates · Me**

| Screen | Data | Notes |
| --- | --- | --- |
| Today / My jobs | `jobs.myJobs({ orgId, from, to })` | Only jobs assigned to me. Today = scheduled today + in progress/on hold + overdue; Upcoming = next 30 days. Offline cache later. |
| Job (capture) | `jobs.get`, `visits.*`, `inspections.*`, `attachments.*` | Start/finish visit, inspection checklist per asset, photos, notes, customer signature. Only for jobs in my `myJobs` list. |
| Site & assets | `sites.get`, `assets.listBySite`, `locations.listBySite` | Only sites of my jobs (`scopeFor(role, "sites") === "assigned"`). Edit asset details on site (`assets.edit`). |
| Defects | `defects.raise`, `defects.list` | Raise from a job/asset with photos; view defects at my sites. No verify/close, no quoting. |
| Certificates | `certificates.createDraft/updateDraft/sign` | Create and sign as engineer on my jobs. Issue/reissue/revoke stay in the office. |
| Me | `users.me`, `qualifications.list({ userId: me })` | My details and qualifications (with expiry warnings). |

Hidden from engineers: clients list, quotes, invoices, prices, schedules, team, settings, other engineers' jobs.

### Owner / Admin / Office

**Read-only overview** on mobile (all management stays on the web app):

- Dashboard counts (jobs today, overdue, open defects, certificates due)
- Today's jobs across the team, with engineer and status
- Look up a site / client / job and see its status
- Owner/admin only: overdue invoices summary (`invoices.view`)

No create/edit screens for these roles in v1 — a "Open on web" link instead.

### Client users

Not supported in the mobile app (they use the web `/portal`).

## How to use the shared map

```ts
import { can, scopeFor, sectionsFor, canAccessWebPath, type Role } from "@fire/shared";

const role: Role = membership.role;            // from users.me / organizations
sectionsFor(role);                              // menu/tab items the role may see
can(role, "defects.raise");                     // true for engineers
can(role, "invoices.view");                     // false for engineers
scopeFor(role, "jobs");                         // "assigned" for engineers, "all" for office+
```

Map mobile tabs to the same permission keys (`dashboard.view`, `jobs.viewAssigned`, `defects.raise`,
`certificates.viewAssigned`, `profile.view`, …) rather than checking role names directly. Expo/Metro
needs `watchFolders` pointing at `packages/shared` (monorepo) — the package ships TypeScript source.

## Important: the backend must enforce this too

Hiding screens is not security. Today several Convex functions still return data to engineers that
the apps hide (all jobs, all sites, clients, quotes with prices, bank details, schedules, reminders)
and let engineers raise defects / create certificates at any site. The list of gaps is in the
"Role-based access" section of the root `README.md` — these need fixing in the Convex project
before the mobile app ships.
