import { supabase } from '../integrations/supabase/client';

// A guest receives a real, owner-scoped Supabase anonymous session.
// Never share an application-wide service token with the browser.
let pending;
export async function ensureGuestSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (data.session) return data.session;
  if (!pending) {
    pending = supabase.auth.signInAnonymously().then(({ data, error }) => {
      if (error) throw error;
      if (!data.session) throw new Error('Could not initialize guest access.');
      return data.session;
    }).finally(() => { pending = null; });
  }
  return pending;
}
