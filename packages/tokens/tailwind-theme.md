# FireGrid tokens → Tailwind v4 (web) & React Native / Expo (mobile)

Source of truth: `tokens.json` (W3C DTCG). `tokens.css` is generated from it and holds every
value as a `--fg-*` CSS custom property. Light is the default; dark mode applies under
`.dark` **or** `[data-theme="dark"]` (true black `#000` canvas).

Figma: the same names are Figma variables. `Primitives` holds the raw ramps, and
`Theme · Light` / `Theme · Dark` hold the semantic tokens. They are two collections because the
Starter plan allows only 1 mode per collection. The CSS uses `var(--fg-{group}-{name})`, which
matches each variable's WEB code syntax.

---

## 1. Web: apps/web (Next.js + Tailwind v4)

### 1.1 Import the tokens
Copy `tokens.css` to `apps/web/src/styles/tokens.css`, then update `apps/web/src/app/globals.css`:

```css
@import "tailwindcss";
@import "../styles/tokens.css";

/* class-based dark mode (works with next-themes: attribute="class" or "data-theme") */
@custom-variant dark (&:where(.dark, .dark *, [data-theme="dark"], [data-theme="dark"] *));

@theme inline {
  /* ---- semantic colours (use these in components) ---- */
  --color-canvas:          var(--fg-bg-canvas);
  --color-subtle:          var(--fg-bg-subtle);
  --color-surface:         var(--fg-surface-default);
  --color-elevated:        var(--fg-surface-elevated);
  --color-overlay:         var(--fg-surface-overlay);
  --color-sunken:          var(--fg-surface-sunken);
  --color-glass:           var(--fg-surface-glass);
  --color-hover:           var(--fg-surface-hover);
  --color-inverse:         var(--fg-surface-inverse);

  --color-line:            var(--fg-border-default);
  --color-line-subtle:     var(--fg-border-subtle);
  --color-line-strong:     var(--fg-border-strong);
  --color-line-glass:      var(--fg-border-glass);

  --color-fg:              var(--fg-text-primary);
  --color-fg-2:            var(--fg-text-secondary);
  --color-fg-muted:        var(--fg-text-muted);
  --color-fg-inverse:      var(--fg-text-inverse);
  --color-on-brand:        var(--fg-text-on-brand);
  --color-link:            var(--fg-text-link);

  --color-brand:           var(--fg-brand-primary);
  --color-brand-hover:     var(--fg-brand-primary-hover);
  --color-brand-pressed:   var(--fg-brand-primary-pressed);
  --color-brand-2:         var(--fg-brand-secondary);
  --color-brand-subtle:    var(--fg-brand-subtle);
  --color-brand-border:    var(--fg-brand-subtle-border);
  --color-ring:            var(--fg-focus-ring);

  --color-success:         var(--fg-status-success-fg);
  --color-success-bg:      var(--fg-status-success-bg);
  --color-success-line:    var(--fg-status-success-border);
  --color-success-solid:   var(--fg-status-success-solid);
  --color-warning:         var(--fg-status-warning-fg);
  --color-warning-bg:      var(--fg-status-warning-bg);
  --color-warning-line:    var(--fg-status-warning-border);
  --color-warning-solid:   var(--fg-status-warning-solid);
  --color-danger:          var(--fg-status-danger-fg);
  --color-danger-bg:       var(--fg-status-danger-bg);
  --color-danger-line:     var(--fg-status-danger-border);
  --color-danger-solid:    var(--fg-status-danger-solid);
  --color-info:            var(--fg-status-info-fg);
  --color-info-bg:         var(--fg-status-info-bg);
  --color-info-line:       var(--fg-status-info-border);
  --color-info-solid:      var(--fg-status-info-solid);
  --color-neutral:         var(--fg-status-neutral-fg);
  --color-neutral-bg:      var(--fg-status-neutral-bg);
  --color-neutral-line:    var(--fg-status-neutral-border);

  /* ---- raw ramps, for illustration/one-offs only ---- */
  --color-crimson-500: var(--fg-crimson-500);  /* …repeat 50–950 for crimson, red, orange, amber, yellow, ash, green, blue */

  /* ---- type ---- */
  --font-sans: var(--fg-font-sans), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--fg-font-mono), ui-monospace, monospace;

  /* ---- radius ---- */
  --radius-xs: var(--fg-radius-xs);   /* 4  */
  --radius-sm: var(--fg-radius-sm);   /* 8  */
  --radius-md: var(--fg-radius-md);   /* 12 */
  --radius-lg: var(--fg-radius-lg);   /* 16 */
  --radius-xl: var(--fg-radius-xl);   /* 20 */
  --radius-2xl: var(--fg-radius-2xl); /* 28 */
  --radius-3xl: var(--fg-radius-3xl); /* 36 */

  /* ---- elevation (switches light/dark automatically) ---- */
  --shadow-e1: var(--fg-shadow-elevation-1);
  --shadow-e2: var(--fg-shadow-elevation-2);
  --shadow-e3: var(--fg-shadow-elevation-3);
  --shadow-e4: var(--fg-shadow-elevation-4);
  --shadow-glow: var(--fg-shadow-glow-brand);

  /* ---- motion ---- */
  --ease-standard: var(--fg-easing-standard);
  --ease-emphasized: var(--fg-easing-emphasized);
  --ease-spring: var(--fg-easing-spring);
}

/* Spacing: Tailwind v4's default 4px scale (`--spacing: 0.25rem`) already equals the FireGrid
   space/* scale (space/4 = 16px = p-4), so no override is needed. */

@utility bg-fire   { background-image: var(--fg-gradient-fire); }
@utility text-fire { background-image: var(--fg-gradient-fire); -webkit-background-clip: text; background-clip: text; color: transparent; }
@utility glass     { background: var(--fg-surface-glass); backdrop-filter: blur(20px) saturate(140%); border: 1px solid var(--fg-border-glass); }

/* type styles as utilities */
@utility type-display-xl { font-size: var(--fg-text-display-xl-size); line-height: var(--fg-text-display-xl-line); font-weight: var(--fg-text-display-xl-weight); letter-spacing: var(--fg-text-display-xl-tracking); }
@utility type-h1 { font-size: var(--fg-text-heading-h1-size); line-height: var(--fg-text-heading-h1-line); font-weight: var(--fg-text-heading-h1-weight); letter-spacing: var(--fg-text-heading-h1-tracking); }
@utility type-h2 { font-size: var(--fg-text-heading-h2-size); line-height: var(--fg-text-heading-h2-line); font-weight: var(--fg-text-heading-h2-weight); letter-spacing: var(--fg-text-heading-h2-tracking); }
@utility type-h3 { font-size: var(--fg-text-heading-h3-size); line-height: var(--fg-text-heading-h3-line); font-weight: var(--fg-text-heading-h3-weight); letter-spacing: var(--fg-text-heading-h3-tracking); }
@utility type-overline { font-size: var(--fg-text-overline-size); line-height: var(--fg-text-overline-line); font-weight: var(--fg-text-overline-weight); letter-spacing: var(--fg-text-overline-tracking); text-transform: uppercase; }

body { background: var(--fg-bg-canvas); color: var(--fg-text-primary); font-family: var(--font-sans); }
```

Fonts: load Geist and Geist Mono with `next/font` (the `geist` npm package exposes
`GeistSans`/`GeistMono`). Point `--fg-font-sans` / `--fg-font-mono` at their CSS variables, or keep
the literal family names.

### 1.2 Migration map for the current code (slate/red → tokens)

| Today (apps/web/src) | FireGrid utility |
|---|---|
| `bg-slate-50` (body, globals.css) | `bg-canvas` |
| `bg-white` cards (`ui.tsx` Card) | `bg-surface border border-line-subtle rounded-xl shadow-e1` |
| `bg-slate-900` sidebar (`Shell.tsx`) | `bg-surface border-r border-line-subtle` (active item: `bg-brand-subtle text-fg`, icon `text-brand`) |
| `text-slate-900 / 600 / 500` | `text-fg / text-fg-2 / text-fg-muted` |
| `text-red-700` links | `text-link` |
| primary buttons (`LinkButton`) | `bg-brand text-on-brand hover:bg-brand-hover rounded-md h-10 px-4 dark:shadow-glow` |
| `StatusBadge` | `bg-{status}-bg text-{status} border border-{status}-line rounded-full px-2.5 py-1` |
| `OverdueBadge` | danger chip |
| table header | `bg-sunken type-overline text-fg-muted` |
| focus | `focus-visible:outline-2 outline-ring outline-offset-2` |

Status mapping: **Passed/Complete → success · Due soon → warning · Overdue/Failed/Critical defect → danger · Scheduled/In progress → info · Draft/Cancelled → neutral.**

---

## 2. Mobile: apps/mobile (Expo / React Native)

React Native has no CSS variables. `theme.ts` (next to this file) is generated from `tokens.json` with
all aliases resolved. It exports `light`, `dark`, `spacing`, `radius`, `duration`, `easing` and `font`.
Copy it to `packages/ui/theme.ts` (or `apps/mobile/src/theme.ts`):

```tsx
import { useColorScheme } from 'react-native';
import { themes, radius, spacing } from '@fire/ui/theme';

export function useTheme() {
  const scheme = useColorScheme() ?? 'light';
  return themes[scheme];                // dark → bg.canvas '#000000', surface.default '#0E0D0C'
}

// usage
const t = useTheme();
<View style={{ backgroundColor: t.surface.default, borderColor: t.border.subtle, borderWidth: 1,
               borderRadius: radius.xl, padding: spacing['5'] }}>
  <Text style={{ color: t.text.primary, fontFamily: 'Geist-SemiBold' }}>Northgate Estates</Text>
</View>
```

* Pick the theme with `useColorScheme()` (and a user override in settings), then provide it via context.
* Set `userInterfaceStyle: "automatic"` in `app.json`. On dark, set the status bar to `light` and the
  navigation bar to `#000000`.
* Gradients: `expo-linear-gradient` with `gradient.fire` (start `{x:0,y:1}`, end `{x:1,y:0}`).
* Glass tab bar: `expo-blur` `<BlurView intensity={40} tint={scheme}>` behind `surface.glass`.
* Fonts: `expo-font` with `Geist-Regular/Medium/SemiBold/Bold` and `GeistMono-Medium` (job/cert numbers).
* Shadows: iOS `shadowColor/shadowOpacity/shadowRadius`, Android `elevation`. On dark, use the brand
  glow (`shadowColor: '#F97316', shadowOpacity: .45, shadowRadius: 16`) instead of black shadows.

**NativeWind option:** NativeWind v4 reads a Tailwind config, so the `@theme` names above can be reused.
Map `colors.canvas = 'var(--fg-bg-canvas)'` and use NativeWind's `vars()` helper to inject the light or
dark values from `theme.ts` at the root. Web and mobile then share class names such as `bg-surface text-fg`.

## 3. Regenerating
`python3 build/gen.py` regenerates `tokens.json`, `tokens.css` and the Figma variable payload from
`build/spec.py`. Change values there, not in the outputs.
