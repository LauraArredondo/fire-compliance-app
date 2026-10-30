# apps/mobile (planned)

Placeholder for the Expo (React Native) engineer app. Do not scaffold the app in this folder yet —
when it is created it should be FireGrid from the first screen.

Shared design system lives in `@fire/tokens` (`packages/tokens`):

| File | Use |
| --- | --- |
| `theme.ts` | `light`, `dark`, `themes`, `spacing`, `radius`, `duration`, `easing`, `font`. Import with `import { themes, radius, spacing } from "@fire/tokens"`. |
| `tokens.json` | W3C DTCG source (light + dark). |
| `tokens.css` | CSS custom properties used by the web app. |
| `logo/` | Mark, wordmark, lockup (light/dark) and app icons (light/dark). Copies also sit in `apps/mobile/assets/brand/`. |

Wiring notes (also in `packages/tokens/tailwind-theme.md`):

- Pick the theme with `useColorScheme()` plus a user override, and provide it through context. `themes.dark.bg.canvas` is `#000000`; `themes.dark.surface.default` is `#0E0D0C`.
- Set `userInterfaceStyle: "automatic"` in `app.json`. On dark, use a light status bar and a `#000000` navigation bar.
- Gradients: `expo-linear-gradient` with `gradient.fireStart` / `fireMid` / `fireEnd` (start `{x:0,y:1}`, end `{x:1,y:0}`).
- Fonts: `expo-font` with Geist (Regular, Medium, SemiBold, Bold) and Geist Mono for job and certificate numbers.
- The app will import Convex API types from `@fire/backend` (`packages/backend/convex/_generated/api`).
