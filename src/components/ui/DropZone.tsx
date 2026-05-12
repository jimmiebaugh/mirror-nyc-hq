import { useRef, useState, type DragEvent, type ChangeEvent } from "react";
import { FileText, Image as ImageIcon, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  /** Accept attribute for the file input (mime types or extensions). */
  accept?: string;
  multiple?: boolean;
  /** Per-file size cap (MB). Files exceeding the cap are rejected with an inline error. */
  maxSizeMb?: number;
  /** Optional override for the in-zone helper text. Keeps the user-facing
   *  hint short when `accept` carries a long mime+extension allowlist. */
  hint?: string;
  files: File[];
  onAdd: (added: File[]) => void;
  onRemove: (index: number) => void;
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const fileIcon = (file: File) => {
  if (file.type.startsWith("image/")) return ImageIcon;
  return FileText;
};

const matchesAccept = (file: File, accept: string | undefined): boolean => {
  if (!accept) return true;
  const tokens = accept.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (tokens.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  for (const tok of tokens) {
    if (tok.startsWith(".")) {
      if (name.endsWith(tok)) return true;
    } else if (tok.endsWith("/*")) {
      const prefix = tok.slice(0, -1);
      if (type.startsWith(prefix)) return true;
    } else {
      if (type === tok) return true;
    }
  }
  return false;
};

/**
 * Drag-and-drop file picker. Used by the New Scout wizard's Step 0 brief
 * upload, and reused later in Phase 4.4 sheet upload + Phase 4.5 venue
 * photos. Default-state interior is bg-input per design-system §12 #5.
 */
export function DropZone({ accept, multiple, maxSizeMb, hint, files, onAdd, onRemove }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const handleSelected = (incoming: FileList | null) => {
    if (!incoming || incoming.length === 0) return;
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const f of Array.from(incoming)) {
      if (!matchesAccept(f, accept)) {
        rejected.push(`${f.name}: unsupported file type`);
        continue;
      }
      if (maxSizeMb !== undefined && f.size > maxSizeMb * 1024 * 1024) {
        rejected.push(`${f.name}: exceeds ${maxSizeMb} MB limit`);
        continue;
      }
      accepted.push(f);
    }
    setErrors(rejected);
    if (accepted.length > 0) onAdd(accepted);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    handleSelected(e.dataTransfer.files);
  };

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    handleSelected(e.target.files);
  };

  const openPicker = () => inputRef.current?.click();

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={0}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPicker();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed bg-input px-6 py-10 text-center transition-colors",
          dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
        )}
      >
        <Upload className="h-6 w-6 text-muted-foreground" />
        <div className="text-sm font-semibold text-foreground">
          {dragOver ? "Drop files to upload" : "Click to upload, or drag and drop"}
        </div>
        <div className="text-xs text-muted-foreground">
          {hint
            ? hint
            : `${accept ? `Accepted: ${accept}` : "Any file type"}${
                maxSizeMb !== undefined ? `, max ${maxSizeMb} MB per file` : ""
              }`}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={onChange}
        />
      </div>

      {errors.length > 0 && (
        <ul className="space-y-1 text-xs text-destructive">
          {errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((f, i) => {
            const Icon = fileIcon(f);
            return (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm">{f.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-muted-foreground">{formatBytes(f.size)}</span>
                  <button
                    type="button"
                    onClick={() => onRemove(i)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`Remove ${f.name}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
