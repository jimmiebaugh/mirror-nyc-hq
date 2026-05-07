import { createContext, useContext, useEffect, useState, ReactNode } from "react";
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

  useEffect(() => {
    // Phase 3.6.14: diagnostic logging for OAuth debugging on production.
    // Remove once OAuth is verified stable.
    console.log("[auth] mount", {
      url: window.location.href,
      hasHash: !!window.location.hash,
      hasCode: window.location.search.includes("code="),
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      console.log("[auth] state change", { event, hasSession: !!newSession, email: newSession?.user?.email });
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
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session: existing }, error }) => {
      console.log("[auth] getSession result", { hasSession: !!existing, error: error?.message });
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

  const signInWithGoogle = async () => {
    // Force HTTPS on the production origin in case the user landed via
    // http:// somehow (browser autocomplete, old bookmark). Local dev
    // (localhost / 127.0.0.1) stays as-is so dev sign-in keeps working.
    const origin = window.location.origin;
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const safeOrigin = isLocal ? origin : origin.replace(/^http:\/\//, "https://");

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${safeOrigin}/`,
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
