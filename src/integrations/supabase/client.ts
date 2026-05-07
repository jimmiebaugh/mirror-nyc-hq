// Phase 3.6.18: reverted to env-var pattern now that Netlify + local .env
// hold the new sb_publishable_* key (Phase 3.6.16 hardcoded fallback was
// shipped while the env var was still on the dead legacy JWT).
//
// Hardcoded fallbacks remain so a missing env var doesn't break the app at
// runtime; if/when this Supabase project is rotated, update either the env
// var or the literals below. Publishable keys are safe to expose in the
// bundle (same security posture the legacy anon JWT had).
//
// IMPORTANT: never put the secret key (sb_secret_*) here. Server-only.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? "https://amipjjmphblfxpghjnel.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_glongs0Rm7PW5HK8XAqwzA_clq7Hw-4";

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