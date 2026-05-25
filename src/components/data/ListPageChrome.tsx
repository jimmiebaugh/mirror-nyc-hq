import { IconSearch } from "@/components/icons/HQIcons";

export function ListSearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div
      className="row-c"
      style={{
        gap: 8,
        padding: "8px 12px",
        border: "1px solid hsl(var(--border))",
        borderRadius: "var(--radius)",
        background: "hsl(var(--surface-alt))",
      }}
    >
      <IconSearch className="h-[14px] w-[14px]" />
      <input
        style={{
          height: 30,
          border: "none",
          background: "none",
          padding: 0,
          flex: 1,
          outline: "none",
          color: "hsl(var(--foreground))",
          fontSize: 13,
        }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {value ? (
        <button
          type="button"
          className="tlink"
          style={{ fontSize: 11, background: "none", border: 0, padding: 0, cursor: "pointer" }}
          onClick={() => onChange("")}
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}

export function ListChipRadioGroup<T extends string>({
  buttons,
  active,
  onPick,
}: {
  buttons: { value: T; label: string }[];
  active: T;
  onPick: (v: T) => void;
}) {
  return (
    <div className="row-c" style={{ gap: 6, flexWrap: "wrap" }}>
      {buttons.map((b) => {
        const isActive = active === b.value;
        const isAllActive = active === ("All" as T);
        let color: string;
        let opacity = 1;
        if (isActive) {
          color = b.value === ("All" as T) ? "hsl(var(--success))" : "hsl(var(--foreground))";
        } else if (isAllActive) {
          color = "hsl(var(--foreground))";
        } else {
          color = "hsl(var(--muted-foreground))";
          opacity = 0.5;
        }
        return (
          <button
            key={b.value}
            type="button"
            className={`fchip fchip--btn fchip--lg ${isActive ? "fchip--active" : ""}`}
            style={{ color }}
            onClick={() => onPick(b.value)}
          >
            <span style={{ color, opacity }}>{b.label}</span>
          </button>
        );
      })}
    </div>
  );
}
