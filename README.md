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
│  └─ backend/      copy of the Convex project — types only, NOT the deploy source (see its README)
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
