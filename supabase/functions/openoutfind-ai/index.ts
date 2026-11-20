import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { createAIProxy } from '../_shared/openoutfind-ai.ts';

function database() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Usage safeguards unavailable');
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
Deno.serve(createAIProxy({
  token: () => Deno.env.get('OPENOUTFIND_PROXY_TOKEN'),
  reserve: async (runId,fingerprint) => {
    const {data,error} = await database().rpc('openoutfind_ai_reserve',{p_run_id:runId,p_fingerprint:fingerprint});
    if (error || typeof data !== 'string') throw new Error('Usage safeguards unavailable');
    return data;
  },
  stop: async (runId,pauseAll) => {
    const {error} = await database().rpc('openoutfind_ai_stop',{p_run_id:runId,p_pause_all:pauseAll});
    if (error) throw new Error('Usage safeguards unavailable');
  },
}));