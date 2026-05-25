// _shared/venueDedupe.ts (Phase 5.12.3)
//
// Shared venue name / address / website normalizers + the points-based
// match ladder used to dedupe candidate venues against an existing pool.
//
// Two consumers as of 5.12.1 (unchanged in 5.12.3):
//   1. `vs-generate-deck`'s `pushVenuesToHq` (5.12.0): dedupes VS candidates
//      against the master HQ `venues` pool at Generate Deck click; INSERTs
//      new HQ rows on no-match + writes `linked_venue_id` on every candidate.
//      5.12.3: ALSO writes `dedupe_meta` jsonb alongside `linked_venue_id`
//      on FRESH ladder-resolved matches (not pre-linked, not hq_pool, not
//      fresh-INSERT no-match rows).
//   2. `vs-research-venues` Phase B cross-rail dedupe (5.12.1): drops
//      Claude's net-new picks that collide with `vs_candidate_venues` rows
//      already inserted as `source='hq_pool'` earlier in the same scout's
//      research run. No DB write here; the scoring reason rides the
//      [vs-research-venues] drop log line.
//
// Phase 5.12.3: points-based ladder. Errs toward recall over precision per
// Jimmie's locked decision (reverses the 5.12.0 errs-toward-false-negatives
// posture). Cross-field VETO preserved on name FULL match + (city differ
// OR address differ) when both sides have those fields, keeping the
// Plaza-NYC-vs-LA hard stop and the same-city same-name different-address
// hard stop.
//
// Weights (locked per spec § 8.1; do not change without a calibration
// follow-on sub-phase):
//
//   Name      60 (full equality on normalized name)
//             25 (>= 1 shared token of >= 3 chars after normalization)
//              0 (otherwise)
//   Address   50 (full equality on normalized address)
//             20 (street-number prefix match: same leading numeric token
//                 on both sides after normalization)
//              0 (otherwise)
//   Website   40 (host + path equality on normalized URL)
//             20 (host equality only)
//              0 (otherwise)
//   City     +10 (case-insensitive trim equality on both sides; ONLY
//                 counted when at least one other signal contributed >= 1
//                 so city alone cannot single-handedly cross the threshold)
//
//   Threshold 60 (>= merges; both consumers pass no options for v1 lockstep).
//
// Phase 5.12.4.1 identity-signal gate (added after Codex adversarial review):
// crossing the threshold requires the name OR website signal to contribute
// >= 1. Address + city alone (50 + 10 = 60) would otherwise merge any two
// venues at the same building address regardless of name (e.g. "Top of the
// Rock" and "Studio 8H" both at "75 Rockefeller Plaza"). Address-only
// matches with no name-or-website co-signal are not strong enough to assert
// venue identity. Same gate applies whether or not the city bonus fires;
// the gate is on identity signals, not on raw point count. Address-only +
// city-only configurations fall through to no_merge; the per-call telemetry
// log surfaces the gated score so calibration data still rides the wire.
//
// Website normalizer contract (locked per spec § 8.1; `normalizeWebsiteParts`
// is the authoritative helper):
//   1. Empty / whitespace-only input -> null.
//   2. Prepend https:// when scheme is missing so new URL() parses.
//   3. Lowercase host, strip leading "www.".
//   4. Pathname only (ignore search + hash); trim trailing slash; collapse
//      empty to "/".
//   Returns { host, path } | null. Host+path equality = 40 pts; host
//   equality only = 20 pts; either side null OR host differs = 0 pts.
//
// Asymmetric / missing signals: skip entirely. If candidate lacks a website,
// website contributes 0 (no penalty). If HQ row lacks a city, city bonus
// is unavailable. Rationale: don't punish admin-curated HQ rows for
// incomplete data.

export function normalizeVenueName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .normalize("NFKD")                              // strip diacritics
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")                         // normalize "&" + "and"
    .replace(/[.,'"!?\-_/\\()\[\]]/g, " ")          // strip common punctuation
    .replace(/^(the)\s+/i, "")                      // strip leading article
    .replace(/\s+(inc\.?|llc\.?|ltd\.?|co\.?|corp\.?|nyc|ny|nv)\s*$/i, "") // strip suffixes
    .replace(/\s+/g, " ")                           // collapse whitespace
    .trim();
}

export function normalizeAddress(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,'"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Phase 5.12.3 locked website normalizer contract. Returns { host, path }
// or null when raw is empty / unparseable. Path is lowercased, leading
// "www." stripped from host, query + hash ignored, trailing slash trimmed
// (root "/" preserved). Both score tiers (40 host+path, 20 host-only) derive
// from this single shape.
export function normalizeWebsiteParts(
  raw: string | null | undefined,
): { host: string; path: string } | null {
  if (!raw || !raw.trim()) return null;
  let candidate = raw.trim();
  // Prepend https:// when scheme is missing so new URL() parses.
  if (!/^https?:\/\//i.test(candidate)) candidate = "https://" + candidate;
  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  let path = u.pathname.toLowerCase();
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (path.length === 0) path = "/";
  return { host, path };
}

// Phase 5.12.3: backwards-compat wrapper. Pre-5.12.3 `normalizeWebsite`
// returned `raw.trim().toLowerCase()` (no host/path semantics). Kept as a
// one-line wrapper over the new structured normalizer so any consumer
// outside venueDedupe that imports it keeps working. Current consumers
// outside this file: zero (verified by grep on 5.12.2 tip). Safe to drop
// in a future sub-phase if no consumer appears.
export function normalizeWebsite(raw: string | null | undefined): string {
  const parts = normalizeWebsiteParts(raw);
  return parts ? parts.host + parts.path : "";
}

// Shape both candidate and pool entries must conform to. `id` is optional on
// the candidate side (Claude's research output has no id yet) but expected on
// the pool side so the caller can act on a match (write `linked_venue_id`,
// drop the candidate row, etc.).
export type DedupeCandidate = {
  name?: string | null;
  address?: string | null;
  city?: string | null;
  website_url?: string | null;
};

export type DedupeScoreBreakdown = {
  name: number;       // 0 | 25 | 60
  address: number;    // 0 | 20 | 50
  website: number;    // 0 | 20 | 40
  city: number;       // 0 | 10
  total: number;
  threshold: number;
};

export type DedupeMatchResult<T> = {
  match: T;
  score: DedupeScoreBreakdown;
  reason: string;     // "name partial match (25) + address (50) + city (10) = 85 / 60"
};

const DEFAULT_THRESHOLD = 60;
const NAME_TOKEN_MIN_LEN = 3;

function tokenizeName(norm: string): string[] {
  if (!norm) return [];
  return norm.split(/\s+/).filter((t) => t.length >= NAME_TOKEN_MIN_LEN);
}

function scoreNameMatch(candNorm: string, poolNorm: string): number {
  if (!candNorm || !poolNorm) return 0;
  if (candNorm === poolNorm) return 60;
  const candTokens = new Set(tokenizeName(candNorm));
  if (candTokens.size === 0) return 0;
  const poolTokens = tokenizeName(poolNorm);
  for (const t of poolTokens) {
    if (candTokens.has(t)) return 25;
  }
  return 0;
}

function extractStreetNumber(addrNorm: string): string | null {
  if (!addrNorm) return null;
  const first = addrNorm.split(/\s+/)[0] ?? "";
  return /^\d+$/.test(first) ? first : null;
}

function scoreAddressMatch(candNorm: string, poolNorm: string): number {
  if (!candNorm || !poolNorm) return 0;
  if (candNorm === poolNorm) return 50;
  const candNum = extractStreetNumber(candNorm);
  const poolNum = extractStreetNumber(poolNorm);
  if (candNum && poolNum && candNum === poolNum) return 20;
  return 0;
}

function scoreWebsiteMatch(
  candParts: { host: string; path: string } | null,
  poolParts: { host: string; path: string } | null,
): number {
  if (!candParts || !poolParts) return 0;
  if (candParts.host !== poolParts.host) return 0;
  return candParts.path === poolParts.path ? 40 : 20;
}

function cityEquals(
  candCity: string | null | undefined,
  poolCity: string | null | undefined,
): boolean {
  const c = (candCity ?? "").toLowerCase().trim();
  const p = (poolCity ?? "").toLowerCase().trim();
  if (!c || !p) return false;
  return c === p;
}

// Build the human-readable "merged because" string consumed by the
// [vs-research-venues] drop log line (DedupeMetaIndicator UI consumer
// retired in Phase 5.12.14.2; jsonb write path preserved for future
// re-consumer). Mirrors spec § 8.1 example: "name partial match (25) +
// address (50) + city (10) = 85 / 60".
function buildReason(score: DedupeScoreBreakdown): string {
  const parts: string[] = [];
  if (score.name === 60) parts.push(`name full match (60)`);
  else if (score.name === 25) parts.push(`name partial match (25)`);
  if (score.address === 50) parts.push(`address (50)`);
  else if (score.address === 20) parts.push(`address street-number (20)`);
  if (score.website === 40) parts.push(`website (40)`);
  else if (score.website === 20) parts.push(`website host (20)`);
  if (score.city === 10) parts.push(`city (10)`);
  const left = parts.length > 0 ? parts.join(" + ") : `no signals`;
  return `${left} = ${score.total} / ${score.threshold}`;
}

/**
 * Run the points-based ladder against every pool entry, apply the cross-
 * field VETO (name FULL match + (city differ OR address differ) when both
 * sides carry those fields), and return the highest-scoring entry whose
 * total meets or exceeds the threshold. Deterministic tiebreaker chain:
 *
 *   1. Normalized name ascending (mirrors 5.12.1's loadHqVenuesIntoPool sort).
 *   2. Pool entry `id` ascending (string compare) when normalized names tie.
 *   3. Pool insertion order as defensive final fallback (only fires when
 *      a pool entry has no `id` at all; both current consumers always pass
 *      HQ venues.id-bearing rows).
 *
 * Returns null when no pool entry clears the threshold OR pool is empty.
 *
 * Phase 5.12.3 telemetry: every call against a non-empty pool emits one
 * [venueDedupe] log line carrying the best-scorer breakdown + decision
 * so threshold tuning has real data during smoke. Suppressed on empty
 * pool to avoid log noise.
 */
export function findVenueDedupeMatch<
  T extends DedupeCandidate & { id?: string; name?: string | null },
>(
  candidate: DedupeCandidate,
  pool: readonly T[],
  options?: { threshold?: number },
): DedupeMatchResult<T> | null {
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
  if (pool.length === 0) return null;

  const candNameNorm = normalizeVenueName(candidate.name);
  const candAddrNorm = normalizeAddress(candidate.address);
  const candWebsiteParts = normalizeWebsiteParts(candidate.website_url);
  const candCity = (candidate.city ?? "").trim();

  type Scored = {
    entry: T;
    nameNorm: string;
    score: DedupeScoreBreakdown;
    vetoed: boolean;
  };

  const scored: Scored[] = pool.map((p, idx) => {
    const poolNameNorm = normalizeVenueName(p.name);
    const poolAddrNorm = normalizeAddress(p.address);
    const poolWebsiteParts = normalizeWebsiteParts(p.website_url);
    const poolCity = (p.city ?? "").trim();

    const nameScore = scoreNameMatch(candNameNorm, poolNameNorm);
    const addressScore = scoreAddressMatch(candAddrNorm, poolAddrNorm);
    const websiteScore = scoreWebsiteMatch(candWebsiteParts, poolWebsiteParts);

    // Cross-field VETO (preserved from 5.12.0 fully): name FULL match
    // against this pool entry is hard-vetoed when EITHER cities differ OR
    // addresses differ (both sides must have the relevant field).
    let vetoed = false;
    if (nameScore === 60) {
      const cBoth = !!candCity && !!poolCity;
      const aBoth = !!candAddrNorm && !!poolAddrNorm;
      const cityDiffer = cBoth && !cityEquals(candCity, poolCity);
      const addrDiffer = aBoth && candAddrNorm !== poolAddrNorm;
      if (cityDiffer || addrDiffer) vetoed = true;
    }

    // City bonus is conditional on at least one other signal contributing
    // >= 1. Without that gate "every venue in city X merges to every
    // other venue in city X."
    const otherSignalHit =
      nameScore >= 1 || addressScore >= 1 || websiteScore >= 1;
    const cityScore =
      otherSignalHit && cityEquals(candCity, poolCity) ? 10 : 0;

    const total = nameScore + addressScore + websiteScore + cityScore;
    const score: DedupeScoreBreakdown = {
      name: nameScore,
      address: addressScore,
      website: websiteScore,
      city: cityScore,
      total,
      threshold,
    };
    // Track original insertion order via the array map's idx implicitly
    // (Array methods preserve order; idx unused below because we sort by
    // explicit tiebreakers, but kept here as a comment for future readers).
    void idx;
    return { entry: p, nameNorm: poolNameNorm, score, vetoed };
  });

  // Pick the best non-vetoed scorer that meets the threshold AND clears the
  // Phase 5.12.4.1 identity-signal gate. Sort by the tiebreaker chain so a
  // tie at the same total resolves deterministically across reruns even
  // when the DB SELECT order shifts.
  //
  // Identity-signal gate: address + city alone (50 + 10 = 60) is not strong
  // enough to assert venue identity (two distinct venues at the same
  // building address with the same city would merge). The name OR website
  // signal must contribute >= 1. Codex adversarial review surfaced the gap;
  // gate applies to ALL pool entries before the threshold check.
  const eligible = scored.filter(
    (s) =>
      !s.vetoed &&
      s.score.total >= threshold &&
      (s.score.name >= 1 || s.score.website >= 1),
  );
  eligible.sort((a, b) => {
    // Highest total first.
    if (b.score.total !== a.score.total) return b.score.total - a.score.total;
    // Then normalized name ascending.
    const nameCmp = a.nameNorm.localeCompare(b.nameNorm);
    if (nameCmp !== 0) return nameCmp;
    // Then id ascending (lexicographic; defensive on missing id).
    const aId = a.entry.id ?? "";
    const bId = b.entry.id ?? "";
    if (aId !== bId) return aId < bId ? -1 : 1;
    return 0;
  });

  const best = eligible[0] ?? null;

  // Telemetry: log the BEST candidate considered (winner if any cleared
  // threshold; otherwise the highest non-vetoed scorer for calibration
  // visibility). Vetoes never appear as "best" because they shouldn't
  // be advertised as the closest miss.
  const nonVetoedSorted = [...scored]
    .filter((s) => !s.vetoed)
    .sort((a, b) => b.score.total - a.score.total);
  const telemetryBest = best ?? nonVetoedSorted[0] ?? null;
  if (telemetryBest) {
    // Phase 5.12.4.1: when telemetry best clears threshold but fails the
    // identity-signal gate (name = 0 AND website = 0), surface the gate
    // failure in the decision string so smoke logs make the rejection
    // reason obvious. Falls back to merge/no_merge for the common cases.
    const gateFailed =
      best === null &&
      telemetryBest.score.total >= threshold &&
      telemetryBest.score.name < 1 &&
      telemetryBest.score.website < 1;
    const decision = best
      ? "merge"
      : gateFailed
        ? "no_merge_identity_gate"
        : "no_merge";
    console.log(
      `[venueDedupe] candidate="${candidate.name ?? ""}" ` +
        `best="${telemetryBest.entry.name ?? ""}" ` +
        `score=name:${telemetryBest.score.name}+address:${telemetryBest.score.address}` +
        `+website:${telemetryBest.score.website}+city:${telemetryBest.score.city}` +
        `=${telemetryBest.score.total} ` +
        `threshold=${threshold} ` +
        `decision=${decision}`,
    );
  }

  if (!best) return null;
  return {
    match: best.entry,
    score: best.score,
    reason: buildReason(best.score),
  };
}
