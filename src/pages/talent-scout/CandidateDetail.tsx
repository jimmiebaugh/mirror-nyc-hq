import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// Placeholder for Phase 3.5. Lets the pull-detail page link out without
// breaking; the real candidate detail UI lands when Phase 3.5 begins.
export default function CandidateDetail() {
  const { id } = useParams();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <Link to="/talent-scout" className="text-xs uppercase tracking-widest text-primary hover:underline">
          ← Talent Scout
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Candidate detail</h1>
        <p className="text-sm text-muted-foreground">Candidate ID: <code className="text-xs">{id}</code></p>
      </header>
      <Card className="border-dashed">
        <CardContent className="space-y-3 px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            Candidate detail UI lands in Phase 3.5 (recruiter overview, score breakdown,
            internal notes, attachment viewer, re-evaluate button).
          </p>
          <Button variant="ghost" asChild>
            <Link to="/talent-scout">Back to roles</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
