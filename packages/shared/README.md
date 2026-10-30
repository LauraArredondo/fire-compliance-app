# @fire/shared

Code shared by `apps/web` and (later) `apps/mobile`. Currently: the **role & permission map**
(`src/permissions.ts`).

- `ROLES`, `Role`, `ROLE_LABELS`, `STAFF_ROLES` / `OFFICE_ROLES` / `MANAGER_ROLES` (mirror the backend's
  `STAFF` / `OFFICE` / `MANAGERS` in `convex/lib/util.ts`)
- `ROLE_PERMISSIONS` — the single source of truth for what each role may do
- `can(role, perm)`, `canAny`, `scopeFor(role, area)` → `"all" | "assigned" | "none"`
- `SECTIONS` / `sectionsFor(role)` — menu items (web sidebar, mobile tabs)
- `WEB_ROUTES` / `canAccessWebPath(role, path)` — web route guard

To change who can see what, edit `ROLE_PERMISSIONS` and run:

```
npm run test -w @fire/shared        # route/permission assertions
npm run typecheck -w @fire/shared
```
