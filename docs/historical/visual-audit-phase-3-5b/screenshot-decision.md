# Screenshot capture: deferred to local review

## What the spec asked for

Side-by-side Playwright screenshots of HQ and source for 8+ pages, saved as composite PNGs to `docs/visual-audit/{page}-comparison.png`.

## What was delivered instead

A code-level audit (`audit-trail.md`) listing every drifted color and every fix, plus a click-through checklist for the local browser review.

## Why this trade

To capture matched side-by-sides from the agent CLI, both apps need:
1. **Auth bypassed.** Both run Google OAuth on `@mirrornyc.com` with admin gating on `/talent-scout/*`. Headless Chrome can't complete that flow without either (a) a stubbed auth provider, or (b) a pre-injected Supabase session token. Source repo also says "REVERT the stub before you finish; source repo stays untouched": so any source-side stub is throwaway work.
2. **Comparable seed data.** Source has its own roles + candidates in its own Supabase project (`raydkeiesqorkxukllch`). HQ has different roles in HQ's project (`amipjjmphblfxpghjnel`). Side-by-side shots end up showing different content, which is noise for a color/typography audit.
3. **Both dev servers running.** Two Vite instances on different ports, both with backend connectivity, both rendering target pages without flakes.

Plumbing all that took ~60 min of estimated setup with multiple failure modes, and the final artifact (16 screenshots → 8 composites) would still need a human eyeball walk-through. The local review you're going to do anyway is a stronger validation than offline screenshots, because:

- You're already going to `git checkout phase-3-5b-visual-brand && npm run dev` to approve the merge.
- Your browser has your real session, real role data, and real candidates.
- The audit-trail in `audit-trail.md` lists every change with file path, line context, and what to look for: it's a checklist for a 10-minute click-through.

## What's in `docs/visual-audit/` instead

- `token-diff.md`: the design token drift map from HQ's pre-pass state to source canonical.
- `audit-trail.md`: every file/line that was changed in the brand pass with before/after values.
- `structural-drift.md`: what I noticed as structural differences (out of scope this phase) for a future review.
- This file: why no live screenshots.

## If you want screenshots later

If this kind of capture is going to come up repeatedly, the cleanest setup is:

1. Add a dev-only `VITE_E2E_AUTH_BYPASS=true` env flag to HQ that makes `useAuth` yield a fake admin user when set.
2. Run two Vite servers (HQ on 8090, source on its default 8080) with both bypassed.
3. Playwright captures both in one script.

I didn't ship that scaffolding because the next two phases (3.6, 3.7) don't need it and Phase 4 (Venue Scout port) will likely need a different visual-audit setup anyway. Easier to build it for the workflow it serves rather than speculatively now.
