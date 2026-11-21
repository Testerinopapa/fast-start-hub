import React, {useEffect,useState} from 'react';
import useAuthSession from '../../hooks/useAuthSession';
import {useNavigation} from '../../context/NavigationContext';
import {sixStageRequest,sixStagePath} from '../../lib/sixStageResearch';
import {campaignSegments} from '../../lib/campaigns';
import AutoGtmNavigation from './AutoGtmNavigation';
import AutoGtmRail from './AutoGtmRail';
import Step1CompanyCard from './Step1CompanyCard';
import Step2CompetitorsCard from './Step2CompetitorsCard';
import Step3CampaignsGrid from './Step3CampaignsGrid';
import Step4CompaniesTable from './Step4CompaniesTable';
import Step5PeopleTable from './Step5PeopleTable';
import GroundedEmailDrafts from './GroundedEmailDrafts';
import ResearchButton from './ResearchButton';
const phases=['research_company','research_competitors','research_segments','outreach_companies','outreach_people','outreach_emails'];
export default function SixStageWorkflow({domain}) {
 const {session,loading}=useAuthSession();const {navigate}=useNavigation();
 const id=new URLSearchParams(window.location.search).get('job');
 const [data,setData]=useState(null),[error,setError]=useState(''),[step,setStep]=useState(1),[paused,setPaused]=useState(false),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 const [follow,setFollow]=useState(true);const [projects,setProjects]=useState([]);
 useEffect(()=>{if(!session){setProjects([]);return;}let active=true;sixStageRequest('list').then(result=>{if(active)setProjects(result.projects||[]);}).catch(()=>{});return()=>{active=false;};},[session?.user.id,id]);
 useEffect(()=>{setData(null);if(loading||!session||!id)return;let active=true,timer;const controller=new AbortController();
  const poll=async(action='status')=>{
   try {const result=await sixStageRequest(action,{job_id:id},controller.signal);if(!active)return;
    if(result.job?.id!==id||result.project?.domain!==domain)throw new Error('Saved research does not match this website.');
    setData(result);setError('');if(follow)setStep(Math.min(6,result.workflow.stage));
    if(!paused&&result.workflow.workflow_status==='running')timer=setTimeout(()=>poll('advance'),10000);
   } catch(e){if(active&&e.name!=='AbortError')setError(e.message);}
  };poll();return()=>{active=false;clearTimeout(timer);controller.abort();};
 },[id,domain,session?.user.id,loading,paused,revision,follow]);
 const workflow=data?.workflow,profile=data?.profile,plan=profile?.campaign_plan,discovery=workflow?.discovery;
 const company={name:profile?.company_name||domain,domain,description:profile?.business_description||'No grounded company description is available.'};
 const reload=()=>setRevision(r=>r+1);
 const download=async()=>{setBusy(true);try {const result=await sixStageRequest('export',{job_id:id});const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`autogtm-${domain}-${id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError(e.message);}finally{setBusy(false);}};
 const people=Object.values(workflow?.people||{}).flatMap(s=>s.results.map(p=>({...p,company_research_status:'verified',relevance:{reason:'Public title and employer association supported; current employment and buyer fit require review.'}})));
 const selected=discovery?.criteria.campaign_id||plan?.selected_ids?.[0]||'';
 const companiesState=discovery?{...discovery,version:data.job.revision,removed_domains:[],candidates_count:discovery.candidates.length,criteria_changed:false,can_resume:false,working:data.job.working}:null;
 const peopleState={status:workflow?.paused?'failed':(workflow?.stage||1)>5?'completed':'researching',results:people,company_domains:Object.keys(workflow?.people||{}),companies_total:Object.keys(workflow?.people||{}).length,companies_completed:Object.values(workflow?.people||{}).filter(s=>s.status==='completed').length,warnings:workflow?.stages[4]?.flags||[],diagnostics:[]};
 const edit=async(action,values)=>{setBusy(true);try {setData(await sixStageRequest(action,{job_id:id,...values}));reload();return true;}catch(e){setError(e.message);return false;}finally{setBusy(false);}};
 const next=()=>{setFollow(false);setStep(s=>Math.min(6,s+1));};
 const viewStage=workflow?.stages[step-1];
 return <div className="flex h-dvh w-full flex-col overflow-hidden bg-[var(--card)] text-[var(--foreground)] md:flex-row">
  <AutoGtmNavigation currentPhase={phases[step-1]} completedSteps={workflow?.stages.flatMap((s,i)=>s.status==='completed'?[i+1]:[])||[]} companyData={company} competitors={workflow?.competitor.results||[]} campaigns={campaignSegments(plan)} userEmail={session?.user.email||'Not signed in'} onRestart={()=>navigate('/app-auto-gtm')}/>
  <div className="min-w-0 flex-1 overflow-y-auto">
   <header className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
    <div><h1 className="text-base font-semibold">{company.name}</h1><p role="status" className="text-xs text-[var(--muted-foreground)]">{workflow?`${workflow.workflow_status} · ${workflow.completed_stages}/6 stages completed · ${workflow.stages.map(s=>s.count).join(' / ')} results`:'Loading saved research…'}</p></div>
    <div className="flex flex-wrap gap-2"><select aria-label="Saved research projects" value={id||''} className="max-w-56 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 text-xs" onChange={event=>{const project=projects.find(p=>p.latestJob.id===event.target.value);if(project)navigate(sixStagePath(project.domain,project.latestJob.id));}}>{!projects.length&&<option value={id||''}>{domain}</option>}{projects.map(project=><option key={project.id} value={project.latestJob.id}>{project.domain}</option>)}</select><ResearchButton onClick={()=>setPaused(v=>!v)}>{paused?'Resume research':'Pause research'}</ResearchButton><ResearchButton onClick={reload}>Reload saved results</ResearchButton><ResearchButton disabled={!session||!id||busy} onClick={download}>Export project JSON</ResearchButton></div>
   </header>
   {(!loading&&!session)&&<p role="alert" className="px-4">Sign in with your existing account to view private research. <a href="/sign-in">Sign in</a></p>}
   {error&&<p role="alert" className="px-4 text-sm">{error}</p>}
   {workflow?.paused&&<div role="alert" className="mx-auto max-w-5xl px-4 py-3 text-sm">Research paused: {workflow.stages.flatMap(s=>s.errors).join(', ')}. {workflow.stages.some(s=>s.errors.includes('NOT_CONFIGURED'))?'Add CONTEXT_DEV_API_KEY in Project Settings → Secrets. Saved results remain available.':'Check the reported usage or source restriction before continuing.'}
    <ResearchButton className="ml-2" onClick={async()=>{try {setData(await sixStageRequest('resume',{job_id:id}));reload();}catch(e){setError(e.message);}}}>Continue remaining research</ResearchButton></div>}
   <AutoGtmRail currentStep={step} onStepClick={n=>{setFollow(false);setStep(n);}}/>
   <main className="px-4 pb-20">{session&&<>
    {viewStage&&<p className="mx-auto mb-4 max-w-5xl text-xs text-[var(--muted-foreground)]">Stage {step}: {viewStage.status} · {viewStage.count} results{viewStage.errors.length?` · ${viewStage.errors.join(', ')}`:''}{viewStage.flags.length?` · ${[...new Set(viewStage.flags)].join(', ')}`:''}</p>}
    {step===1&&<><Step1CompanyCard company={company} onNext={next} evidenceStatus={profile?'Website evidence found':'No website evidence yet'}/><div className="mx-auto mt-3 max-w-5xl flex flex-wrap gap-3 text-xs">{profile?.source_urls.map((url,i)=><a key={url} href={url} target="_blank" rel="noopener noreferrer" className="text-[var(--brand-700)] underline">Website evidence {i+1}</a>)}</div></>}
    {step===2&&<Step2CompetitorsCard determinants={profile?[profile.business_description,...profile.products.map(p=>p.name)].filter(Boolean):[]} competitors={workflow?.competitor.results||[]} searchQueries={workflow?.competitor.queries||[]} warnings={workflow?.stages[1]?.flags||[]} onNext={next}/>}
    {step===3&&<Step3CampaignsGrid segments={campaignSegments(plan)} selectedIds={plan?.selected_ids||[]} onSelectSegment={segment=>edit('select_campaign',{campaign_id:segment.id})} busy={busy||data?.job.working} onNext={next} notice="Targeting hypotheses; buyer fit requires public evidence."/>}
    {step===4&&<Step4CompaniesTable campaigns={plan?.campaigns||[]} campaignId={selected} onCampaignChange={campaignId=>edit('select_campaign',{campaign_id:campaignId})} discovery={{state:companiesState,ready:true,busy:workflow?.stage===4||busy||data?.job.working,inputs:discovery?.saved||[],reload,mutate:(action,values)=>edit(action==='save'?'save_companies':'remove_companies',{...values,campaign_id:selected})}} onNext={next}/>}
    {step===5&&<Step5PeopleTable discovery={{state:peopleState,ready:true,busy:workflow?.stage===5,reload,resume:reload}} canContinue={true} onNext={next}/>}
    {step===6&&<GroundedEmailDrafts drafts={workflow?.drafts||[]}/>}
   </>}</main>
  </div>
 </div>;
}
