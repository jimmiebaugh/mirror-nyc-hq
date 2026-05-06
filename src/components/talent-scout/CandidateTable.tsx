import { useMemo, useRef, useState } from "react";
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
import { ScoreBar } from "@/components/talent-scout/ScoreBar";
import { StatusDropdown } from "@/components/talent-scout/StatusDropdown";
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

// Checkbox moved to the far right (last column).
const GRID_COLS =
  "grid-cols-[minmax(220px,1fr)_104px_60px_minmax(0,2fr)_180px_24px_36px]";

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
        className="inline-flex h-9 w-9 items-center justify-center rounded-sm border border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
      >
        <FileText className="h-4 w-4" />
      </button>
    );
  }
  if (c.portfolio_type === "url" && c.portfolio_path_or_url) {
    return (
      <a
        href={c.portfolio_path_or_url}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        title={c.portfolio_path_or_url}
        className="inline-flex h-9 w-9 items-center justify-center rounded-sm border border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
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
}: {
  candidates: CandidateRow[];
  emptyMessage?: string;
  onChanged?: () => void | Promise<void>;
}) {
  const nav = useNavigate();
  const { user } = useAuth();
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [rejectedOpen, setRejectedOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const lastClickedId = useRef<string | null>(null);

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
      {/* Bulk action bar — slide-in when selection > 0. */}
      {selCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-primary/10 px-5 py-2.5">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold uppercase tracking-wider text-primary">
              {selCount} selected
            </span>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={bulkBusy}>
              Clear
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <BulkStatusButton
              label="Reject"
              colorClass="bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20"
              onClick={() => setStatusBulk("reject")}
              disabled={bulkBusy}
            />
            <BulkStatusButton
              label="Consider"
              colorClass="bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20"
              onClick={() => setStatusBulk("consider")}
              disabled={bulkBusy}
            />
            <BulkStatusButton
              label="Fast-Track"
              colorClass="bg-purple-500/10 text-purple-400 border-purple-500/30 hover:bg-purple-500/20"
              onClick={() => setStatusBulk("fast_track")}
              disabled={bulkBusy}
            />
            <BulkStatusButton
              label="Interview"
              colorClass="bg-cyan-500/10 text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/20"
              onClick={() => setStatusBulk("interview")}
              disabled={bulkBusy}
            />
            <Button size="sm" variant="outline" onClick={reevalSelected} disabled={bulkBusy}>
              <RefreshCw className={cn("mr-2 h-3.5 w-3.5", bulkBusy && "animate-spin")} />
              {bulkBusy ? "Working…" : "Re-evaluate"}
            </Button>
          </div>
        </div>
      )}

      {/* Sticky header */}
      <div
        className={cn(
          "sticky top-0 z-10 grid",
          GRID_COLS,
          "gap-4 border-b border-border bg-secondary/80 px-5 py-3 text-[11px] font-bold uppercase tracking-wider backdrop-blur",
        )}
      >
        <div>
          <SortHeader label="Candidate" column="name" active={sortKey} dir={sortDir} onClick={onSort} />
        </div>
        <div className="text-center">
          <SortHeader label="Score" column="score" active={sortKey} dir={sortDir} onClick={onSort} />
        </div>
        <div className="text-center">Portfolio</div>
        <div>Quick Overview</div>
        <div className="text-center">Status</div>
        <div />
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
        className="flex w-full items-center gap-3 border-t border-border bg-secondary/40 px-5 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:bg-secondary/60"
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
        "inline-flex h-8 items-center rounded-md border px-3 text-[11px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50",
        colorClass,
      )}
    >
      {label}
    </button>
  );
}

function Row({
  c,
  checked,
  onCheckboxClick,
  onRowClick,
  onChanged,
  dim,
}: {
  c: CandidateRow;
  checked: boolean;
  onCheckboxClick: (e: React.MouseEvent) => void;
  onRowClick: () => void;
  onChanged?: () => void | Promise<void>;
  dim?: boolean;
}) {
  const overview = (c.quick_overview as string[] | null) ?? null;
  return (
    <div
      onClick={onRowClick}
      className={cn(
        "grid",
        GRID_COLS,
        "cursor-pointer items-center gap-4 border-b border-border px-5 py-4 text-sm last:border-b-0 transition-colors hover:bg-secondary/40",
        dim && "opacity-75",
        checked && "bg-primary/5",
      )}
    >
      {/* Candidate (name + email + applied stacked; location lives on the detail page) */}
      <div className="min-w-0">
        <div className="truncate text-[15px] font-bold leading-tight">{c.name ?? "—"}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{c.email ?? ""}</div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {c.applied_date
            ? `Applied ${new Date(c.applied_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
            : "—"}
        </div>
      </div>

      {/* Score */}
      <div className="flex justify-center">
        <ScoreBar value={c.score == null ? null : Number(c.score)} />
      </div>

      {/* Portfolio */}
      <div className="flex justify-center">
        <PortfolioCell c={c} onPathOpen={openSignedFile} />
      </div>

      {/* Quick Overview */}
      <div className="text-xs text-muted-foreground">
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

      {/* Status — inline dropdown. Auto/Manual is conveyed by the status
          itself ("Rejected" vs "Auto-Rejected"), so no extra badge needed. */}
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

      {/* Chevron */}
      <div className="flex items-center justify-end text-muted-foreground">
        <ChevronRight className="h-4 w-4" />
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
