import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { unwrapSecurityWrapper } from "@/lib/unwrapUrl";
import { ScoreInline } from "@/components/talent-scout/ScoreInline";
import { StatusDropdown, statusStyle } from "@/components/talent-scout/StatusDropdown";
import type { Database } from "@/integrations/supabase/types";

export type CandidateRow = Database["public"]["Tables"]["ts_candidates"]["Row"];
type Status = CandidateRow["status"];

const REJECTED_STATUSES = new Set<Status>(["reject", "auto_rejected"]);

type SortKey = "score" | "name" | "applied";
type SortDir = "asc" | "desc";

// Status is always the primary sort. Within active tier: Interview > Fast-Track > Consider.
// Within rejected tier: Reject > Auto-Rejected. The user's selectable column is secondary.
const STATUS_PRIORITY: Record<string, number> = {
  interview: 1,
  fast_track: 2,
  consider: 3,
  reject: 1,
  auto_rejected: 2,
};

function compareBy(key: SortKey, dir: SortDir) {
  const mul = dir === "asc" ? 1 : -1;
  return (a: CandidateRow, b: CandidateRow) => {
    // Status priority always primary.
    const pa = STATUS_PRIORITY[a.status] ?? 99;
    const pb = STATUS_PRIORITY[b.status] ?? 99;
    if (pa !== pb) return pa - pb;
    // User-chosen column secondary.
    let av: number | string;
    let bv: number | string;
    switch (key) {
      case "score":
        av = a.score == null ? -Infinity : Number(a.score);
        bv = b.score == null ? -Infinity : Number(b.score);
        break;
      case "name":
        av = (a.name ?? "").toLowerCase();
        bv = (b.name ?? "").toLowerCase();
        break;
      case "applied":
        av = a.applied_date ? new Date(a.applied_date).getTime() : 0;
        bv = b.applied_date ? new Date(b.applied_date).getTime() : 0;
        break;
    }
    if (av < bv) return -1 * mul;
    if (av > bv) return 1 * mul;
    return 0;
  };
}

// Phase 3.6.11: another +15px breathing room between Portfolio and Quick
// Overview. R+P cell 170 → 185, with pr-[25px] inside (was 10).
const GRID_COLS =
  "grid-cols-[minmax(260px,1fr)_185px_minmax(0,2.4fr)_132px_36px]";

function SortHeader({
  label,
  column,
  active,
  dir,
  onClick,
}: {
  label: string;
  column: SortKey;
  active: SortKey;
  dir: SortDir;
  onClick: (col: SortKey) => void;
}) {
  const isActive = active === column;
  const Icon = isActive ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <button
      type="button"
      onClick={() => onClick(column)}
      className={cn(
        "inline-flex items-center gap-1.5 text-left",
        isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      <Icon className="h-3 w-3" />
    </button>
  );
}

function RowCheckbox({
  checked,
  onClick,
  ariaLabel,
}: {
  checked: boolean;
  onClick: (e: React.MouseEvent) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={checked}
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background hover:border-foreground/50",
      )}
    >
      {checked && <Check className="h-3 w-3" strokeWidth={3} />}
    </button>
  );
}

// Phase 3.6.8: icon-button bg lifted off the row tint via surface-raised
// + stronger border so the buttons read as clearly clickable affordances
// against the column-tint diagnostic AND the final dark-on-dark layout.
const ICON_BUTTON_CLS =
  "inline-flex h-9 w-9 items-center justify-center rounded-sm border border-border-strong bg-surface-raised text-foreground hover:bg-accent hover:border-foreground transition-colors";

function PortfolioCell({ c, onPathOpen }: { c: CandidateRow; onPathOpen: (path: string) => void }) {
  if (c.portfolio_type === "file" && c.portfolio_path_or_url) {
    const path = c.portfolio_path_or_url;
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onPathOpen(path);
        }}
        title={path.split("/").pop() ?? "Portfolio (file)"}
        className={ICON_BUTTON_CLS}
      >
        <FileText className="h-4 w-4" />
      </button>
    );
  }
  if (c.portfolio_type === "url" && c.portfolio_path_or_url) {
    const unwrapped = unwrapSecurityWrapper(c.portfolio_path_or_url);
    return (
      <a
        href={unwrapped}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        title={unwrapped}
        className={ICON_BUTTON_CLS}
      >
        <ExternalLink className="h-4 w-4" />
      </a>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

async function openSignedFile(path: string) {
  const { data, error } = await supabase.storage
    .from("candidate_attachments")
    .createSignedUrl(path, 60);
  if (error || !data?.signedUrl) {
    toast({
      title: "Couldn't open file",
      description: error?.message ?? "no URL returned",
      variant: "destructive",
    });
    return;
  }
  window.open(data.signedUrl, "_blank", "noopener");
}

export function CandidateTable({
  candidates,
  emptyMessage = "No candidates yet.",
  onChanged,
  search,
  onSearchChange,
  searchPlaceholder = "Search candidates by name, email, location…",
}: {
  candidates: CandidateRow[];
  emptyMessage?: string;
  onChanged?: () => void | Promise<void>;
  /** Phase 3.6.7: when both provided, the search input renders inside the
      bulk-action bar's left side. Parents that pass these stop rendering
      their own CandidateSearch above the table. */
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
}) {
  const nav = useNavigate();
  const { user } = useAuth();
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [rejectedOpen, setRejectedOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const lastClickedId = useRef<string | null>(null);

  // Resume path per candidate. Bulk-fetched once whenever the candidates
  // list identity changes; rows just look up the path. The Resume cell
  // creates a signed URL on click (lazy — TTLs are short, ~1 min).
  const [resumePathByCand, setResumePathByCand] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    const ids = candidates.map((c) => c.id);
    if (ids.length === 0) { setResumePathByCand({}); return; }
    (async () => {
      const { data } = await supabase
        .from("ts_candidate_attachments")
        .select("candidate_id,attachment_type,file_name,file_path")
        .in("candidate_id", ids);
      if (!active) return;
      const map: Record<string, string> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data ?? []).forEach((a: any) => {
        if (map[a.candidate_id]) return;
        if (a.attachment_type === "resume" || /resume|cv/i.test(a.file_name ?? "")) {
          map[a.candidate_id] = a.file_path;
        }
      });
      setResumePathByCand(map);
    })();
    return () => { active = false; };
  }, [candidates]);

  const onSort = (col: SortKey) => {
    if (sortKey === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col);
      setSortDir(col === "name" ? "asc" : "desc");
    }
  };

  const { active, rejected } = useMemo(() => {
    const cmp = compareBy(sortKey, sortDir);
    const a: CandidateRow[] = [];
    const r: CandidateRow[] = [];
    for (const c of candidates) (REJECTED_STATUSES.has(c.status) ? r : a).push(c);
    a.sort(cmp);
    r.sort(cmp);
    return { active: a, rejected: r };
  }, [candidates, sortKey, sortDir]);

  const visibleIds = useMemo(() => {
    const ids = active.map((c) => c.id);
    if (rejectedOpen) for (const c of rejected) ids.push(c.id);
    return ids;
  }, [active, rejected, rejectedOpen]);

  const effectiveSelection = useMemo(() => {
    const visibleSet = new Set(visibleIds);
    const next = new Set<string>();
    for (const id of selected) if (visibleSet.has(id)) next.add(id);
    return next;
  }, [selected, visibleIds]);

  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => effectiveSelection.has(id));
  const someVisibleSelected = visibleIds.some((id) => effectiveSelection.has(id)) && !allVisibleSelected;

  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) for (const id of visibleIds) next.delete(id);
      else for (const id of visibleIds) next.add(id);
      return next;
    });
    lastClickedId.current = null;
  };

  const handleRowToggle = (id: string, shift: boolean) => {
    if (shift && lastClickedId.current && lastClickedId.current !== id) {
      const startIdx = visibleIds.indexOf(lastClickedId.current);
      const endIdx = visibleIds.indexOf(id);
      if (startIdx !== -1 && endIdx !== -1) {
        const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        const range = visibleIds.slice(from, to + 1);
        const target = !effectiveSelection.has(id);
        setSelected((prev) => {
          const next = new Set(prev);
          for (const rid of range) {
            if (target) next.add(rid);
            else next.delete(rid);
          }
          return next;
        });
        lastClickedId.current = id;
        return;
      }
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    lastClickedId.current = id;
  };

  const reevalSelected = async () => {
    const ids = Array.from(effectiveSelection);
    if (ids.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    await Promise.all(
      ids.map(async (cid) => {
        const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>(
          "ts-evaluate-candidate",
          { body: { candidate_id: cid, triggered_by_user_id: user?.id ?? null } },
        );
        if (error || data?.error) fail++;
        else ok++;
      }),
    );
    setBulkBusy(false);
    if (fail === 0) {
      toast({ title: "Re-evaluation complete", description: `${ok} candidate${ok === 1 ? "" : "s"} re-evaluated.` });
    } else {
      toast({
        title: "Re-evaluation finished with errors",
        description: `${ok} succeeded · ${fail} failed.`,
        variant: fail === ids.length ? "destructive" : "default",
      });
    }
    setSelected(new Set());
    await onChanged?.();
  };

  const setStatusBulk = async (status: Exclude<Status, "auto_rejected">) => {
    const ids = Array.from(effectiveSelection);
    if (ids.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    const { error } = await supabase
      .from("ts_candidates")
      .update({ status })
      .in("id", ids);
    setBulkBusy(false);
    if (error) {
      toast({ title: "Status update failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Status updated",
      description: `${ids.length} candidate${ids.length === 1 ? "" : "s"} → ${status.replace("_", " ")}.`,
    });
    setSelected(new Set());
    await onChanged?.();
  };

  if (candidates.length === 0) {
    return (
      <Card className="overflow-hidden">
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">{emptyMessage}</div>
      </Card>
    );
  }

  const selCount = effectiveSelection.size;

  return (
    <Card className="overflow-hidden">
      {/* Bulk action bar — Phase 3.6.8 layout:
            [ search ─ flex grow ] [ bulk_buttons N_selected ]
          Search input always present on the left; bulk buttons + 'N
          selected' grouped together on the right (buttons immediately
          left of the count), opacity-on when selection > 0. Clear
          button removed (Jimmie's call). The right-side block reserves
          its slot via opacity rather than removing from layout, so the
          row height stays constant when selection toggles. */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-secondary/40 px-3 py-2.5">
        {/* Left: search */}
        <div className="min-w-[220px] max-w-[360px] flex-1">
          {onSearchChange ? (
            <input
              type="search"
              value={search ?? ""}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-10 w-full rounded-sm border border-border bg-background px-3 text-[13px] outline-none placeholder:text-muted-foreground focus:border-primary"
            />
          ) : null}
        </div>

        {/* Right group: bulk action buttons + 'N selected' caption,
            opacity-toggled together so the bar reserves its full width. */}
        <div
          aria-hidden={selCount === 0}
          className={cn(
            "ml-auto flex flex-wrap items-center gap-2 transition-opacity",
            selCount > 0 ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <BulkStatusButton
            label="Reject"
            colorClass="bg-red-500/10 text-red-500 border-red-500/30 hover:bg-red-500/20"
            onClick={() => setStatusBulk("reject")}
            disabled={bulkBusy}
          />
          <BulkStatusButton
            label="Consider"
            colorClass="bg-amber-500/10 text-amber-500 border-amber-500/30 hover:bg-amber-500/20"
            onClick={() => setStatusBulk("consider")}
            disabled={bulkBusy}
          />
          <BulkStatusButton
            label="Fast-Track"
            colorClass="bg-purple-500/10 text-purple-500 border-purple-500/30 hover:bg-purple-500/20"
            onClick={() => setStatusBulk("fast_track")}
            disabled={bulkBusy}
          />
          <BulkStatusButton
            label="Interview"
            colorClass="bg-cyan-500/10 text-cyan-500 border-cyan-500/30 hover:bg-cyan-500/20"
            onClick={() => setStatusBulk("interview")}
            disabled={bulkBusy}
          />
          <button
            type="button"
            onClick={reevalSelected}
            disabled={bulkBusy}
            className="inline-flex h-9 items-center rounded-md border border-border-strong px-3 text-[12px] font-mono font-bold uppercase tracking-wider transition-colors hover:bg-white/5 disabled:opacity-50"
          >
            {bulkBusy ? "Working…" : "Re-evaluate"}
          </button>
          <span className="ml-2 text-[12px] font-mono font-bold uppercase tracking-wider text-primary">
            {selCount} selected
          </span>
        </div>
      </div>

      {/* Sticky header */}
      <div
        className={cn(
          "sticky top-0 z-10 grid",
          GRID_COLS,
          "gap-4 border-b border-border bg-secondary/80 px-5 py-3 text-[13px] font-mono font-bold uppercase tracking-wider backdrop-blur",
        )}
      >
        {/* Diagnostic tints stripped (Phase 3.6.9). */}
        <div>
          <SortHeader label="Candidate" column="name" active={sortKey} dir={sortDir} onClick={onSort} />
        </div>
        {/* Resume + Portfolio header: split into two equal halves so each
             label sits centered DIRECTLY above its icon in the body row.
             pr-[25px] (Phase 3.6.10) gives Quick Overview's column header
             extra breathing room from the Portfolio side. */}
        <div className="flex items-center pr-[25px]">
          <div className="flex flex-1 justify-center">Resume</div>
          <div className="flex flex-1 justify-center">Portfolio</div>
        </div>
        <div>Quick Overview</div>
        <div className="flex items-center justify-center">Status</div>
        <div className="flex items-center justify-center">
          <Checkbox
            checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
            onCheckedChange={toggleAllVisible}
            aria-label="Select all visible"
          />
        </div>
      </div>

      {/* Active tier */}
      {active.length === 0 && (
        <div className="px-5 py-6 text-center text-sm text-muted-foreground">
          No active candidates — everyone is in the rejected bucket below.
        </div>
      )}
      {active.map((c) => (
        <Row
          key={c.id}
          c={c}
          resumePath={resumePathByCand[c.id] ?? null}
          checked={effectiveSelection.has(c.id)}
          onCheckboxClick={(e) => handleRowToggle(c.id, e.shiftKey)}
          onRowClick={() => nav(`/talent-scout/candidates/${c.id}`)}
          onChanged={onChanged}
        />
      ))}

      {/* Tier divider */}
      <button
        type="button"
        onClick={() => setRejectedOpen((v) => !v)}
        className="flex w-full items-center gap-3 border-t border-border bg-secondary/40 px-5 py-2.5 text-left text-[13px] font-mono font-bold uppercase tracking-wider text-muted-foreground hover:bg-secondary/60"
      >
        {rejectedOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span>
          {rejectedOpen
            ? "Hide rejected candidates"
            : `Show ${rejected.length} rejected candidate${rejected.length === 1 ? "" : "s"}`}
        </span>
      </button>

      {rejectedOpen &&
        rejected.map((c) => (
          <Row
            key={c.id}
            c={c}
            resumePath={resumePathByCand[c.id] ?? null}
            checked={effectiveSelection.has(c.id)}
            onCheckboxClick={(e) => handleRowToggle(c.id, e.shiftKey)}
            onRowClick={() => nav(`/talent-scout/candidates/${c.id}`)}
            onChanged={onChanged}
            dim
          />
        ))}
    </Card>
  );
}

function BulkStatusButton({
  label,
  colorClass,
  onClick,
  disabled,
}: {
  label: string;
  colorClass: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-9 items-center rounded-md border px-3 text-[12px] font-mono font-bold uppercase tracking-wider transition-colors disabled:opacity-50",
        colorClass,
      )}
    >
      {label}
    </button>
  );
}

function Row({
  c,
  resumePath,
  checked,
  onCheckboxClick,
  onRowClick,
  onChanged,
  dim,
}: {
  c: CandidateRow;
  /** Path to the candidate's resume in candidate_attachments, or null. */
  resumePath: string | null;
  checked: boolean;
  onCheckboxClick: (e: React.MouseEvent) => void;
  onRowClick: () => void;
  onChanged?: () => void | Promise<void>;
  dim?: boolean;
}) {
  const overview = (c.quick_overview as string[] | null) ?? null;
  // Phase 3.7.1: row gets a left-border in the candidate's status color, same
  // pattern as FinalReviewDetail's rationale cell (inline borderColor hex).
  // Phase 3.7.1.1: 3px → 2.5px (slightly lighter visual weight).
  const rowAccent = statusStyle(c.status).colorHex;
  return (
    <div
      onClick={onRowClick}
      style={{ borderLeft: `2.5px solid ${rowAccent}` }}
      className={cn(
        "grid",
        GRID_COLS,
        "cursor-pointer items-center gap-4 border-b border-border px-5 py-4 text-sm last:border-b-0 transition-colors hover:bg-secondary/40",
        dim && "opacity-75",
        checked && "bg-primary/5",
      )}
    >
      {/* Candidate stack — diagnostic tint removed (Phase 3.6.9). */}
      <div className="min-w-0 pr-2">
        <div className="truncate text-[16px] font-bold leading-tight">{c.name ?? "—"}</div>
        {/* Phase 3.7.1.1: email is a mailto link, slightly muted coral. */}
        {c.email ? (
          <a
            href={`mailto:${c.email}`}
            onClick={(e) => e.stopPropagation()}
            className="mt-1 block truncate text-[12px] text-primary/80 hover:text-primary hover:underline"
          >
            {c.email}
          </a>
        ) : (
          <div className="mt-1 truncate text-[12px] text-muted-foreground">—</div>
        )}
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {c.applied_date
            ? `Applied ${new Date(c.applied_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
            : "—"}
        </div>
        <div className="mt-3 flex items-center gap-2 font-mono text-[12px] uppercase tracking-wider text-muted-foreground">
          <span>Score:</span>
          <ScoreInline value={c.score == null ? null : Number(c.score)} size={14} barWidth={60} />
        </div>
      </div>

      {/* Resume + Portfolio: split halves so each icon sits centered
          directly under its header label. pr-[25px] adds breathing
          room before Quick Overview (Phase 3.6.10). */}
      <div className="flex items-center pr-[25px]">
        <div className="flex flex-1 items-center justify-center">
          {resumePath ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openSignedFile(resumePath); }}
              title="Open resume"
              className={ICON_BUTTON_CLS}
            >
              <FileText className="h-4 w-4" />
            </button>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
        <div className="flex flex-1 items-center justify-center">
          <PortfolioCell c={c} onPathOpen={openSignedFile} />
        </div>
      </div>

      {/* Quick Overview — text bumped 12 → 13 (Phase 3.6.9). */}
      <div className="text-[13px] text-muted-foreground">
        {overview && overview.length > 0 ? (
          <ul className="space-y-1">
            {overview.slice(0, 5).map((b, i) => (
              <li key={i} className="flex gap-1.5 leading-snug">
                <span className="shrink-0 font-bold text-primary">—</span>
                <span className="text-foreground/80">{b}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span>—</span>
        )}
      </div>

      {/* Status */}
      <div
        className="flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <StatusDropdown
          candidateId={c.id}
          value={c.status}
          onChange={() => { void onChanged?.(); }}
          size="compact"
        />
      </div>

      {/* Checkbox (far right) */}
      <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
        <RowCheckbox
          checked={checked}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onCheckboxClick(e);
          }}
          ariaLabel={`Select ${c.name ?? c.email ?? "candidate"}`}
        />
      </div>
    </div>
  );
}
