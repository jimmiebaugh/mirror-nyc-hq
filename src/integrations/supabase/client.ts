// Phase 5.8.5 (F005): VITE_SUPABASE_URL hardcoded fallback removed.
// The fallback caused a real Phase 3.6.16 incident where a misconfigured
// preview build silently pointed at production because the env var was
// missing. Failing loud on a missing URL forces the env-var contract to
// be honored at build time. The publishable-key fallback remains since
// (a) Supabase publishable keys are safe to expose in the bundle (same
// security posture the legacy anon JWT had) and (b) rotating the URL is
// an infrastructure event but rotating the publishable key is not.
//
// IMPORTANT: never put the secret key (sb_secret_*) here. Server-only.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_glongs0Rm7PW5HK8XAqwzA_clq7Hw-4";

if (!SUPABASE_URL) {
  throw new Error("VITE_SUPABASE_URL is required. Set it in .env or the Netlify environment.");
}

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

// Phase 3.6.14: reverted from PKCE (flowType:"pkce") back to implicit flow.
// PKCE was returning 401 from the /auth/v1/token?grant_type=pkce exchange
// (code-verifier mismatch — root cause not yet diagnosed). Implicit flow
// returns the session in the URL hash (#access_token=...) which the
// supabase client parses on load via detectSessionInUrl. Hash survives
// Netlify's HTTP→HTTPS upgrade as long as Force HTTPS is on (it is), and
// useAuth.tsx's redirectTo is hardcoded to HTTPS so no scheme upgrade
// even needs to happen.
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  }
});
