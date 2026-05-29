import { describe, it, expect } from "vitest";
import {
  applyHeaderMapping,
  buildAutoHeaderMapping,
} from "../lib/hq/bulkImport/normalizeHeaders";
import type { ColumnSchema, ParsedSheet } from "../lib/hq/bulkImport/types";

// Minimal venue-shaped column set (mirrors src/lib/hq/bulkImport/entities/venue.ts).
const columns: ColumnSchema[] = [
  { key: "name", label: "Name", kind: "text", section: "Required", required: true },
  { key: "address", label: "Address", kind: "text", section: "Essentials" },
  {
    key: "venue_types",
    label: "Venue Types",
    kind: "refResolved",
    section: "References",
    refKind: "venue_type",
    multiValue: true,
  },
  { key: "square_footage", label: "Square Footage", kind: "number", section: "Essentials" },
];

function sheet(headers: string[], rows: Record<string, string>[], warnings: string[] = []): ParsedSheet {
  return { headers, rows, warnings };
}

describe("buildAutoHeaderMapping", () => {
  it("maps exact internal-key headers (template) to themselves", () => {
    const m = buildAutoHeaderMapping(["name", "address", "venue_types", "square_footage"], columns);
    expect(m).toEqual({ name: "name", address: "address", venue_types: "venue_types", square_footage: "square_footage" });
  });

  it("maps label / case / space / underscore variants to the column key", () => {
    const m = buildAutoHeaderMapping(["Name", "ADDRESS", "Venue Types", "square footage"], columns);
    expect(m).toEqual({ Name: "name", ADDRESS: "address", "Venue Types": "venue_types", "square footage": "square_footage" });
  });

  it("leaves synonyms it can't safely guess unmapped (for manual mapping)", () => {
    // "Venue" != name, "Venue Type" (singular) != venue_types, "Size" != square_footage
    const m = buildAutoHeaderMapping(["Venue", "Venue Type", "Size"], columns);
    expect(m).toEqual({});
  });

  it("prefers col.key over col.label on a normalized-token collision", () => {
    const cols: ColumnSchema[] = [
      { key: "title", label: "Name", kind: "text", section: "Essentials" },
      { key: "name", label: "Legal Name", kind: "text", section: "Essentials" },
    ];
    // header "name" must resolve to the column whose KEY is "name", not the one labeled "Name".
    expect(buildAutoHeaderMapping(["name"], cols).name).toBe("name");
  });

  it("leaves blank / whitespace-only headers unmapped", () => {
    expect(buildAutoHeaderMapping(["", "   "], columns)).toEqual({});
  });
});

describe("applyHeaderMapping", () => {
  it("re-keys rows + headers onto the mapped column keys", () => {
    const mapping = { Venue: "name", Address: "address", "Venue Type": "venue_types" };
    const out = applyHeaderMapping(
      sheet(["Venue", "Address", "Venue Type"], [{ Venue: "Foo", Address: "123 St", "Venue Type": "Gallery" }]),
      mapping,
    );
    expect(out.headers).toEqual(["name", "address", "venue_types"]);
    expect(out.rows[0]).toEqual({ name: "Foo", address: "123 St", venue_types: "Gallery" });
  });

  it("drops headers mapped to nothing (absent or empty target = Don't import)", () => {
    const mapping = { Venue: "name" }; // "Junk" deliberately absent
    const out = applyHeaderMapping(
      sheet(["Venue", "Junk"], [{ Venue: "Foo", Junk: "ignored" }]),
      mapping,
    );
    expect(out.headers).toEqual(["name"]);
    expect(out.rows[0]).toEqual({ name: "Foo" });
  });

  it("keeps the first source header on a target collision", () => {
    const mapping = { Venue: "name", "Venue Name": "name" };
    const out = applyHeaderMapping(
      sheet(["Venue", "Venue Name"], [{ Venue: "First", "Venue Name": "Second" }]),
      mapping,
    );
    expect(out.headers).toEqual(["name"]);
    expect(out.rows[0]).toEqual({ name: "First" });
  });

  it("preserves pre-existing parse warnings", () => {
    const out = applyHeaderMapping(
      sheet(["name"], [{ name: "Foo" }], ["multi-sheet workbook; using first sheet"]),
      { name: "name" },
    );
    expect(out.warnings).toEqual(["multi-sheet workbook; using first sheet"]);
  });
});

describe("buildAutoHeaderMapping + applyHeaderMapping (combined)", () => {
  it("passes a template-conforming sheet through unchanged", () => {
    const raw = sheet(
      ["name", "address", "venue_types"],
      [{ name: "Foo", address: "123 St", venue_types: "Gallery / Loft" }],
    );
    const out = applyHeaderMapping(raw, buildAutoHeaderMapping(raw.headers, columns));
    expect(out.headers).toEqual(["name", "address", "venue_types"]);
    expect(out.rows[0]).toEqual({ name: "Foo", address: "123 St", venue_types: "Gallery / Loft" });
  });
});
