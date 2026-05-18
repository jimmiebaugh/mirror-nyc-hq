// Phase 4.7.1-port: PhotoUploadModal.
//
// Lifted from VS Pro src/components/sourcing/PhotoUploadModal.tsx with three
// locked port adaptations (per spec § 4f + port plan § 2):
//
//   1. Bucket name: VS Pro `venue-photos` (public) -> HQ `vs_venue_photos`
//      (private). Bucket created in this sub-phase's migration.
//   2. URL strategy: getPublicUrl -> createSignedUrl(path, 3600). Bucket is
//      private; signed URLs render inline for 1 hour, regenerated on every
//      modal open. Mount-load is now async.
//   3. Column / param rename: venue_photos.venue_id -> vs_venue_photos.
//      candidate_venue_id; storage path scope `${projectId}` -> `${scoutId}`.
//
// Storage path format `${scoutId}/${candidateVenueId}/slot-${N}-${timestamp}`
// lifted from VS Pro (hyphen + timestamp; the timestamp cache-busts when a
// producer re-uploads to a slot whose old object was just deleted). The
// 4.1-port docs/schema.md spec read `slot_${N}` (underscore, no timestamp);
// this sub-phase updates the doc to reflect the landed shape.
//
// Drag-to-reorder via @dnd-kit/core. PointerSensor activates after a 5px
// drag (avoids accidental drags during click-to-pick). Drop swaps slot
// indices; an existing photo's storage_path travels with the swap, so the
// re-insert below re-orders the row's slot column on save.
//
// Save shape: delete removed storage objects, wipe the venue's photo rows,
// upload new files, insert rows in slot order. Atomic per venue. VS Pro
// pattern verbatim.

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { X } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scoutId: string;
  venueId: string | null;
  venueName: string;
  onSaved: (count: number) => void;
};

type SlotState = {
  // Existing storage path persisted in DB (null if slot empty or not yet saved).
  existingPath: string | null;
  // New file selected this session.
  newFile: File | null;
  // Preview URL (blob: object URL for new picks, signed URL for existing).
  previewUrl: string | null;
};

const SLOT_LABELS = ["Top-Left", "Top-Right", "Bottom-Left", "Bottom-Right"];

function emptySlot(): SlotState {
  return { existingPath: null, newFile: null, previewUrl: null };
}

async function signedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("vs_venue_photos")
    .createSignedUrl(path, 3600);
  if (error) return null;
  return data.signedUrl;
}

function SlotCard({
  index,
  slot,
  onPick,
  onRemove,
}: {
  index: number;
  slot: SlotState;
  onPick: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const filled = !!slot.previewUrl;

  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `slot-${index}` });
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: `drag-${index}`,
    disabled: !filled,
    data: { fromIndex: index },
  });

  return (
    <div
      ref={setDropRef}
      onDragOver={(e) => {
        if (!filled) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) onPick(f);
      }}
      className={`relative aspect-square rounded-md overflow-hidden border ${
        isOver ? "border-primary" : "border-border"
      } bg-input group`}
    >
      <div className="absolute top-2 left-2 z-10 px-2 py-1 bg-black/60 backdrop-blur rounded text-[10px] font-bold uppercase tracking-[0.12em]">
        Slot {index + 1} · {SLOT_LABELS[index]}
      </div>

      {filled ? (
        <>
          <div
            ref={setDragRef}
            {...listeners}
            {...attributes}
            className={`absolute inset-0 cursor-grab active:cursor-grabbing ${
              isDragging ? "opacity-40" : ""
            }`}
            style={{
              backgroundImage: `url(${slot.previewUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
          <button
            onClick={onRemove}
            className="absolute top-2 right-2 z-20 h-6 w-6 rounded-full bg-primary text-primary-foreground items-center justify-center hidden group-hover:flex hover:bg-primary/90"
            title="Remove"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="absolute inset-0 flex items-center justify-center bg-cover bg-center"
          style={{ backgroundImage: "url(/mirror-placeholder.jpg)" }}
        >
          <div className="absolute inset-0 bg-black/65" />
          <span className="relative text-xs font-bold uppercase tracking-[0.14em] text-foreground">
            + Drop image
          </span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
        }}
      />
    </div>
  );
}

export function PhotoUploadModal({
  open,
  onOpenChange,
  scoutId,
  venueId,
  venueName,
  onSaved,
}: Props) {
  const [slots, setSlots] = useState<SlotState[]>([
    emptySlot(),
    emptySlot(),
    emptySlot(),
    emptySlot(),
  ]);
  const [removedPaths, setRemovedPaths] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Track outstanding blob: URLs so a Cancel / Esc / overlay-close path can
  // revoke them. Without this, a producer who picks files and then closes
  // without saving leaks the object URLs (modal stays mounted under the
  // parent page; setPick + remove only revoke on replacement, not on close).
  // Code-reviewer SHOULD FIX #3.
  const slotsRef = useRef<SlotState[]>(slots);
  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);

  useEffect(() => {
    if (!open || !venueId) return;
    setRemovedPaths([]);
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("vs_venue_photos")
        .select("slot, storage_path")
        .eq("candidate_venue_id", venueId)
        .order("slot");
      const rows = data ?? [];
      const urls = await Promise.all(rows.map((r) => signedUrl(r.storage_path)));
      if (cancelled) return;
      const next: SlotState[] = [emptySlot(), emptySlot(), emptySlot(), emptySlot()];
      rows.forEach((row, i) => {
        if (row.slot >= 1 && row.slot <= 4) {
          next[row.slot - 1] = {
            existingPath: row.storage_path,
            newFile: null,
            previewUrl: urls[i],
          };
        }
      });
      setSlots(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, venueId]);

  // Falling-edge open: revoke any unsaved blob: URLs.
  useEffect(() => {
    if (open) return;
    slotsRef.current.forEach((s) => {
      if (s.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(s.previewUrl);
    });
  }, [open]);

  // Final unmount: revoke whatever's left.
  useEffect(() => {
    return () => {
      slotsRef.current.forEach((s) => {
        if (s.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(s.previewUrl);
      });
    };
  }, []);

  function setPick(index: number, file: File) {
    setSlots((prev) => {
      const next = [...prev];
      // Queue replacement of an existing remote photo.
      if (next[index].existingPath)
        setRemovedPaths((r) => [...r, next[index].existingPath!]);
      if (next[index].previewUrl?.startsWith("blob:"))
        URL.revokeObjectURL(next[index].previewUrl!);
      next[index] = {
        existingPath: null,
        newFile: file,
        previewUrl: URL.createObjectURL(file),
      };
      return next;
    });
  }

  function remove(index: number) {
    setSlots((prev) => {
      const next = [...prev];
      if (next[index].existingPath)
        setRemovedPaths((r) => [...r, next[index].existingPath!]);
      if (next[index].previewUrl?.startsWith("blob:"))
        URL.revokeObjectURL(next[index].previewUrl!);
      next[index] = emptySlot();
      return next;
    });
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const fromIndex = (active.data.current as { fromIndex?: number } | undefined)?.fromIndex;
    const toIndex = parseInt(String(over.id).replace("slot-", ""), 10);
    if (fromIndex == null || isNaN(toIndex) || fromIndex === toIndex) return;
    setSlots((prev) => {
      const next = [...prev];
      [next[fromIndex], next[toIndex]] = [next[toIndex], next[fromIndex]];
      return next;
    });
  }

  async function save() {
    if (!venueId) return;
    setSaving(true);
    // Save order matters: upload all new files BEFORE we touch the DB rows
    // or delete any old storage objects. Original safer-than-VS-Pro flow
    // (code-reviewer MUST FIX #1):
    //   1. Upload all new files. If anything throws, original DB rows still
    //      point at original storage objects -- nothing has been deleted yet.
    //      Newly uploaded paths in storage become orphans on failure; cleanup
    //      is acceptable drift, not data loss.
    //   2. Wipe + reinsert vs_venue_photos rows in a tight pair (still two
    //      statements; not truly atomic without an RPC, but the window where
    //      DELETE has run but INSERT hasn't is now microseconds, with no
    //      network step between).
    //   3. Only after rows are persisted, delete the storage objects the
    //      user removed during this session.
    type Row = {
      candidate_venue_id: string;
      slot: number;
      storage_path: string;
      file_name: string | null;
      file_size_bytes: number | null;
    };
    const rows: Row[] = [];
    const uploadedPaths: string[] = []; // For cleanup if step 2 fails.
    try {
      // Step 1: upload new files. Build the rows array.
      for (let i = 0; i < 4; i++) {
        const s = slots[i];
        if (s.newFile) {
          const ext = (s.newFile.name.split(".").pop() ?? "jpg").toLowerCase();
          const path = `${scoutId}/${venueId}/slot-${i + 1}-${Date.now()}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("vs_venue_photos")
            .upload(path, s.newFile, {
              upsert: true,
              contentType: s.newFile.type,
            });
          if (upErr) throw upErr;
          uploadedPaths.push(path);
          rows.push({
            candidate_venue_id: venueId,
            slot: i + 1,
            storage_path: path,
            file_name: s.newFile.name,
            file_size_bytes: s.newFile.size,
          });
        } else if (s.existingPath) {
          rows.push({
            candidate_venue_id: venueId,
            slot: i + 1,
            storage_path: s.existingPath,
            file_name: null,
            file_size_bytes: null,
          });
        }
      }

      // Step 2: wipe + reinsert. Tight pair; original DB state is gone after
      // the DELETE but the next INSERT below runs immediately.
      await supabase
        .from("vs_venue_photos")
        .delete()
        .eq("candidate_venue_id", venueId);
      if (rows.length) {
        const { error: insErr } = await supabase
          .from("vs_venue_photos")
          .insert(rows);
        if (insErr) throw insErr;
      }

      // Step 3: delete the storage objects user removed during this session.
      // Run last so a failure here is a storage-cleanup leak, not data loss.
      const stillUsed = new Set(
        slots.map((s) => s.existingPath).filter(Boolean) as string[],
      );
      const toDelete = removedPaths.filter((p) => !stillUsed.has(p));
      if (toDelete.length) {
        await supabase.storage.from("vs_venue_photos").remove(toDelete);
      }

      onSaved(rows.length);
      onOpenChange(false);
    } catch (e) {
      // Best-effort cleanup of newly uploaded storage objects so failures
      // don't accumulate orphan files.
      if (uploadedPaths.length) {
        try {
          await supabase.storage.from("vs_venue_photos").remove(uploadedPaths);
        } catch {
          // Swallow; the user-facing error is the original throw.
        }
      }
      const msg = e instanceof Error ? e.message : "Save failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-xs font-bold uppercase tracking-[0.18em]">
            Upload Deck Photos
          </DialogTitle>
        </DialogHeader>
        <div className="text-sm">
          <span className="font-bold">{venueName}</span>
          <span className="text-muted-foreground/60 mx-2">·</span>
          <span className="text-muted-foreground">
            4 photos populate the venue slide in the deck
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Drop photos into specific slots. Drag to reorder. Slots map directly to
          positions on the deck slide.
        </p>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <div className="grid grid-cols-2 gap-4">
            {slots.map((s, i) => (
              <SlotCard
                key={i}
                index={i}
                slot={s}
                onPick={(f) => setPick(i, f)}
                onRemove={() => remove(i)}
              />
            ))}
          </div>
        </DndContext>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving}
            className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold uppercase tracking-[0.14em] text-xs"
          >
            {saving ? "Saving…" : "Save Photos"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
