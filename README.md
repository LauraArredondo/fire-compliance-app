# Fire Compliance App

Multi-tenant SaaS for UK fire & security compliance companies (BS 5839 fire alarms, BS 5266 emergency
lighting, BAFE, NSI). The backend is Convex; this repo has the **web app** (Next.js), a typed copy of the
**backend**, and room for a **mobile app**.

```
fire-compliance-app/
├─ apps/
│  ├─ web/          Next.js 16 (App Router) + TypeScript + Tailwind v4
│  └─ mobile/       placeholder (Expo app goes here later)
├─ packages/
│  ├─ backend/      copy of the Convex project — types only, NOT the deploy source (see its README)
│  └─ shared/       role & permission map shared by web and mobile (@fire/shared)
├─ .env.example
└─ package.json     npm workspaces
```

## Web app — what's in it

| Area | Routes |
| --- | --- |
| Auth | `/signin` (sign in / create account, password ≥ 8 chars with a letter and a number), `/onboarding` (create company) |
| Staff app | `/app` dashboard · clients · sites (locations, asset register) · assets · jobs (status flow, engineer assignment with qualification warnings, visits) · defects · certificates (create, sign engineer/client, issue with qualification override, PDF, reissue, revoke) · service schedules (auto-job lead days, default engineer, "run auto-jobs now") · quotes · invoices (overdue badge, payments, void, PDF) · team (invites, roles, qualifications) · settings (profile, logo, bank details, quote terms, invoice footer, reminders, job automation) |
| Client portal (`client_user`) | `/portal` overview · sites (read-only assets, certificates, defects, upcoming services) · certificates · defects · quotes · invoices (with PDFs) |
| Public | `/quotes/[token]` view / accept (name, PO, optional items, signature) / decline · `/invite/team/[token]` · `/invite/portal/[token]` |

The org switcher (sidebar) lets a user who belongs to several companies switch between them; staff are
routed to `/app`, client users to `/portal`.

Emails are in dry-run mode on the backend, so invite links and quote links are shown in the UI with a
**Copy** button.

## Running locally

Requirements: Node 20.9+ (Node 24 recommended).

```bash
npm install
cp .env.example apps/web/.env.local     # only the public Convex URLs; no secrets
npm run dev                             # http://localhost:3000
```

Other scripts: `npm run typecheck`, `npm run build`.

The web app talks to the deployed Convex dev deployment `elegant-echidna-735`. It never needs a deploy
key — **don't** run `npx convex dev` / `npx convex deploy` in this repo (see `packages/backend/README.md`).

For links in backend emails (quote accept, invites, portal invoices) to point at this site, the Convex
deployment's `SITE_URL` env var must be the web app's URL (e.g. `http://localhost:3000` while developing).

## Working from VS Code / Cursor and pushing to GitHub

The remote is already configured:

```bash
git remote -v      # origin  https://github.com/LauraArredondo/fire-compliance-app.git
```

The GitHub repo was created with a single "Initial commit". This repo has its own history, so the first push
needs to combine them. Either:

```bash
# Option A (keeps GitHub's initial commit):
git pull origin main --allow-unrelated-histories   # resolve any README conflict, then commit
git push -u origin main

# Option B (replaces GitHub's initial commit — only if nothing else is on GitHub):
git push -u origin main --force
```

In VS Code/Cursor: open the folder, then **Source Control → … → Pull, Push → Push** (after the one-time
pull/force above). Never commit `apps/web/.env.local` or any `.env` with a deploy key — they're gitignored.

## Role-based access

What each role sees is defined once in `packages/shared/src/permissions.ts` and drives both the
sidebar and the route guards. Opening a page your role can't use redirects to `/app` with a
"not available for your role" message.

| Role | Sees |
| --- | --- |
| **Engineer** | Dashboard (today, upcoming, open defects at my sites) · **My jobs** (only jobs assigned to them) and their job pages · the site & assets for those jobs · defects at those sites (raise/view) · certificates for those sites (create/sign as engineer) · My profile (details + qualifications). No clients list, quotes, invoices, prices, schedules, team or settings, and no other engineers' jobs. |
| **Office** | Everything, except: void invoices, manage team, company/bank/reminder settings, revoke certificates, override qualification checks, sign as engineer. |
| **Owner / Admin** | Everything. |
| **Client user** | Client portal (`/portal`) only — unchanged. |

### Backend gaps (to fix in the Convex project)

The web app hides these, but the Convex functions still allow them for engineers (verified with a live
probe on the dev deployment). Hiding in the UI is not security — these need fixing in the backend:

1. `jobs:get` returns jobs not assigned to the engineer (also check `visits:listByJob`, `inspections:listForVisit`, `attachments:listForEntity` for jobs).
2. `jobs:list` returns every job in the company to engineers — refuse or filter to assigned.
3. `sites:list` / `sites:get` return all sites; same for `assets:list/get`, `locations:listBySite`, `defects:openForSite`, `certificates:listBySite` — scope to sites of assigned jobs.
4. `clients:list` (STAFF) / `clients:get` (ANY) expose billing address, account number, notes — make OFFICE-only or return name only.
5. `quotes:list` / `quotes:get` / `quotes:getPdf` expose prices — refuse engineers (as `invoices:list` already does).
6. `organizations:get` returns `bankDetails` and billing settings — strip for non-office roles.
7. `serviceSchedules:list` / `get` / `dueSoon` — make OFFICE (or limit to assigned sites).
8. `reminders:list`, `listNotifications`, `getNotification`, `snooze`, `dismiss` are STAFF — engineers can see/dismiss office reminders (incl. invoice overdue). Make OFFICE.
9. `defects:raise` / `update` work at any site; `defects:list` is org-wide — restrict engineers to sites of assigned jobs.
10. `certificates:createDraft` / `updateDraft` / `sign` / `issue` / `reissue` don't check assignment; `certificates:list` is org-wide — restrict engineers; consider `reissue` OFFICE-only.
11. `assets:*` and `locations:*` mutations (STAFF) work at any site — same scoping.

Already correct: `invoices:list`, `team:list`, `getReminderSettings` refuse engineers; `qualifications:list` is self-only for engineers.
Suggested helper: `requireJobAccess(ctx, jobId)` / `canAccessSite(ctx, member, siteId)` (engineer ⇒ must have an assigned, non-cancelled job at that site).

