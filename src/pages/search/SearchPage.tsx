import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  IconActivity,
  IconClients,
  IconDeliverables,
  IconOrgs,
  IconPeople,
  IconProjects,
  IconSearch,
  IconTasks,
  IconVenues,
  IconWiki,
} from "@/components/icons/HQIcons";
import { runSearch, type SearchResultGroup, type SearchSection } from "@/lib/search/queries";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadError } from "@/components/ui/LoadError";

/**
 * Search.
 * Spec: OUTPUTS/phase-5-5-spec.md § 6.
 *
 * Reads ?q= from the URL on mount, fires runSearch immediately. The
 * page-level input (autofocus, full-width) updates the URL param via
 * setSearchParams (no full nav) and 300ms-debounces the query. TopBar
 * submit still navigates here; we observe the URL change and re-search.
 */

function IconForSection({ section }: { section: SearchSection }) {
  const style = { width: 12, height: 12 } as const;
  switch (section) {
    case "projects": return <IconProjects style={style} />;
    case "tasks": return <IconTasks style={style} />;
    case "deliverables": return <IconDeliverables style={style} />;
    case "venues": return <IconVenues style={style} />;
    case "vendors": return <IconOrgs style={style} />;
    case "clients": return <IconClients style={style} />;
    case "people": return <IconPeople style={style} />;
    case "wiki": return <IconWiki style={style} />;
    default: return <IconActivity style={style} />;
  }
}

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const [input, setInput] = useState(urlQuery);
  const [groups, setGroups] = useState<SearchResultGroup[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    urlQuery ? "loading" : "idle",
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Keep the input in sync when the URL changes (TopBar submits land here).
  useEffect(() => {
    setInput(urlQuery);
  }, [urlQuery]);

  // Run the search whenever urlQuery changes (TopBar submit OR debounced typing).
  useEffect(() => {
    if (!urlQuery.trim()) {
      setStatus("idle");
      setGroups([]);
      return;
    }
    let active = true;
    setStatus("loading");
    runSearch(urlQuery)
      .then((res) => {
        if (!active) return;
        setGroups(res);
        setStatus("ready");
      })
      .catch((err) => {
        if (!active) return;
        console.error("[Search] error:", err);
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [urlQuery]);

  // Debounced URL update on input change so we don't push history per keystroke.
  const handleInputChange = useCallback(
    (value: string) => {
      setInput(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const params = new URLSearchParams(searchParams);
        const trimmed = value.trim();
        if (trimmed) params.set("q", trimmed);
        else params.delete("q");
        setSearchParams(params, { replace: true });
      }, 300);
    },
    [searchParams, setSearchParams],
  );

  // Autofocus on mount (no query) so users landing from the rail nav can type.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const totalCount = useMemo(
    () => groups.reduce((n, g) => n + g.results.length, 0),
    [groups],
  );

  return (
    <div style={{ maxWidth: 880, margin: "0 auto" }} className="space-y-6">
      <div className="pagehead">
        <h1 className="h-page">Search</h1>
      </div>

      <div style={{ position: "relative" }}>
        <IconSearch
          style={{
            position: "absolute",
            left: 14,
            top: "50%",
            transform: "translateY(-50%)",
            width: 16,
            height: 16,
            color: "hsl(var(--subtle-foreground))",
          }}
        />
        <input
          ref={inputRef}
          className="input"
          style={{ paddingLeft: 38 }}
          placeholder="Search projects, venues, people, wiki..."
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          aria-label="Search"
        />
      </div>

      {status === "idle" ? (
        <EmptyState icon={IconSearch}>
          Search projects, venues, people, wiki, and more. Type a term above or
          use Cmd+K from anywhere.
        </EmptyState>
      ) : status === "loading" ? (
        <div className="card card-pad">
          <p className="cap" style={{ textAlign: "center", padding: 24 }}>
            Searching...
          </p>
        </div>
      ) : status === "error" ? (
        <LoadError
          title="Search failed"
          description="Could not run the query. Try again in a moment."
          onRetry={() => {
            setStatus("loading");
            runSearch(urlQuery)
              .then((res) => {
                setGroups(res);
                setStatus("ready");
              })
              .catch(() => setStatus("error"));
          }}
        />
      ) : totalCount === 0 ? (
        <EmptyState icon={IconSearch}>
          No results for &quot;{urlQuery}&quot;. Try a different search term or
          check for typos.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.section} className="space-y-2">
              <div className="label-section">{group.label}</div>
              <div className="card" style={{ padding: 0 }}>
                {group.results.map((result, i) => (
                  <Link
                    key={result.id}
                    to={result.href}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 14px",
                      borderBottom:
                        i < group.results.length - 1
                          ? "1px solid hsl(var(--border))"
                          : "none",
                      textDecoration: "none",
                    }}
                  >
                    <span
                      className="actdot"
                      style={{ width: 24, height: 24, color: "hsl(var(--subtle-foreground))" }}
                    >
                      <IconForSection section={result.section} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: "hsl(var(--primary-hover))",
                        }}
                      >
                        {result.title}
                      </div>
                      {result.subtitle ? (
                        <div
                          style={{
                            fontSize: 12,
                            color: "hsl(var(--muted-foreground))",
                            marginTop: 2,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {result.subtitle}
                        </div>
                      ) : null}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
