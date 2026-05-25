#!/usr/bin/env bash
# .claude/hooks/block_dangerous.sh
#
# PreToolUse hook for the Bash tool. Reads a JSON payload on stdin with
# .tool_input.command and blocks the call (exit 2) if the command matches
# a dangerous pattern. Exit 2 sends the error message back to Claude as
# feedback so it can course-correct.
#
# Patterns are conservative — only block things that are unambiguously
# destructive or that violate the HQ deploy policy. Anything ambiguous
# should pass through and rely on Jimmie / the harness sandbox to catch.
#
# IMPORTANT: patterns are matched against STATEMENT START positions only —
# i.e. the very beginning of the command, or right after a shell separator
# (&&, ||, ;, newline). This avoids false-positives where a heredoc body
# (e.g. a commit message) contains text that LOOKS like a dangerous command
# but is actually documentation. The cost is that some genuinely-bad
# commands hidden inside heredoc-like structures could slip through, but
# those are rare and the harness sandbox is an additional layer.

set -e

input=$(cat)

# Extract tool_input.command. Use python3 because jq isn't guaranteed.
command=$(printf '%s' "$input" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('tool_input', {}).get('command', ''))
except Exception:
    print('')
" 2>/dev/null || echo "")

# Empty command → nothing to check.
if [ -z "$command" ]; then
  exit 0
fi

block() {
  local label="$1"
  local fix_hint="$2"
  echo "Blocked by .claude/hooks/block_dangerous.sh: $label" >&2
  echo "Hint: $fix_hint" >&2
  echo "If this is intentional, run it manually outside Claude or update the blocklist." >&2
  exit 2
}

# Helper: check whether the command contains a pattern at a STATEMENT START
# position. Splits the command on shell separators (&&, ||, ;) and newlines,
# trims leading whitespace from each fragment, then matches the pattern
# against the start of each fragment. This means patterns must appear at
# the actual command boundary, not inside heredoc / quoted bodies.
matches_at_start() {
  local pattern="$1"
  # Split on &&, ||, ;, newline. Replace each with a single newline, then
  # trim leading whitespace per line.
  printf '%s' "$command" \
    | sed -E 's/(&&|\|\||;)/\n/g' \
    | sed -E 's/^[[:space:]]+//' \
    | grep -qE "^$pattern" && return 0
  return 1
}

# NOTE: force-push to main intentionally NOT in this blocklist. The harness
# sandbox catches it as a destructive action requiring explicit user
# confirmation, and grep-based pattern matching across heredoc bodies that
# contain documentation strings ("git push --force") false-positives too
# easily. Hook focuses on patterns the harness doesn't already catch.

# 1. rm -rf with a TRULY catastrophic target: literal /, /*, or bare * at the
# end of the rm clause. Specific paths under / (rm -rf /tmp/junk, rm -rf
# /Users/foo/build, rm -rf node_modules) are allowed.
if matches_at_start 'rm[[:space:]]+(-[rRfF]+[[:space:]]+|-r[[:space:]]+-f[[:space:]]+|-f[[:space:]]+-r[[:space:]]+)(/|/\*|\*)([[:space:]]|$)'; then
  block "rm -rf at filesystem root or with bare wildcard" \
    "Targets like /, /*, or bare * are blocked. Specific paths (rm -rf node_modules/, rm -rf /tmp/junk) are fine."
fi

# 2. supabase db reset — wipes the local DB.
if matches_at_start 'supabase[[:space:]]+db[[:space:]]+reset'; then
  block "supabase db reset" \
    "This wipes the local DB. Confirm with Jimmie before running."
fi

# 3. Direct supabase secrets set on INTERNAL_API_SECRET without paired vault update.
# Rotation requires BOTH (1) supabase secrets set AND (2) vault.update_secret.
# Setting only the function secret leaves the cron path 401'ing until vault syncs.
if matches_at_start 'supabase[[:space:]]+secrets[[:space:]]+set[[:space:]]+INTERNAL_API_SECRET'; then
  block "supabase secrets set INTERNAL_API_SECRET (without vault sync)" \
    "Rotating INTERNAL_API_SECRET requires updating both the Supabase function secret AND the Vault entry (vault.update_secret) in the same operation. See docs/cron-jobs.md."
fi

# 4. git push origin to a feature branch without [skip netlify] in HEAD commit.
# Catches accidental origin pushes that would fire deploy previews. The squash-merge
# to main is the only sanctioned Netlify-deploy event per phase (CLAUDE.md item 8).
# Skip the [skip netlify] check when the push DESTINATION is main (the merge
# event itself). Matches the literal `git push origin main` AND refspec forms
# that target main from a feature branch / detached HEAD, e.g.
# `git push origin HEAD:main` or `git push origin claude/foo:main` — which is
# how a squash-merge is pushed from a worktree where main can't be checked out.
if matches_at_start 'git[[:space:]]+push[[:space:]]+origin[[:space:]]+([^[:space:]]+:)?main([[:space:]]|$)'; then
  : # Pushing to main is the merge event itself; evaluated at merge time, not here.
elif matches_at_start 'git[[:space:]]+push[[:space:]]+origin[[:space:]]+'; then
  head_msg=$(git -C "$CLAUDE_PROJECT_DIR" log -1 --format=%s 2>/dev/null || echo "")
  if ! echo "$head_msg" | grep -qF '[skip netlify]'; then
    block "git push to origin feature branch without [skip netlify] in HEAD" \
      "Per CLAUDE.md item 8, origin pushes to feature branches need [skip netlify] in the HEAD commit message. Add an empty marker commit and re-push, or wait for squash-merge."
  fi
fi

# All checks passed.
exit 0
