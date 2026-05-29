// Phase 5.16.1.1 §3b (code-observations Frontend #19): presentational split
// of ProjectDetail. The "Vendors" card + its add/remove Popover. Popover
// open/search state + the toggleVendor handler (optimistic join-row update)
// all live in the parent and arrive via props. JSX only relocated here.
//
// This card remains the documented standalone-section add-Popover exception
// (code-observations Frontend #39).
import type { Dispatch, SetStateAction } from "react";
import { Link } from "react-router-dom";
import { Check, Plus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { VendorLink } from "@/pages/projects/ProjectDetail";

export function ProjectVendorsCard({
  vendors,
  vendorOptions,
  vendorPickerOpen,
  setVendorPickerOpen,
  vendorSearch,
  setVendorSearch,
  toggleVendor,
}: {
  vendors: VendorLink[];
  vendorOptions: { id: string; label: string }[];
  vendorPickerOpen: boolean;
  setVendorPickerOpen: Dispatch<SetStateAction<boolean>>;
  vendorSearch: string;
  setVendorSearch: Dispatch<SetStateAction<string>>;
  toggleVendor: (vendorId: string) => Promise<void>;
}) {
  return (
    <section className="card">
      <div className="card-headbar">
        <span className="h-card">Vendors</span>
        <Popover open={vendorPickerOpen} onOpenChange={(o) => { setVendorPickerOpen(o); if (!o) setVendorSearch(""); }}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="combo-picker-btn"
              aria-label="Add or remove vendors"
              title="Manage vendors"
            >
              <Plus className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[280px] p-0" align="end">
            <Command shouldFilter>
              <CommandInput
                value={vendorSearch}
                onValueChange={setVendorSearch}
                placeholder="Search vendors..."
              />
              <CommandList>
                <CommandEmpty>No vendors.</CommandEmpty>
                {vendorOptions.map((opt) => {
                  const selected = vendors.some((v) => v.id === opt.id);
                  return (
                    <CommandItem
                      key={opt.id}
                      value={opt.label}
                      onSelect={() => {
                        void toggleVendor(opt.id);
                      }}
                      className="cursor-pointer"
                    >
                      <span className="flex-1 truncate">{opt.label}</span>
                      {selected ? (
                        <Check className="ml-2 h-4 w-4 text-primary" />
                      ) : null}
                    </CommandItem>
                  );
                })}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      <div className="card-pad stack-2">
        {vendors.length === 0 ? (
          <div className="subtle" style={{ fontSize: 13 }}>
            No vendors linked yet.
          </div>
        ) : (
          vendors.map((v) => (
            <div key={v.id} className="row-c" style={{ justifyContent: "space-between" }}>
              <Link
                to={`/vendors/${v.id}`}
                className="tlink"
                style={{ fontSize: 13 }}
              >
                {v.name}
              </Link>
              {v.category_name ? (
                <span className="cap muted">{v.category_name}</span>
              ) : null}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
