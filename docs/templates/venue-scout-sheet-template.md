# Venue Scout: sourcing sheet template

Drop a CSV or XLSX file with any of the columns below into Sheet Upload. The parser is fuzzy + case-insensitive: a header is matched if its lowercase form **contains** any of the keyword substrings listed under "Header matches." Order of columns doesn't matter. Extra columns are ignored. Only `Venue Name` is required (rows without a name are dropped).

## Columns parsed today

| Sheet column (any one of these works) | HQ field | Header matches (substring, case-insensitive) | Notes |
| --- | --- | --- | --- |
| **Venue Name** | `name` | `name`, `venue` | Required. Row dropped if empty. |
| **Address** | `address` | `address`, `location` | Free text. Used as the address shown in the matrix. |
| **Neighborhood** | `neighborhood` | `neighborhood`, `area`, `district`, `hood`, `borough` | Free text. |
| **Type** | `venue_type` | `type`, `category`, `kind` | Slash-separated values from the canonical list: Retail, Event Venue, Industrial, Warehouse, Gallery, Studio, Outdoor, Mobile. AI canonicalizes on enrich (e.g. "storefront" -> Retail). |
| **Website** | `website_url` | `website`, `url`, `site`, `link`, `web`, `homepage` | Producer-entered URLs become the **primary research source** for AI enrichment. Listing-DB homepages (`peerspace.com`, `loopnet.com`, etc. on their own) get rejected at parse time, but deep listing links (e.g. `peerspace.com/spaces/12345`) pass through. |
| **Capacity** | `capacity` | `capacity`, `occupancy`, `max guests`, `max`, `guests`, `people`, `pax`, `headcount`, `attendance`, `seats`, `seating` | Integer. Digits-only extraction (e.g. "200 guests" -> 200). |
| **Size (sq ft)** | `size_sq_ft` | `sq ft`, `sqft`, `size`, `square footage`, `footage`, `feet` | Integer. Same digits-only extraction. |
| **Key Features** | `key_features` | `features`, `feature`, `notes`, `amenities`, `highlights`, `description`, `details` | Free text. Auto-split on commas, semicolons, pipes, or newlines into bullet list. **Heads up: a column titled "Notes" gets routed here, not to a separate notes field.** |

## Fields NOT in the sheet (filled by AI enrichment)

The parser only extracts the 8 columns above. Everything else on the matrix is filled by the AI enrichment pass that runs immediately after parse:

- `recommendations`: 2-4 venue-specific pitch bullets
- `considerations`: 2-4 limitations / gaps / logistics flags
- `derived_attrs`: alignment-column ratings (filled later in compile)
- `rank`: 0-100 fit score against the brief
- `venue_overview`: written at compile time
- Photos: uploaded via the Photo button on Shortlist
- Producer notes: written via the Notes column on Sourcing Report / Shortlist

The producer can inline-edit every field on Sourcing Report + Shortlist + Deck Prep after enrichment lands. Producer-entered values are preserved verbatim; AI fill only fires on empty fields.

## Collision warning

The parser uses substring matching (`norm.includes(keyword)`) and returns the first matching column in left-to-right column order. One pre-existing edge case:

- A header like **"Venue Type"** matches both `venue` (Name field) and `type` (Type field). If "Venue Type" is the leftmost column matching `venue`, the Name field gets the type string. **Fix: keep your "Venue Name" column left of "Venue Type"** (or use "Property Type" / "Category" / "Kind" instead).

Otherwise the expanded keyword lists are mutually exclusive: no other collision paths.

## Recommended approach

1. **Drop in what you know.** Even just name + address + URL is enough to drive useful research. Leave any field blank and the AI fills it in.
2. **Trust your URLs.** If you provide a `Website`, the enrichment pass treats it as the primary research source (web_searches scoped to that domain first) so Recs / Considerations / Features come from the actual listing rather than a fresh search.
3. **Don't over-fill.** Producer values are never overwritten: but if you fill all 8 columns, the AI only adds `recommendations` + `considerations` + `rank`. Leaving features blank lets the AI extract them from the URL or web search.

## Template file

`public/templates/venue-scout-sheet-template.csv` (served at `/templates/venue-scout-sheet-template.csv` and surfaced as the "Download sheet template (CSV)" affordance on `/venue-scout/overview` since Phase 5.12.14.3 R5 § B1): a single fully-populated example row (Phase 5.12.14.3 R5 amendment v1 trimmed the minimal + URL-only sample rows; the canonical shape is the fully-filled row, partial-row tolerance is documented above in the per-column table).

Open in Numbers / Excel / Google Sheets; save back as XLSX if you prefer. The parser handles XLSX, CSV, and (naively) PDF.
