import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { GoogleColorIcon } from "@/components/icons/GoogleColorIcon";

/**
 * Sign-in page at /.
 *
 * Wireframe binding: OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines
 * 632-643 (Surface 01 part 1; pending state is part 2 and ships at
 * /pending via PendingState.tsx).
 *
 * Replaces the Phase 5.1 stealth landing. Centered wordmark + visible
 * Google Sign-In button on a full-viewport dark background; no AppShell,
 * no top bar, no rail. Slug-retention plumbing already lives in
 * useAuth.signInWithGoogle (reads sessionStorage("post_signin_redirect"))
 * and ProtectedRoute (writes it); this component does not touch it.
 */
export default function Landing() {
  const { signInWithGoogle, session } = useAuth();
  const navigate = useNavigate();
  const [signingIn, setSigningIn] = useState(false);

  // Already-authenticated visitors get bounced to /home. The redirect-to
  // sessionStorage value (if any) was consumed by the OAuth round-trip; on
  // a second mount it's stale, so /home is the right destination here.
  useEffect(() => {
    if (session?.user) {
      navigate("/home", { replace: true });
    }
  }, [session, navigate]);

  const handleSignIn = async () => {
    if (signingIn) return;
    setSigningIn(true);
    try {
      await signInWithGoogle();
      // On success the browser leaves the page (Supabase OAuth redirect),
      // so we don't reset signingIn here. The catch + finally handle
      // failure paths so the button can be clicked again.
    } catch {
      // useAuth surfaces a destructive toast on failure.
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-6 py-12">
      <div className="text-center">
        <h1
          className="mb-[38px] font-display font-extrabold uppercase"
          style={{
            fontSize: 48,
            lineHeight: 1,
            letterSpacing: "-0.02em",
          }}
        >
          Mirror NYC <span className="text-primary">HQ</span>
        </h1>

        <button
          type="button"
          onClick={() => {
            void handleSignIn();
          }}
          disabled={signingIn}
          aria-label="Sign in with Google"
          className="inline-flex items-center justify-center gap-[10px] rounded-[4px] bg-white px-6 font-medium text-[#1f1f1f] transition-colors hover:bg-white/90 disabled:opacity-50"
          style={{ height: 48 }}
        >
          <GoogleColorIcon className="h-[22px] w-[22px]" />
          {signingIn ? "Signing in..." : "Sign in"}
        </button>
      </div>
    </div>
  );
}
