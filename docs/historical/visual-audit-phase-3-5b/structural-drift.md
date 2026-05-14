# Structural drift between HQ and source

Phase 3.5b is colors / typography / styling tokens only. Layout, spacing, sizes, and structure are intentionally NOT changed. This file logs structural differences I noticed while doing the visual audit, for a future review pass.

## Things I noticed but did NOT fix

### 1. `src/pages/Index.tsx` is dead code

This file is a Lovable-scaffold artifact: a centered "Welcome to Your Blank App" splash on a cream background (`#fcfbf8`). HQ's actual `/` route is wired to `Dashboard` in `App.tsx`, not `Index`. The file is unreachable. Not visible to users; doesn't affect the brand pass. Worth deleting in a cleanup commit.

### 2. Source has dedicated brand utility classes that HQ doesn't use

I ported source's `@layer components` block (`.h-page`, `.label-section`, `.btn-primary`, `.tier-badge`, `.status-pill`, etc.) into `src/index.css` so they're available, but no HQ component currently uses them. HQ components style with raw Tailwind utilities + tokens.

This isn't "wrong": both approaches reach the same visual outcome: but it means an HQ component lifted from source verbatim won't pick up source's exact button/input metrics unless we either (a) update the lifted component to use the new utility classes, or (b) keep using raw Tailwind. Pick a posture deliberately when porting Phase 3.6 / 3.7 components.

### 3. Source uses a different breadcrumb pattern

Source threads `.crumb` styling everywhere (12px medium uppercase, 65% white, +5% letter-spacing). HQ pages use a plain "Talent Scout" link in the header and rely on page titles for context. Not a brand drift; a navigation philosophy choice. Don't fix.

### 4. Source's StatusDropdown has different status enum values

Source: `interview / fast_track / consider / reviewed / hired / rejected / auto_rejected` (with legacy aliases `under_consideration`, `reviewed_no_decision`).

HQ: `interview / fast_track / consider / reject / auto_rejected`.

HQ deliberately trimmed this in Phase 3.5: `reviewed` and `hired` aren't part of HQ's review workflow. Documented in `docs/decisions.md`. Don't fix.

### 5. Source `RoleStatusPill` "Active" label

Source's RoleStatusPill defaults to `Active` when no rounds and no final report. HQ uses `Open` for the same state, matching `ts_roles.status = 'open'`. HQ's wording is more accurate to the schema. Don't fix.

### 6. Inter font sizes

Source body is 17px / line-height 1.5. Phase 3.5b sets HQ body to the same. But individual HQ pages use Tailwind's text-sm (14px) / text-xs (12px) heavily for compact dashboards, while source uses some explicit pixel sizes (text-[11px], text-[13px]) for pills and labels. The two apps will read at slightly different sizes in spots. Not a brand drift; a sizing-philosophy difference. Don't fix.

### 7. Source's button heights

Source `.btn-base` is `h-[42px] px-6` with 13px bold uppercase. Most HQ buttons go through shadcn's `Button` component with default height 40px (`h-10`) and standard sentence-case labels. The visual difference: source buttons are slightly taller and read as ALL-CAPS BRAND BUTTONS; HQ's are shorter and sentence-case.

This is a deliberate look. If you want HQ to fully match, the Phase X work would be: replace `<Button variant="default">` usage in talent-scout pages with the new `.btn-primary` utility class. That's a real component refactor, not a token swap. Keep for a later pass.

### 8. Source uses `.input-base` (44px / 4px radius / surface-alt bg / primary-focused border)

HQ inputs go through shadcn's `Input` component (40px / 6px radius / different focus styles). Same trade-off as #7. Out of scope for 3.5b.
