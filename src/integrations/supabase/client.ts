// Phase 3.6.16: hardcoded publishable key (was VITE_SUPABASE_PUBLISHABLE_KEY
// env var). The Supabase project was migrated to the new sb_publishable_* /
// sb_secret_* key system, and the legacy JWT anon key (still displayed in
// the dashboard's "Legacy" tab) returns 401 against /auth/v1 endpoints.
// Netlify's env var was holding the legacy JWT. Hardcoding the publishable
// key here is the recommended pattern: publishable keys are designed to be
// safely exposed in client bundles, no different from the anon JWT was.
//
// If/when the Supabase project is rotated or replaced, update both values.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = "https://amipjjmphblfxpghjnel.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_glongs0Rm7PW5HK8XAqwzA_clq7Hw-4";

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