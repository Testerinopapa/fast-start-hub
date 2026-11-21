import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2.117.2/cors';
import { z } from 'zod';
import { contextMap,contextSearch,contextScrape } from '../_shared/context-dev.ts';
import { companyUrl,domainOf,ResearchError } from '../_shared/research-core.ts';
import { researchOwner } from '../_shared/splee-auth.ts';
import { newDiscovery } from '../_shared/discovery-core.ts';
import { campaignTargets } from '../_shared/campaigns-core.ts';
import { researchAI } from '../_shared/splee-ai.ts';
import { initialState,executeTask,reserveTask,recordFailure,finishStages,visibleState,type State } from '../_shared/splee-core.ts';
const requestSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('start'),website:z.string().max(2048),request_id:z.string().uuid()}).strict(),
 z.object({action:z.enum(['status','advance','export','resume']),job_id:z.string().uuid()}).strict(),
 z.object({action:z.literal('select_campaign'),job_id:z.string().uuid(),campaign_id:z.string().uuid()}).strict(),
 z.object({action:z.enum(['save_companies','remove_companies']),job_id:z.string().uuid(),campaign_id:z.string().uuid(),domains:z.array(z.string().max(253)).min(1).max(10)}).strict(),
 z.object({action:z.literal('list'),domain:z.string().max(253).optional()}).strict(),
]);
type Row={id:string;owner_id:string;domain:string;website_url:string;state:State;revision:number;working:boolean;claim_id:string|null;updated_at:string;created_at:string};
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}});
const expose=(j:Row)=>({job:{id:j.id,project_id:j.id,status:j.state.paused?'blocked':j.state.stage>6?'completed':'running',revision:j.revision,working:j.working,created_at:j.created_at},project:{id:j.id,domain:j.domain,website_url:j.website_url},workflow:visibleState(j.state),profile:j.state.profile});
export async function handler(req:Request) {
 if(req.method==='OPTIONS') return new Response('ok',{headers:corsHeaders});
 if(req.method!=='POST') return json({error:{code:'METHOD_NOT_ALLOWED',message:'Use POST.'}},405);
 try {
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!key) throw new ResearchError('NOT_CONFIGURED','Lovable Cloud research is not configured.',503);
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const token=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if(!token) throw new ResearchError('UNAUTHORIZED','Sign in to research a company.',401);
  const owner=await researchOwner(token,async value=>{const {data,error}=await db.auth.getUser(value);return error?null:data.user;});
  const text=await req.text();if(new TextEncoder().encode(text).length>4096) throw new ResearchError('INVALID_REQUEST','Request too large.',413);
  let input:unknown;try {input=JSON.parse(text);}catch {throw new ResearchError('INVALID_REQUEST','Invalid JSON.',400);}
  const parsed=requestSchema.safeParse(input);if(!parsed.success) throw new ResearchError('INVALID_REQUEST','Use a valid action, website, and project ID.',400);
  const body=parsed.data;
  if(body.action==='list') {
   let query=db.from('splee_research_jobs').select('*').eq('owner_id',owner).order('created_at',{ascending:false}).limit(50);
   if(body.domain) query=query.eq('domain',domainOf(companyUrl(body.domain)));
   const {data,error}=await query;if(error) throw new ResearchError('SAVE_FAILED','Could not read saved projects.',503);
   return json({projects:(data as Row[]).map(j=>({...expose(j).project,latestJob:expose(j).job,profile:j.state.profile,updated_at:j.updated_at}))});
  }
  if(body.action==='start') {
   const website=companyUrl(body.website);website.pathname='/';
   const {data,error}=await db.rpc('splee_start',{p_owner:owner,p_request:body.request_id,p_domain:domainOf(website),p_url:website.href,p_state:initialState(website.href)});
   if(error) throw new ResearchError(error.message.includes('DAILY_LIMIT')?'DAILY_LIMIT':'SAVE_FAILED',error.message.includes('DAILY_LIMIT')?'You can start up to five research jobs in 24 hours.':'Could not reserve this research project.',error.message.includes('DAILY_LIMIT')?429:503);
   return json(expose(data as Row),202);
  }
  const {data,error}=await db.from('splee_research_jobs').select('*').eq('id',body.job_id).eq('owner_id',owner).maybeSingle();
  if(error) throw new ResearchError('SAVE_FAILED','Could not load saved research.',503);
  if(!data) throw new ResearchError('NOT_FOUND','Research project not found.',404);
  let job=data as Row;
  const writeState=async(state:State)=>{
   const claim=await db.rpc('splee_claim',{p_job:job.id,p_owner:owner,p_revision:job.revision,p_state:state});
   if(claim.error||!claim.data.claimed)throw new ResearchError('CONFLICT','Research changed in another tab. Reload before editing.',409);
   const claimed=claim.data.job as Row;
   const finish=await db.rpc('splee_finish',{p_job:job.id,p_owner:owner,p_claim:claimed.claim_id,p_state:state});
   if(finish.error)throw new ResearchError('SAVE_FAILED','Could not save changes. Reload before repeating.',503);
   return finish.data as Row;
  };
  if(body.action==='resume') {
   if(job.working)throw new ResearchError('CONFLICT','The current operation must finish first.',409);
   if(job.state.paused) {
    if(!Deno.env.get('CONTEXT_DEV_API_KEY'))throw new ResearchError('NOT_CONFIGURED','Add CONTEXT_DEV_API_KEY in Project Settings → Secrets before continuing.',503);
    const errors=job.state.stages.flatMap(s=>s.errors);
    if(errors.some(e=>e!=='NOT_CONFIGURED'))throw new ResearchError('BLOCKED','Resolve the reported provider or usage restriction first. Interrupted paid requests are not repeated.',409);
    const state=structuredClone(job.state);state.paused=false;state.stages[state.stage-1].status='pending';state.stages[state.stage-1].errors=[];
    job=await writeState(state);
   }
  }
  if(body.action==='select_campaign') {
   const state=structuredClone(job.state),profile=state.profile,plan=profile?.campaign_plan;
   if(!profile||!plan?.campaigns.some(c=>c.id===body.campaign_id))throw new ResearchError('INVALID_CAMPAIGN','Choose a saved campaign.',400);
   if(state.stage>4||state.consumed.some(t=>JSON.parse(t)[0].startsWith('company-')))throw new ResearchError('CONFLICT','Customer research has already started for the selected campaign. Start a new project after the cache expires to change targeting.',409);
   plan.selected_ids=[body.campaign_id];const target=campaignTargets(profile,plan)[0];
   state.discovery=newDiscovery(target);state.tasks=state.tasks.filter(t=>t.stage!==4);
   state.tasks.push(...state.discovery.queries.map(value=>({stage:4,kind:'company-search' as const,value})));
   job=await writeState(state);
  }
  if(body.action==='save_companies'||body.action==='remove_companies') {
   const state=structuredClone(job.state),discovery=state.discovery;
   if(!discovery||discovery.criteria.campaign_id!==body.campaign_id)throw new ResearchError('INVALID_CAMPAIGN','Choose the researched campaign.',400);
   const domains=body.domains.map(d=>domainOf(companyUrl(d)));
   if(domains.some(d=>!discovery.results.some(c=>c.domain===d)))throw new ResearchError('INVALID_COMPANY','Only saved research results can be selected.',400);
   if(body.action==='save_companies')discovery.saved=[...new Map([...discovery.saved,...discovery.results.filter(c=>domains.includes(c.domain))].map(c=>[c.domain,c])).values()];
   else {discovery.saved=discovery.saved.filter(c=>!domains.includes(c.domain));discovery.results=discovery.results.filter(c=>!domains.includes(c.domain));state.tasks=state.tasks.filter(t=>!t.domain||!domains.includes(t.domain));domains.forEach(d=>delete state.people[d]);state.drafts=state.drafts.filter(d=>!domains.includes(d.company_domain));state.stages[3].count=discovery.results.length;state.stages[4].count=Object.values(state.people).reduce((n,p)=>n+p.results.length,0);state.stages[5].count=state.drafts.length;}
   job=await writeState(state);
  }
  if(body.action==='advance' && !job.state.paused && job.state.stage<=6 && !job.working && !Deno.env.get('CONTEXT_DEV_API_KEY')) {
   const state=structuredClone(job.state);state.paused=true;state.stages[state.stage-1].status='blocked';state.stages[state.stage-1].errors=['NOT_CONFIGURED'];
   return json(expose(await writeState(state)));
  }
  if(body.action==='advance' && !job.state.paused && job.state.stage<=6) {
   if(job.working) {
    if(Date.now()-Date.parse(job.updated_at)>120000 && job.claim_id) {
     const state=structuredClone(job.state);state.stages[state.stage-1].errors.push('INTERRUPTED_REQUEST_NOT_REPLAYED');state.stages[state.stage-1].flags.push('UNKNOWN_PAID_OUTCOME');finishStages(state,job);
     const result=await db.rpc('splee_finish',{p_job:job.id,p_owner:owner,p_claim:job.claim_id,p_state:state});if(result.error) throw new ResearchError('SAVE_FAILED','Could not recover saved progress.',503);job=result.data as Row;
    }
   } else {
    const prepared=finishStages(structuredClone(job.state),job),reserved=reserveTask(prepared);
    const claim=await db.rpc('splee_claim',{p_job:job.id,p_owner:owner,p_revision:job.revision,p_state:reserved.state});if(claim.error) throw new ResearchError('SAVE_FAILED','Could not reserve the next stage.',503);
    if(claim.data.claimed) {
     job=claim.data.job as Row;let state=reserved.state;
     if(reserved.task) {
      try { state=await executeTask(state,reserved.task,{map:u=>contextMap(u,{retries:0}),search:async q=>(await contextSearch(q,{limit:5,retries:0})).results,scrape:(u,e)=>contextScrape(u,e,{retries:0}),ai:async request=>{
       const admission=await db.rpc('splee_ai_admit',{p_job:job.id,p_owner:owner});if(admission.error||admission.data!=='admitted') throw new ResearchError('AI_LIMIT','AI usage is paused or has reached its shared daily/run limit.',429);
       return researchAI(request,`splee-${job.id}`);
      }}); } catch(e) {const code=e instanceof ResearchError?e.code:e instanceof z.ZodError?'INVALID_STRUCTURED_OUTPUT':'STAGE_FAILED';recordFailure(state,reserved.task,code);
       if(['payment_required','permission_denied','authentication_error','configuration_error'].includes(code)) await db.from('openoutfind_ai_budget').update({paused:true}).eq('id',true);
      }
     }
     finishStages(state,job);
     if(!job.claim_id) throw new ResearchError('SAVE_FAILED','Research reservation was not saved.',503);
     const finish=await db.rpc('splee_finish',{p_job:job.id,p_owner:owner,p_claim:job.claim_id,p_state:state});if(finish.error) throw new ResearchError('SAVE_FAILED','Could not save progress. Reload before continuing; do not repeat the request.',503);job=finish.data as Row;
    } else job=claim.data.job as Row;
   }
  }
  if(body.action==='export') return json({format:'autogtm.project-export',schema_version:1,exported_at:new Date().toISOString(),...expose(job)});
  return json(expose(job));
 } catch(error) {const known=error instanceof ResearchError;return json({error:{code:known?error.code:'INTERNAL_ERROR',message:known?error.message:'Research is unavailable. Saved results are preserved.'}},known?error.status:500);}
}
if(import.meta.main) Deno.serve(handler);
