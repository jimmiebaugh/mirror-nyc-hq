import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Shared lookup-table hook for the Phase 5.2.2 inline-add affordance
 * (spec § 6.C). Returns the option list plus an `addOption(name)` that
 * inserts a row, refreshes local state, and resolves to the new id so the
 * caller can immediately select it.
 *
 * Phase 5.6.3.1 — shared module-level cache. Previously, every call site
 * of `useLookup("vendor_categories")` got its own React state. When
 * RecordCombobox's inline-add ran addOption inside its own useLookup
 * instance, the parent page's instance never saw the new option until a
 * page refresh. Now all instances of useLookup for the same `(table,
 * parentScopeId)` key share a cache + subscriber set; addOption updates
 * the cache once and every mounted instance re-renders.
 *
 * The shipped lookups: `cities`, `project_categories`,
 * `vendor_capabilities`, `vendor_categories`, `vendor_subcategories`,
 * `venue_types`, `departments`. All share the same shape (id uuid, name
 * text, created_by uuid, created_at) and the same open-authenticated
 * SELECT/INSERT RLS posture.
 *
 * Names are unique case-insensitively at the DB level (`LOWER(name)`
 * unique index); the hook surfaces the unique-violation error so the
 * caller can show a "name already exists" toast.
 */

export type LookupTable =
  | "cities"
  | "neighborhoods"
  | "project_categories"
  | "project_tags"
  | "vendor_capabilities"
  | "vendor_categories"
  | "vendor_subcategories"
  | "venue_features"
  | "venue_types"
  | "departments";

export type LookupOption = { id: string; name: string };

/**
 * Phase 5.12.9: per-table parent-column map for parent-scoped lookups.
 * `useLookup` filters SELECT + writes the FK on INSERT using this column
 * when `parentScopeId` is set. Tables not listed here fall back to
 * `parent_category_id` (the historical default for `vendor_subcategories`,
 * pre-5.12.9 hardcoded behavior).
 */
const PARENT_COLUMN_BY_TABLE: Partial<Record<LookupTable, string>> = {
  vendor_subcategories: "parent_category_id",
  neighborhoods: "city_id",
};

function parentColumnFor(table: LookupTable): string {
  return PARENT_COLUMN_BY_TABLE[table] ?? "parent_category_id";
}

type CacheEntry = {
  options: LookupOption[] | null;
  loading: boolean;
  loadPromise: Promise<void> | null;
  subscribers: Set<(options: LookupOption[], loading: boolean) => void>;
};

const cache = new Map<string, CacheEntry>();

function cacheKey(table: LookupTable, parentScopeId: string | null): string {
  return `${table}:${parentScopeId ?? ""}`;
}

function getEntry(key: string): CacheEntry {
  let entry = cache.get(key);
  if (!entry) {
    entry = { options: null, loading: false, loadPromise: null, subscribers: new Set() };
    cache.set(key, entry);
  }
  return entry;
}

function notify(key: string) {
  const entry = cache.get(key);
  if (!entry) return;
  for (const sub of entry.subscribers) {
    sub(entry.options ?? [], entry.loading);
  }
}

async function ensureLoaded(
  table: LookupTable,
  parentScopeId: string | null,
  key: string,
) {
  const entry = getEntry(key);
  if (entry.options !== null || entry.loadPromise) return entry.loadPromise ?? Promise.resolve();
  // Phase 5.12.9: parent-scoped lookups (neighborhoods, vendor_subcategories)
  // must NOT load all rows unscoped when the parent isn't set. Consumers
  // typically render disabled until the parent resolves; an unscoped
  // `select id, name from <table>` would pull every neighborhood across
  // every city (or every subcategory across every category) before the
  // picker is even interactive. Short-circuit to an empty option list;
  // the cache key includes the (null) parent so a later real
  // parentScopeId creates its own cache entry that loads normally.
  if (table in PARENT_COLUMN_BY_TABLE && !parentScopeId) {
    entry.options = [];
    notify(key);
    return Promise.resolve();
  }
  entry.loading = true;
  notify(key);
  entry.loadPromise = (async () => {
    let q = supabase
      .from(table)
      .select("id, name")
      .order("name", { ascending: true });
    if (parentScopeId) {
      q = q.eq(parentColumnFor(table), parentScopeId);
    }
    const { data, error } = await q;
    if (error) {
      console.warn(`${table} load failed`, error);
      entry.options = [];
    } else {
      entry.options = (data ?? []) as LookupOption[];
    }
    entry.loading = false;
    entry.loadPromise = null;
    notify(key);
  })();
  return entry.loadPromise;
}

/**
 * `parentScopeId` (Phase 5.6.2; Phase 5.12.9): when set, the hook filters
 * options by the parent column resolved via `PARENT_COLUMN_BY_TABLE` and
 * writes that column on INSERT. Parent-scoped tables today:
 *   - `vendor_subcategories` -> `parent_category_id` (parent: vendor_categories)
 *   - `neighborhoods`        -> `city_id`            (parent: cities)
 * Passing `parentScopeId` against a non-parent-scoped table is a no-op
 * load but will fail at insert time (no such column).
 */
/**
 * Sync accessor over the shared cache (Phase 5.6.3.1 round 3). Use when
 * a parent's `useLookup(...)` snapshot is stale because the React state
 * update hasn't propagated yet — typically inside an `onChange` callback
 * that fires immediately after `addOption` runs (inline-add). The cache
 * is mutated synchronously inside `addOption` before the subscriber
 * notify fires, so reading it directly resolves the new id by name in
 * the same tick.
 *
 * Returns the latest known options (may be `[]` if no instance has
 * loaded the table yet).
 */
export function getLookupCached(
  table: LookupTable,
  parentScopeId: string | null = null,
): LookupOption[] {
  return cache.get(cacheKey(table, parentScopeId))?.options ?? [];
}

/**
 * Drop cached options so the next read refetches. The cache otherwise never
 * refetches once populated (see `ensureLoaded`), so a row created OUTSIDE the
 * `addOption` path — e.g. a `vendor_categories` / `cities` row a bulk-import
 * RPC creates server-side — would stay invisible to every `useLookup`
 * consumer until a full page reload. Call this on the import success path.
 *
 *   - `invalidateLookup()`            -> clear every cached table + scope
 *   - `invalidateLookup(table)`       -> clear every scope of one table
 *   - `invalidateLookup(table, scope)`-> clear one (table, scope) entry
 *
 * Live `useLookup` instances (mounted subscribers) are refetched immediately;
 * dormant entries simply refetch on their next mount.
 */
export function invalidateLookup(
  table?: LookupTable,
  parentScopeId?: string | null,
): void {
  for (const key of [...cache.keys()]) {
    const matches = !table
      ? true
      : parentScopeId !== undefined
        ? key === cacheKey(table, parentScopeId)
        : key === `${table}:` || key.startsWith(`${table}:`);
    if (!matches) continue;
    const entry = cache.get(key);
    if (!entry) continue;
    entry.options = null;
    entry.loadPromise = null;
    if (entry.subscribers.size > 0) {
      const sepIdx = key.indexOf(":");
      const t = key.slice(0, sepIdx) as LookupTable;
      const scope = key.slice(sepIdx + 1) || null;
      void ensureLoaded(t, scope, key);
    }
  }
}

/**
 * Phase 5.12.2: city aliases hook. Loads the `city_aliases` table once
 * and resolves each row to `{ alias, canonical }` against the cities
 * lookup. Used exclusively by RecordCombobox's LookupCombobox when
 * `source.table === 'cities'` to surface alias rows in the typeahead
 * (typing "Los Angeles" matches the alias row whose canonical city is
 * "LA"). Module-level cache like `useLookup`, loaded once per session.
 *
 * The alias resolution is intentionally NOT folded into useLookup
 * because alias rows have a different shape (one canonical id per
 * multiple aliases) and shouldn't pollute the addOption flow used by
 * every other lookup picker. Aliases are read-only from the picker;
 * admin curation belongs in a future Settings -> Lookup Lists card.
 */
export type CityAliasOption = { alias: string; canonical: string };

type CityAliasCache = {
  options: CityAliasOption[] | null;
  loading: boolean;
  loadPromise: Promise<void> | null;
  subscribers: Set<(options: CityAliasOption[], loading: boolean) => void>;
};

const aliasCache: CityAliasCache = {
  options: null,
  loading: false,
  loadPromise: null,
  subscribers: new Set(),
};

function notifyAliases() {
  for (const sub of aliasCache.subscribers) {
    sub(aliasCache.options ?? [], aliasCache.loading);
  }
}

async function ensureAliasesLoaded(): Promise<void> {
  if (aliasCache.options !== null || aliasCache.loadPromise) {
    return aliasCache.loadPromise ?? Promise.resolve();
  }
  aliasCache.loading = true;
  notifyAliases();
  aliasCache.loadPromise = (async () => {
    const { data, error } = await supabase
      .from("city_aliases")
      .select("alias, cities!inner(name)")
      .order("alias", { ascending: true });
    if (error) {
      console.warn("city_aliases load failed", error);
      aliasCache.options = [];
    } else {
      aliasCache.options = (data ?? [])
        .map((row) => {
          const linked = (row as { cities?: { name?: string } }).cities;
          const alias = (row as { alias?: string }).alias ?? "";
          if (!alias || !linked?.name) return null;
          return { alias, canonical: linked.name };
        })
        .filter((x): x is CityAliasOption => x !== null);
    }
    aliasCache.loading = false;
    aliasCache.loadPromise = null;
    notifyAliases();
  })();
  return aliasCache.loadPromise;
}

export function useCityAliases() {
  const [snapshot, setSnapshot] = useState<{
    options: CityAliasOption[];
    loading: boolean;
  }>(() => ({
    options: aliasCache.options ?? [],
    loading: aliasCache.options === null,
  }));

  useEffect(() => {
    setSnapshot({
      options: aliasCache.options ?? [],
      loading: aliasCache.options === null,
    });
    const sub = (options: CityAliasOption[], loading: boolean) => {
      setSnapshot({ options, loading });
    };
    aliasCache.subscribers.add(sub);
    void ensureAliasesLoaded();
    return () => {
      aliasCache.subscribers.delete(sub);
    };
  }, []);

  return { options: snapshot.options, loading: snapshot.loading };
}

export function useLookup(
  table: LookupTable,
  opts?: { parentScopeId?: string | null },
) {
  const parentScopeId = opts?.parentScopeId ?? null;
  const key = cacheKey(table, parentScopeId);
  const [snapshot, setSnapshot] = useState<{ options: LookupOption[]; loading: boolean }>(
    () => {
      const entry = cache.get(key);
      return {
        options: entry?.options ?? [],
        loading: entry?.options === null,
      };
    },
  );

  useEffect(() => {
    const entry = getEntry(key);
    // Re-sync local snapshot to whatever the cache has right now (covers
    // remounts where the cache is already populated).
    setSnapshot({ options: entry.options ?? [], loading: entry.options === null });
    const sub = (options: LookupOption[], loading: boolean) => {
      setSnapshot({ options, loading });
    };
    entry.subscribers.add(sub);
    void ensureLoaded(table, parentScopeId, key);
    return () => {
      entry.subscribers.delete(sub);
    };
  }, [table, parentScopeId, key]);

  const addOption = useCallback(
    async (name: string): Promise<LookupOption | null> => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const { data: userRes } = await supabase.auth.getUser();
      const created_by = userRes.user?.id;
      if (!created_by) return null;

      // venue_types doesn't carry created_by in its shipped schema.
      const basePayload: Record<string, unknown> =
        table === "venue_types"
          ? { name: trimmed }
          : { name: trimmed, created_by };
      const insertPayload: Record<string, unknown> = parentScopeId
        ? { ...basePayload, [parentColumnFor(table)]: parentScopeId }
        : basePayload;

      const { data, error } = await supabase
        .from(table)
        .insert(insertPayload as never)
        .select("id, name")
        .single();
      if (error || !data) {
        console.warn(`${table} insert failed`, error);
        return null;
      }
      const next = data as LookupOption;
      // Mutate the shared cache + notify every subscriber so any parent
      // component using useLookup(table) sees the new option immediately
      // (no page-refresh needed to resolve the new id by name).
      const entry = getEntry(key);
      const merged = [...(entry.options ?? []), next].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      entry.options = merged;
      notify(key);
      return next;
    },
    [table, parentScopeId, key],
  );

  return { options: snapshot.options, loading: snapshot.loading, addOption };
}

/**
 * Phase 5.12.9: resolve a free-text city name to the canonical
 * `cities.id`. Used by every consumer that scopes a neighborhoods picker
 * to a city (VenueEdit, VenueDetail, BriefVenue, BriefReport, Review,
 * SourcingReport, Shortlist, DeckPrep). Case-insensitive trim match
 * against the loaded `cities` options. Returns `null` for blank input,
 * unloaded options, or no-match (consumer keeps the picker disabled until
 * a canonical city is selected).
 *
 * City aliases (Phase 5.12.2) are NOT consulted here. In practice the
 * stored city value is always a canonical lookup name because every
 * consumer's City field is itself a `RecordCombobox` over the cities
 * lookup. If real alias coverage is needed later, fold `useCityAliases`
 * resolution in here.
 */
export function useCityIdForName(cityName: string | null): string | null {
  const { options } = useLookup("cities");
  if (!cityName || !cityName.trim()) return null;
  const target = cityName.trim().toLowerCase();
  const match = options.find((o) => o.name.trim().toLowerCase() === target);
  return match?.id ?? null;
}
