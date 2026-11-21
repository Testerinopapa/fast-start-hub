import { supabase } from '../integrations/supabase/client';
export async function sixStageRequest(action, values = {}, signal) {
 const { data } = await supabase.auth.getSession();
 if (!data.session) throw Object.assign(new Error('Sign in with your existing account to save research.'), {code:'UNAUTHORIZED'});
 const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/splee-research`, {
  method:'POST',signal,headers:{'Content-Type':'application/json',apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${data.session.access_token}`},body:JSON.stringify({action,...values}),
 });
 const result = await response.json();
 if(!response.ok) throw Object.assign(new Error(result.error?.message || 'Could not load saved research.'),{code:result.error?.code});
 return result;
}
export const sixStagePath=(domain,id)=>`/auto-gtm/company/${encodeURIComponent(domain)}/explore?cloud=1&job=${encodeURIComponent(id)}`;
export async function startSixStageResearch(website) {
 const key=`six-stage-request:${website}`;
 const request_id=sessionStorage.getItem(key)||crypto.randomUUID();
 sessionStorage.setItem(key,request_id);
 const result=await sixStageRequest('start',{website,request_id});
 if(!result.job?.id)throw new Error('The saved research project was not returned.');
 sessionStorage.removeItem(key);return result;
}
