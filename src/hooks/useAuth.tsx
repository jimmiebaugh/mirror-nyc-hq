import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { isAllowedEmail } from "@/lib/auth";
import { toast } from "@/hooks/use-toast";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const stampedUserIdRef = useRef<string | null>(null);
  const stampedAvatarUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Phase 3.6.15: manual hash-fallback. Kept as defense-in-depth after
    // the Phase 3.6.16 publishable-key fix. supabase-js's detectSessionInUrl
    // works again now that the API key is valid, but the manual path is
    // cheap insurance: if the URL hash carries access_token + refresh_token,
    // parse and call setSession ourselves, then strip the hash so a refresh
    // doesn't re-trigger. setSession emits SIGNED_IN downstream.
    const hash = window.location.hash;
    if (hash && hash.includes("access_token=")) {
      const params = new URLSearchParams(hash.slice(1));
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");
      if (access_token && refresh_token) {
        supabase.auth.setSession({ access_token, refresh_token }).then(() => {
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
        });
      }
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (newSession?.user && !isAllowedEmail(newSession.user.email)) {
        // Belt-and-suspenders: kick non-mirrornyc accounts out immediately.
        setSession(null);
        setTimeout(() => {
          supabase.auth.signOut();
          toast({
            title: "Access denied",
            description: "Mirror NYC accounts only.",
            variant: "destructive",
          });
        }, 0);
        return;
      }
      setSession(newSession);
      // Clear post-signin redirect once a session is set — the OAuth
      // round-trip already used it as redirectTo, so it's stale now.
      // Leaving stale entries around could send the next manual sign-in
      // to an irrelevant page.
      if (newSession?.user) {
        try {
          sessionStorage.removeItem("post_signin_redirect");
        } catch {
          /* swallow */
        }
      }
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session: existing } }) => {
      if (existing?.user && !isAllowedEmail(existing.user.email)) {
        supabase.auth.signOut();
        setSession(null);
      } else {
        setSession(existing);
      }
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  // Stamp users.last_active_at on session resolve. handle_new_user only
  // stamps on auth.users INSERT (Phase 5.4), so without this effect
  // users.last_active_at would be a "first signup" timestamp at best
  // (and NULL for users whose auth.users row predates the column add).
  //
  // Two-layer guard so we don't write on every soft remount:
  //   1. useRef -> fires at most once per AuthProvider lifecycle per
  //      user.id (covers React StrictMode double-mount, tab focus
  //      re-renders, etc.).
  //   2. sessionStorage -> persists across mounts within the same tab;
  //      5-min floor means the UPDATE skips when the user has been
  //      stamped within the last 5 minutes (covers manual reloads,
  //      route changes that remount the provider tree).
  // Private-mode browsers throw on sessionStorage access; the try/catch
  // falls back to the existing one-shot-per-lifecycle behavior.
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid || stampedUserIdRef.current === uid) return;
    stampedUserIdRef.current = uid;
    const STAMP_FLOOR_MS = 5 * 60 * 1000;
    const storageKey = `last_active_stamped:${uid}`;
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (Number.isFinite(parsed) && Date.now() - parsed < STAMP_FLOOR_MS) {
          return;
        }
      }
    } catch {
      /* private-mode browsers; proceed with the UPDATE */
    }
    supabase
      .from("users")
      .update({ last_active_at: new Date().toISOString() })
      .eq("id", uid)
      .then(({ error }) => {
        if (error) {
          console.warn("last_active_at stamp failed", error);
          return;
        }
        try {
          sessionStorage.setItem(storageKey, String(Date.now()));
        } catch {
          /* private-mode; the useRef guard still prevents re-fire */
        }
      });
  }, [session?.user?.id]);

  // Stamp users.avatar_url on session resolve when the Google metadata URL
  // differs from the stored row. handle_new_user only captures avatar_url
  // on auth.users INSERT; users whose auth row predates the column add will
  // have NULL avatar_url forever without a refresh. Mirrors the
  // last_active_at throttle: useRef one-shot per provider lifecycle plus
  // sessionStorage 5-min floor across mounts.
  useEffect(() => {
    const uid = session?.user?.id;
    const metaAvatar = ((session?.user?.user_metadata ?? {}) as Record<string, string>).avatar_url
      ?? null;
    if (!uid || !metaAvatar || stampedAvatarUserIdRef.current === uid) return;
    stampedAvatarUserIdRef.current = uid;
    const STAMP_FLOOR_MS = 5 * 60 * 1000;
    const storageKey = `avatar_url_stamped:${uid}`;
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (Number.isFinite(parsed) && Date.now() - parsed < STAMP_FLOOR_MS) {
          return;
        }
      }
    } catch {
      /* private-mode browsers; proceed with the UPDATE */
    }
    void (async () => {
      const { data: existing, error: readErr } = await supabase
        .from("users")
        .select("avatar_url")
        .eq("id", uid)
        .maybeSingle();
      if (readErr) {
        console.warn("avatar_url read failed", readErr);
        return;
      }
      if (existing?.avatar_url === metaAvatar) {
        try {
          sessionStorage.setItem(storageKey, String(Date.now()));
        } catch {
          /* private-mode; ref guard still holds */
        }
        return;
      }
      const { error: writeErr } = await supabase
        .from("users")
        .update({ avatar_url: metaAvatar })
        .eq("id", uid);
      if (writeErr) {
        console.warn("avatar_url stamp failed", writeErr);
        return;
      }
      try {
        sessionStorage.setItem(storageKey, String(Date.now()));
      } catch {
        /* private-mode; ref guard still holds */
      }
    })();
  }, [session?.user?.id]);

  const signInWithGoogle = async () => {
    // Force HTTPS on the production origin in case the user landed via
    // http:// somehow (browser autocomplete, old bookmark). Local dev
    // (localhost / 127.0.0.1) stays as-is so dev sign-in keeps working.
    const origin = window.location.origin;
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const safeOrigin = isLocal ? origin : origin.replace(/^http:\/\//, "https://");

    // Read the intended post-signin destination if ProtectedRoute saved one
    // (user clicked an email link to a deep route while signed-out, got
    // bounced to / for the hidden sign-in, and is now signing in). Falls
    // back to /home (Phase 5.1: replaces the old /talent-scout cold-signin
    // landing). Pending users get redirected to /pending downstream by
    // ProtectedRoute. Defense-in-depth path validation prevents
    // open-redirect via a poisoned sessionStorage value.
    let nextPath = "/home";
    try {
      const stored = sessionStorage.getItem("post_signin_redirect");
      if (stored && stored.startsWith("/") && !stored.startsWith("//")) {
        nextPath = stored;
      }
    } catch {
      /* private mode — ignore */
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${safeOrigin}${nextPath}`,
        queryParams: {
          hd: "mirrornyc.com",
          prompt: "select_account",
        },
      },
    });
    if (error) {
      toast({ title: "Sign-in failed", description: error.message, variant: "destructive" });
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, loading, signInWithGoogle, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
