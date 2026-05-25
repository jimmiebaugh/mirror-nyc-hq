// Phase 5.12.14.3 R7 § G: global 404 restyled to match VS ErrorState chrome.
//
// Same vertical-flex centered card pattern as `ErrorState.tsx`. Renders the
// "404" status, a "Page not found" headline, a short helper line, and
// primary "Back to home" + secondary "Go back" actions. No phase eyebrow,
// no breadcrumb (parity with the R6 amendment v1 § 7 ErrorState polish).
//
// Mounted as the unchanged `<Route path="*" />` catch-all in App.tsx so
// any unrecognized path lands here (including retired routes like the
// pre-R7 `/venue-scout/scouts/new`).

import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname,
    );
  }, [location.pathname]);

  return (
    <div className="space-y-4">
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-8 py-12">
        <Icon />
        <h1 className="h-page mt-6 text-center">404</h1>
        <p className="mt-2 text-center text-2xl font-semibold text-foreground">
          Page not found
        </p>
        <p className="mt-5 max-w-xl text-center text-sm leading-relaxed text-muted-foreground">
          The page you're looking for doesn't exist or has moved. Head back to
          the home page or step back to where you came from.
        </p>
        <div className="mt-8 flex items-center gap-3">
          <Button variant="ghost" onClick={() => navigate(-1)}>
            ← Go back
          </Button>
          <Button onClick={() => navigate("/")}>Back to home</Button>
        </div>
      </div>
    </div>
  );
}

// Mirrors the `block` icon variant from ErrorState.tsx — generic
// circle-with-slash for "this thing doesn't exist". Inline so NotFound
// stays decoupled from the VS ErrorState file.
function Icon() {
  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-destructive text-destructive">
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M5 5l14 14" />
      </svg>
    </div>
  );
}
