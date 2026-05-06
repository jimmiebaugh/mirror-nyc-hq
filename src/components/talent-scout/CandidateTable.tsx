// Placeholder for Phase 3.5. The source repo's CandidateTable (252 lines)
// uses custom CSS classes that don't exist in HQ; full port + design-system
// adaptation happens when candidate UIs go in. The type export below is
// shared with downstream pages so imports resolve before the real component
// lands.

export type CandidateRow = {
  id: string;
  name: string | null;
  email: string | null;
  applied_date: string | null;
  status: string | null;
  total_score?: number | null;
  pull_round_id?: string | null;
  location?: string | null;
  portfolio_url?: string | null;
  portfolio_attachment_url?: string | null;
  portfolio_attachment_filename?: string | null;
  top_strengths?: string[] | null;
  key_gaps?: string[] | null;
  quick_overview?: unknown;
  recruiter_note?: string | null;
};

export function CandidateTable() {
  return null;
}
