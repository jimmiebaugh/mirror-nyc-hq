import { describe, expect, it, vi } from "vitest";
import { projectConfig } from "../lib/hq/bulkImport/entities/project";
import { vendorConfig } from "../lib/hq/bulkImport/entities/vendor";
import { venueConfig } from "../lib/hq/bulkImport/entities/venue";
import {
  normalizeHttpUrl,
  normalizeMoney,
  normalizeWholeNumber,
} from "../lib/hq/bulkImport/validation";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

describe("bulk import value normalization", () => {
  it("accepts common spreadsheet URL and money formats", () => {
    expect(normalizeHttpUrl("example.com")).toBe("https://example.com/");
    expect(normalizeHttpUrl("docs.google.com/presentation/d/abc/edit")).toBe(
      "https://docs.google.com/presentation/d/abc/edit",
    );
    expect(normalizeWholeNumber("1,200")).toBe("1200");
    expect(normalizeWholeNumber("$8,500.00", { currency: true })).toBe("8500");
    expect(normalizeMoney("$12,500.75")).toBe("12500.75");
  });

  it("normalizes venue commit rows before sending them to the Edge Function", () => {
    const payload = venueConfig.buildCommitPayload?.(
      [
        {
          name: "Example Venue",
          capacity: "1,200",
          square_footage: "4,500",
          total_sq_ft: "4,500.0",
          event_day_rate: "$8,500.00",
          website_url: "example.com",
          venue_slide_url: "docs.google.com/presentation/d/abc/edit",
        },
      ],
      {},
      [],
    );

    expect(payload?.rows[0]).toMatchObject({
      capacity: "1200",
      square_footage: "4500",
      total_sq_ft: "4500",
      event_day_rate: "8500",
      website_url: "https://example.com/",
      venue_slide_url: "https://docs.google.com/presentation/d/abc/edit",
    });
  });
});

describe("bulk import row validation", () => {
  it("keeps venue rows with normalized URL and numeric values importable", () => {
    const errors = venueConfig.validateRows?.(
      [
        {
          name: "Example Venue",
          capacity: "1,200",
          total_sq_ft: "4,500",
          event_day_rate: "$8,500",
          website_url: "example.com",
          contact_email: "hello@example.com",
        },
      ],
      {},
    );

    expect(errors).toEqual([]);
  });

  it("flags venue rows that would have become a generic 400", () => {
    const errors = venueConfig.validateRows?.(
      [
        {
          name: "Example Venue",
          capacity: "1,200 people",
          website_url: "not a url",
          contact_email: "bad-email",
        },
      ],
      {},
    );

    expect(errors).toEqual([
      {
        row_index: 0,
        column: "capacity",
        message: 'capacity must be a non-negative whole number (got "1,200 people").',
      },
      {
        row_index: 0,
        column: "contact_email",
        message: 'Contact email looks invalid (got "bad-email").',
      },
      {
        row_index: 0,
        column: "website_url",
        message: 'website_url must be a valid http(s) URL (got "not a url").',
      },
    ]);
  });

  it("mirrors server-side vendor and project validators in the Review grid", () => {
    expect(
      vendorConfig.validateRows?.(
        [{ name: "Vendor", subcategory: "Scenic", preferred: "maybe", website_url: "vendor.com" }],
        {},
      ),
    ).toEqual([
      {
        row_index: 0,
        column: "preferred",
        message: 'preferred must be "true" or "false" (got "maybe").',
      },
      {
        row_index: 0,
        column: "subcategory",
        message: "Subcategory requires a Category on the same row.",
      },
    ]);

    expect(
      projectConfig.validateRows?.(
        [{ name: "Project", status: "Nope", live_start: "05/29/2026", budget: "$10,000" }],
        {},
      ),
    ).toEqual([
      { row_index: 0, column: "status", message: 'Unknown status "Nope".' },
      {
        row_index: 0,
        column: "live_start",
        message: 'Date must be YYYY-MM-DD (got "05/29/2026").',
      },
    ]);
  });
});
