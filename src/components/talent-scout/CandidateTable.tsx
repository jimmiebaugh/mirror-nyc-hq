import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
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
import { ReviewedPill } from "@/components/talent-scout/ReviewedPill";
import { ReferralPill } from "@/components/talent-scout/ReferralPill";
import type { Database } from "@/integrations/supabase/types";

export type CandidateRow = Database["public"]["Tables"]["ts_candidates"]["Row"];
type Status = CandidateRow["status"];

// Phase 3.7.2.1: auto_rejected deprecated. Kept in the set for legacy rows
// that somehow survived the backfill; new writes use status='reject' with
// manually_reviewed=false.
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
// Phase 3.7.1.2: status column 132 → 148 to fit AUTO-REJECTED label
// without clipping (StatusDropdown compact pill widened to 140 min).
// Phase 3.7.8.3: candidate column 260→220 (cell content scales up but
// no longer hogs width). R+P column 185→140: Resume + Portfolio collapse
// from side-by-side icon halves into vertically stacked text buttons.
// Phase 3.7.8.17: R+P column 140→150 to absorb the wider buttons
// (110→120) needed for the bumped text size.
const GRID_COLS =
  "grid-cols-[220px_150px_minmax(0,2.4fr)_148px_36px]";

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

// Phase 3.7.8.3: stacked Resume / Portfolio text buttons. Replaces the
// icon buttons (FileText / ExternalLink in 3.6.8). Same surface-raised
// + bordered look, fixed-width so the stack reads as a tidy pair, mono
// uppercase to match other table affordances.
// Phase 3.7.8.17: text bumped 11→13 so the buttons read at a glance
// without leaning in. Width 110→120 absorbs the wider glyphs.
const TEXT_BUTTON_CLS =
  "inline-flex h-8 w-[120px] items-center justify-center rounded-sm border border-border-strong bg-surface-raised text-[13px] font-mono font-bold uppercase tracking-wider text-foreground hover:bg-accent hover:border-foreground transition-colors";

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
        className={TEXT_BUTTON_CLS}
      >
        Portfolio
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
        className={TEXT_BUTTON_CLS}
      >
        Portfolio
      </a>
    );
  }
  return <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">—</span>;
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
  title,
  meta,
}: {
  candidates: CandidateRow[];
  emptyMessage?: string;
  onChanged?: () => void | Promise<void>;
  /** Phase 3.6.7: when both provided, the search input renders inside the
      bulk-action bar's left side. Parents that pass these stop rendering
      their own search input above the table. */
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  /** Phase 3.7.8.7: optional in-card section header. When `title` is
      provided, an extra row renders above the bulk-action bar with the
      title in coral and `meta` (if any) inline-right in white. Used by
      RoleDashboard to label the master pool. */
  title?: string;
  meta?: string;
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
    // Phase 3.7.2: bulk status changes also flip manually_reviewed → true.
    // Same rule as a single dropdown change — these are explicit human picks.
    const { error } = await supabase
      .from("ts_candidates")
      .update({ status, manually_reviewed: true })
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
      <Card className="overflow-hidden bg-surface-alt">
        {title && (
          <div className="flex items-baseline gap-3 border-b border-border px-5 py-4">
            <h2 className="text-[18px] font-extrabold uppercase tracking-tight text-primary" style={{ fontFamily: "var(--font-display)" }}>
              {title}
            </h2>
            {meta && <span className="text-[11px] text-foreground">{meta}</span>}
          </div>
        )}
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">{emptyMessage}</div>
      </Card>
    );
  }

  const selCount = effectiveSelection.size;

  return (
    <Card className="overflow-hidden bg-surface-alt">
      {/* Phase 3.7.8.7: optional in-card title row, sits above the
          bulk-action bar. Title renders in coral at 18px (smaller than
          the page-level h-section utility), meta sits inline-right in
          white at 11px. Hidden when no title prop is passed. */}
      {title && (
        <div className="flex items-baseline gap-3 border-b border-border px-5 py-4">
          <h2 className="text-[18px] font-extrabold uppercase tracking-tight text-primary" style={{ fontFamily: "var(--font-display)" }}>
            {title}
          </h2>
          {meta && <span className="text-[11px] text-foreground">{meta}</span>}
        </div>
      )}

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
        {/* Phase 3.7.8.10: header text removed. The stacked Resume +
             Portfolio buttons in each row are self-labeling, so the
             column header just reserves the slot. */}
        <div />

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
          No active candidates. Everyone is in the rejected bucket below.
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
  // Phase 3.7.2.3: only AUTO rows get the grey left-border accent.
  // Once a candidate is manually reviewed, the row drops back to the
  // default table border — no extra weight, no color. The combination
  // of the grey border + lighter background tint is purely a "still
  // needs review" affordance; manual-reviewed candidates blend back in.
  const isAuto = !c.manually_reviewed;
  return (
    <div
      onClick={onRowClick}
      style={isAuto ? { borderLeft: "1.5px solid hsl(var(--border-strong))" } : undefined}
      className={cn(
        "grid",
        GRID_COLS,
        "cursor-pointer items-center gap-4 border-b border-border px-5 py-4 text-sm last:border-b-0 transition-colors hover:bg-secondary/40",
        // Phase 3.7.2.2: clearer lift on un-reviewed (auto) rows. Was
        // bg-secondary/10 — too subtle to read. bg-foreground/[0.04] uses
        // the foreground (light) color at low opacity so the tint reads
        // as a distinct lighter band on the dark surface.
        isAuto && !checked && "bg-foreground/[0.04]",
        dim && "opacity-75",
        checked && "bg-primary/5",
      )}
    >
      {/* Candidate stack — Phase 3.7.8.3: name 16→17, email 12→13,
          applied 11→12, score 14→18 with bar 60→62. "Score:" label
          dropped — the colored number reads as the score on its own.
          Phase 3.7.8.17: name 17→15 (denser stack), score 18→14 with
          bar 62→80 (number sits closer to email/applied weight, bar
          carries more of the visual signal). */}
      <div className="min-w-0 pr-2">
        <div className="truncate text-[15px] font-bold leading-tight">{c.name ?? "—"}</div>
        {/* Phase 3.7.6.7: mailto only covers the visible email text, not
             the full column. block + truncate was filling the cell width
             so the entire column was clickable. inline-block with
             max-w-full keeps truncation but sizes to content. */}
        {c.email ? (
          <div className="mt-1 max-w-full">
            <a
              href={`mailto:${c.email}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-block max-w-full truncate align-bottom text-[13px] text-primary/80 hover:text-primary hover:underline"
            >
              {c.email}
            </a>
          </div>
        ) : (
          <div className="mt-1 truncate text-[13px] text-muted-foreground">—</div>
        )}
        <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
          {c.applied_date
            ? `Applied ${new Date(c.applied_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
            : "—"}
        </div>
        <div className="mt-3 flex items-center">
          <ScoreInline value={c.score == null ? null : Number(c.score)} size={14} barWidth={80} />
        </div>
      </div>

      {/* Phase 3.7.8.3: Resume + Portfolio stacked vertically. Resume
          on top, Portfolio below, both centered horizontally. Empty
          slots render as a muted dash so the column always lines up. */}
      <div className="flex flex-col items-center justify-center gap-2">
        {resumePath ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); openSignedFile(resumePath); }}
            title="Open resume"
            className={TEXT_BUTTON_CLS}
          >
            Resume
          </button>
        ) : (
          <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">—</span>
        )}
        <PortfolioCell c={c} onPathOpen={openSignedFile} />
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

      {/* Status — dropdown on top, reviewed pill (and in Pass 5 the
           referral pill) stacked below. Pills sit in a flex row so a
           future referral pill can sit alongside at flex-1 50/50 split. */}
      <div
        className="flex flex-col items-stretch justify-center gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        <StatusDropdown
          candidateId={c.id}
          value={c.status}
          onChange={() => { void onChanged?.(); }}
          size="compact"
        />
        <div className="flex items-center gap-1">
          <ReviewedPill
            manuallyReviewed={c.manually_reviewed === true}
            candidateId={c.id}
            onChanged={onChanged}
          />
          {/* Phase 3.7.7: ReferralPill renders inline only when the
               candidate was ingested via a Mirror manager forward. Both
               pills use flex-1 so they share the column 50/50 when both
               are present; ReviewedPill stretches full-width when alone. */}
          {c.is_referral === true && (
            <ReferralPill referrerEmail={c.referrer_email} />
          )}
        </div>
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
