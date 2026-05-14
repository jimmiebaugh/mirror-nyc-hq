# Token diff: HQ → Source (Phase 3.5b visual brand pass)

Comparison of HQ's pre-pass design tokens against the canonical source app (`mirror-talent-scout/tailwind.config.ts` + `src/index.css`). This is the drift map the rest of the phase fixes.

## Color palette

HQ was running an emerald-green primary on a blue-tinted dark background. Source is **coral red on pure black**. Wholesale swap.

| Token | HQ (before) | Source (canonical) | Notes |
| --- | --- | --- | --- |
| `--background` | `222 28% 7%` (blue-tinted near-black) | `0 0% 0%` (pure black `#000`) | Source has no light-mode counterpart. |
| `--foreground` | `210 20% 92%` | `0 0% 100%` (white) | |
| `--card` | `222 25% 10%` | `0 0% 8%` (`#141414`) | |
| `--popover` | `222 25% 10%` | `0 0% 8%` | |
| `--primary` | `158 64% 52%` (emerald) | `0 83% 65%` (`#ef5b5b` coral) | **The brand color flip.** |
| `--primary-foreground` | `222 47% 8%` | `0 0% 100%` (white) | Source uses white text on coral. |
| `--primary-hover` | (missing) | `0 86% 71%` (`#f47373`) | New token. |
| `--secondary` | `222 20% 14%` | `0 0% 11%` | |
| `--muted` | `222 20% 14%` | `0 0% 11%` | |
| `--muted-foreground` | `220 10% 60%` | `0 0% 78%` (`#c8c8c8`) | Source mutes are lighter: closer to off-white. |
| `--subtle-foreground` | (missing) | `0 0% 54%` (`#8a8a8a`) | New token for tertiary text. |
| `--accent` | `158 64% 52%` (same as primary) | `0 0% 14%` (`#242424`) | Source `accent` is a surface color, NOT primary. Big semantic shift. |
| `--accent-foreground` | `222 47% 8%` | `0 0% 100%` | |
| `--destructive` | `0 62% 45%` | `0 84% 60%` | |
| `--destructive-foreground` | `210 20% 98%` | `0 0% 100%` | |
| `--success` | (missing) | `142 76% 64%` (`#4ade80`) | New token. |
| `--warn` | (missing) | `38 92% 50%` (`#f59e0b`) | New token. |
| `--border` | `222 20% 18%` | `0 0% 16%` (`#2a2a2a`) | |
| `--border-strong` | (missing) | `0 0% 23%` (`#3a3a3a`) | New token. |
| `--input` | `222 20% 18%` | `0 0% 16%` | |
| `--ring` | `158 64% 52%` | `0 83% 65%` | Matches primary. |
| `--surface` | (missing) | `0 0% 8%` | New token (panel background). |
| `--surface-alt` | (missing) | `0 0% 11%` | New token (raised panel). |
| `--surface-raised` | (missing) | `0 0% 14%` | New token (highest elevation). |

HQ also has `--sidebar-*` tokens for the shadcn `sidebar` component, but `AppShell` doesn't render that component: they're inert. Leaving them in place to avoid breaking the unused `components/ui/sidebar.tsx`.

## Radius

| Token | HQ | Source |
| --- | --- | --- |
| `--radius` | `0.5rem` (8px) | `0.25rem` (4px) | Source is squarer. |

## Typography

| | HQ (before) | Source |
| --- | --- | --- |
| Font import | none (system stack only) | `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap')` |
| Body `font-family` | `ui-sans-serif, system-ui, -apple-system, "Inter", "Segoe UI", sans-serif` | `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif` |
| Body `font-size` | implicit (`16px` default) | **`17px`** explicit |
| Body `line-height` | implicit | `1.5` explicit |
| `font-feature-settings` | `"ss01", "cv11"` | none |
| Tailwind `fontFamily.sans` | unset (defaults to system) | `["Inter", "ui-sans-serif", "system-ui"]` |

Source loads Inter weights 400-900 to support the brand's heavy uppercase headings (e.g. `.h-page` is `font-black uppercase` 43px).

## Component-layer utility classes

Source defines these in its `@layer components`. HQ defines none of them. Bringing them all over so they're available for any current/future component that wants them. None are used in HQ today, so adding them is purely additive.

- `.h-page`: page heading, 43px, `font-black uppercase`, tight letter-spacing.
- `.label-section`, `.label-form`: 11px bold uppercase section/form labels.
- `.crumb`: 12px medium uppercase breadcrumb.
- `.btn-base`, `.btn-primary`, `.btn-ghost`, `.btn-light`: branded button variants (42px tall, 4px radius, 13px bold uppercase).
- `.input-base`, `.input-filled`, `.textarea-base`: 44px inputs with `surface-alt` background and primary focus ring.
- `.tier-badge`, `.tier-badge--1/2/3/bonus`: scorecard tier pills (T1 red, T2 amber, T3 green, bonus coral).
- `.manual-tag`: coral micro-tag for "Manual" overrides.
- `.surface`, `.surface-alt`: panel containers.
- `.status-pill`, `.status-pill--active/complete/new`: running/complete pill variants.

## Tailwind config additions

To expose the new tokens through Tailwind's color shorthand, add `colors.surface{,-alt,-raised}`, `colors.primary.hover`, `colors.subtle.foreground`, `colors.success`, `colors.warn`, `colors.border-strong` (root key, since Tailwind needs a string value here, not a nested object). Container/keyframes/animation are already aligned.

## Out of scope

Per the phase brief, layout/spacing/sizes/structure are NOT changed in this pass. If source's component-layer classes mix typography with spacing (the buttons set `h-[42px] px-6`, inputs set `h-[44px]`), those numbers come along with the class definitions but no HQ component is being switched onto those classes in this phase. Any structural drift surfaced by the screenshot pass goes to `structural-drift.md` for a future review.
