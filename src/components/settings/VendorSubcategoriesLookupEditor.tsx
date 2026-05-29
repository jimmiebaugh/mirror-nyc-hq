import { useEffect, useMemo, useState } from "react";
import { IconPlus, IconX } from "@/components/icons/HQIcons";
import { invalidateLookup, useLookup } from "@/lib/hq/lookups";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";

/**
 * Phase 6.4 (S1): Settings card for the category-scoped Vendor Subcategories
 * lookup. Clone of NeighborhoodsLookupEditor (city -> neighborhoods), here
 * vendor_categories -> vendor_subcategories. All lookup infra already exists
 * (vendor_subcategories is in the LookupTable union and mapped to
 * parent_category_id in PARENT_COLUMN_BY_TABLE), so this is purely the
 * parent-scoped editor UI.
 *
 * Each category renders as a native <details> row with a count chip; the
 * per-category tag editor mounts lazily on first expand so we don't spin up N
 * useLookup subscribers up front. Add + delete only (no inline rename),
 * matching the neighborhoods editor.
 *
 * `inline` mode drops the outer .card chrome so the editor reads cleanly
 * inside an expanded Lookup Lists table row.
 */
export function VendorSubcategoriesLookupEditor({
  inline = false,
}: { inline?: boolean } = {}) {
  const categories = useLookup("vendor_categories");
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<string>>(
    new Set(),
  );
  const [subcategoryCountsByCategory, setSubcategoryCountsByCategory] =
    useState<Record<string, number>>({});

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("vendor_subcategories")
        .select("parent_category_id");
      if (!active) return;
      if (error || !data) return;
      const counts: Record<string, number> = {};
      for (const row of data as { parent_category_id: string }[]) {
        counts[row.parent_category_id] =
          (counts[row.parent_category_id] ?? 0) + 1;
      }
      setSubcategoryCountsByCategory(counts);
    })();
    return () => {
      active = false;
    };
  }, []);

  const sortedCategories = useMemo(
    () => [...categories.options].sort((a, b) => a.name.localeCompare(b.name)),
    [categories.options],
  );

  const toggle = (categoryId: string, open: boolean) => {
    setExpandedCategoryIds((prev) => {
      const next = new Set(prev);
      if (open) next.add(categoryId);
      else next.delete(categoryId);
      return next;
    });
  };

  const body = (
    <div className={inline ? "stack-3" : "card-pad stack-3"}>
      {sortedCategories.length === 0 ? (
        <p className="cap">
          No categories yet. Add categories from the Vendor Categories row
          above.
        </p>
      ) : (
        sortedCategories.map((category) => (
          <details
            key={category.id}
            className="rounded border border-border"
            onToggle={(e) =>
              toggle(category.id, (e.target as HTMLDetailsElement).open)
            }
          >
            <summary
              className="row between"
              style={{ padding: "10px 12px", cursor: "pointer" }}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {category.name}
              </span>
              <span className="muted mono" style={{ fontSize: 11 }}>
                {subcategoryCountsByCategory[category.id] ?? 0}
              </span>
            </summary>
            <div style={{ padding: "0 12px 12px" }}>
              {expandedCategoryIds.has(category.id) ? (
                <CategorySubcategoryEditor categoryId={category.id} />
              ) : null}
            </div>
          </details>
        ))
      )}
    </div>
  );

  if (inline) {
    return <div style={{ padding: 16 }}>{body}</div>;
  }

  return (
    <div className="card">
      <div className="card-headbar">
        <span className="h-card">Subcategories</span>
        <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
          Nested under categories
        </span>
      </div>
      {body}
    </div>
  );
}

function CategorySubcategoryEditor({ categoryId }: { categoryId: string }) {
  const { options, addOption } = useLookup("vendor_subcategories", {
    parentScopeId: categoryId,
  });
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<
    { id: string; name: string } | null
  >(null);
  const [optimisticDeletes, setOptimisticDeletes] = useState<Set<string>>(
    new Set(),
  );

  const visible = options.filter((o) => !optimisticDeletes.has(o.id));

  const commitAdd = async () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      setAdding(false);
      return;
    }
    const result = await addOption(trimmed);
    if (!result) {
      toast({
        title: "Add failed",
        description: "Name may already exist for this category",
        variant: "destructive",
      });
    } else {
      toast({ title: `Added "${trimmed}"` });
    }
    setNewName("");
    setAdding(false);
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    const { id, name } = confirmDelete;
    setConfirmDelete(null);
    setOptimisticDeletes((prev) => new Set(prev).add(id));
    const { error } = await supabase
      .from("vendor_subcategories")
      .delete()
      .eq("id", id);
    if (error) {
      setOptimisticDeletes((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast({
        title: "Delete failed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    // Invalidate the shared lookup cache for this category scope so every
    // other mounted RecordCombobox (VendorEdit, etc.) re-fetches without the
    // deleted row.
    invalidateLookup("vendor_subcategories", categoryId);
    toast({ title: `Removed "${name}"` });
  };

  return (
    <>
      <div
        className="row wrap"
        style={{ gap: 7, alignItems: "center", paddingTop: 8 }}
      >
        {visible.length === 0 ? (
          <span
            className="tag"
            style={{
              borderStyle: "dashed",
              color: "hsl(var(--subtle-foreground))",
            }}
          >
            No items yet
          </span>
        ) : null}
        {visible.map((o) => (
          <span
            key={o.id}
            className="tag"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            {o.name}
            <button
              type="button"
              className="ca"
              onClick={() => setConfirmDelete({ id: o.id, name: o.name })}
              title="Delete"
              aria-label={`Delete ${o.name}`}
              style={{ marginLeft: 2 }}
            >
              <IconX className="ic" style={{ width: 9, height: 9 }} />
            </button>
          </span>
        ))}
        {adding ? (
          <input
            autoFocus
            className="input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={commitAdd}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitAdd();
              if (e.key === "Escape") {
                setNewName("");
                setAdding(false);
              }
            }}
            placeholder="New subcategory..."
            style={{ width: 200, height: 30 }}
          />
        ) : (
          <button
            type="button"
            className="tlink"
            onClick={() => setAdding(true)}
            style={{ background: "none", border: "none" }}
          >
            <IconPlus className="ic ic-sm" />
            Add
          </button>
        )}
      </div>

      <AlertDialog
        open={Boolean(confirmDelete)}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove "{confirmDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the subcategory from the lookup list. Existing
              records that reference it may need to be updated by hand.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
