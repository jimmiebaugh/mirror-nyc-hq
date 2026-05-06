import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type Searchable = {
  name?: string | null;
  email?: string | null;
  location?: string | null;
  recruiter_overview?: string | null;
  top_strengths?: unknown[] | null;
  key_gaps?: unknown[] | null;
  quick_overview?: unknown[] | null;
};

export function buildSearchableText(c: Searchable): string {
  const arrToStrings = (a: unknown[] | null | undefined) =>
    (a ?? []).map((v) => (typeof v === "string" ? v : ""));
  return [
    c.name,
    c.email,
    c.location,
    c.recruiter_overview,
    ...arrToStrings(c.top_strengths),
    ...arrToStrings(c.key_gaps),
    ...arrToStrings(c.quick_overview),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function matchesSearch(c: Searchable, term: string): boolean {
  if (!term) return true;
  return buildSearchableText(c).includes(term.toLowerCase());
}

export function CandidateSearch({
  value,
  onChange,
  placeholder = "Search candidates by name, email, location…",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  useEffect(() => {
    const t = setTimeout(() => { if (local !== value) onChange(local); }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  return (
    <div className={cn("relative w-full max-w-[640px]", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="text"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        className="h-10 pl-9 pr-9"
      />
      {local && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => { setLocal(""); onChange(""); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
