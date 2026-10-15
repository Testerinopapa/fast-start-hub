// Authentication stays on the existing project. Research uses its own Edge Functions.
import { createClient } from '@supabase/supabase-js';
import { brokeredPreviewStorage } from './previewAuthStorage';

// This app authenticates against the original Explee login project.
// Hosted builders can override VITE_AUTH_* variables with a different Supabase
// project; using those values would produce tokens rejected by research APIs.
// These are public client settings, not service-role credentials.
const SUPABASE_URL = 'https://hpkmrpezybhtyjcsxfiq.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_E9CgSpjaEMAFyOmMRYoaPg_omf93u6I';


function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith('sb_publishable_') || value.startsWith('sb_secret_');
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    // New Supabase API keys are opaque strings, not bearer JWTs.
    if (isNewSupabaseApiKey(supabaseKey) && headers.get('Authorization') === `Bearer ${supabaseKey}`) {
      headers.delete('Authorization');
    }

    headers.set('apikey', supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  global: {
    fetch: createSupabaseFetch(SUPABASE_PUBLISHABLE_KEY),
  },
  auth: {
    storage: brokeredPreviewStorage(),
    persistSession: true,
    autoRefreshToken: true,
  }
});
