import React, { useState, useEffect } from 'react';
import { useNavigation } from '../../context/NavigationContext';
import AutoGtmNavigation from './AutoGtmNavigation';
import AutoGtmRail from './AutoGtmRail';
import AgentActivityFeed from './AgentActivityFeed';
import PromoCreditBanner from './PromoCreditBanner';
import Step1CompanyCard from './Step1CompanyCard';
import CompetitorSkeletonCard from './CompetitorSkeletonCard';
import Step2CompetitorsCard from './Step2CompetitorsCard';
import Step3CampaignsGrid from './Step3CampaignsGrid';
import TableSkeleton from './TableSkeleton';
import Step4CompaniesTable from './Step4CompaniesTable';
import PeopleSkeleton from './PeopleSkeleton';
import Step5PeopleTable from './Step5PeopleTable';
import Step6EmailComposer from './Step6EmailComposer';
import FinalTrialModal from './FinalTrialModal';
import FinalProjectDashboard from './FinalProjectDashboard';
import CrispChatWidget from './CrispChatWidget';
import AutoGtmErrorBoundary from './AutoGtmErrorBoundary';
import { normalizeSegments, normalizeCompetitors } from '../../lib/autogtmNormalizer';
import useCompanyResearch from '../../hooks/useCompanyResearch';
import useCompetitorResearch from '../../hooks/useCompetitorResearch';
import useCampaigns from '../../hooks/useCampaigns';
import useCompanyDiscovery from '../../hooks/useCompanyDiscovery';
import usePeopleDiscovery from '../../hooks/usePeopleDiscovery';
import { campaignSegments } from '../../lib/campaigns';
import CampaignEditor from './CampaignEditor';
import ProjectJsonExport from './ProjectJsonExport';

const PHASES = [
  'research_company_loading',
  'research_company',
  'research_competitors_loading',
  'research_competitors',
  'research_segments_loading',
  'research_segments',
  'outreach_companies_loading',
  'outreach_companies',
  'outreach_people_loading',
  'outreach_people',
  'outreach_emails_loading',
  'outreach_emails',
  'final',
];

export default function AutoGtmWorkflowPage({ domain = 'keethub.lovable.app' }) {
  const { navigate } = useNavigation();
  const { data: research, error: researchError, retry: retryResearch, session } = useCompanyResearch(domain);
  const researchReady = research?.job.status === 'completed' && Boolean(research?.profile) && !researchError;
  const company = {
    name: research?.profile?.company_name || domain,
    domain,
    description: research?.profile?.business_description || research?.profile?.descriptions?.map(item => item.text).join(' ') || 'No business description was found on the researched pages.',
  };

  // Resolve initial phase from query string or default to first
  const [selectedPhase, setPhase] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const qPhase = params.get('phase');
      if (qPhase && PHASES.includes(qPhase)) return qPhase;
    }
    return 'research_company_loading';
  });
  const competitorEnabled = researchReady && PHASES.indexOf(selectedPhase) >= 2;
  const { data: competitorData, error: competitorError, retry: retryCompetitors } = useCompetitorResearch(
    research?.job.id, research?.project.id, session?.user.id, competitorEnabled,
  );
  const competitorsReady = competitorData?.status === 'completed' && !competitorError;
  const campaignsEnabled = competitorsReady && PHASES.indexOf(selectedPhase) >= 4;
  const { plan: campaignPlan, targets: campaignTargets, error: campaignError, busy: savingCampaigns, generating: generatingCampaigns,
    generationError: campaignGenerationError, generationNotice: campaignGenerationNotice, mutate: changeCampaigns, retry: retryCampaigns } = useCampaigns(
    research?.job.id, research?.project.id, session?.user.id, campaignsEnabled, PHASES.indexOf(selectedPhase) <= 5,
  );
  const campaignsReady = Boolean(campaignPlan) && !generatingCampaigns;
  const campaignsCanContinue = campaignsReady && campaignTargets.length > 0 && !savingCampaigns && !campaignError;
  const [chosenCampaignId, setChosenCampaignId] = useState(() => new URLSearchParams(window.location.search).get('campaign') || '');
  const discoveryCampaigns = campaignPlan?.campaigns || [];
  const discoveryCampaignId = discoveryCampaigns.some(c => c.id === chosenCampaignId) ? chosenCampaignId
    : campaignPlan?.selected_ids[0] || discoveryCampaigns[0]?.id || '';
  const discoveryEnabled = campaignsReady && Boolean(discoveryCampaignId) && !savingCampaigns && !campaignError && PHASES.indexOf(selectedPhase) >= 6;
  const discovery = useCompanyDiscovery(research?.job.id, research?.project.id, session?.user.id, discoveryCampaignId,
    discoveryEnabled);
  const discoveryRunning = Boolean(discovery.state && !discovery.state.criteria_changed && ['searching', 'researching'].includes(discovery.state.status));
  const companyInputs = discovery.inputs.filter(input => discoveryCampaigns.some(c => c.id === input.campaign_id));
  const companiesCanContinue = discovery.ready && discovery.state?.status === 'completed' && !discovery.state.criteria_changed &&
    discovery.state.saved.length > 0 && !discovery.busy && !discovery.error;
  const peopleEnabled = companiesCanContinue && PHASES.indexOf(selectedPhase) >= 8;
  const people = usePeopleDiscovery(research?.job.id, research?.project.id, session?.user.id, discoveryCampaignId,
    peopleEnabled, discovery.state?.version);
  const peopleCanContinue = people.ready && people.state.status === 'completed' && people.state.results.length > 0 && !people.busy && !people.error;
  // Saved phase links and manual controls wait for real results and a saved selection.
  const phase = !researchReady ? 'research_company_loading'
    : competitorEnabled && !competitorsReady ? 'research_competitors_loading'
    : campaignsEnabled && !campaignsReady ? 'research_segments_loading'
    : campaignsEnabled && PHASES.indexOf(selectedPhase) > 5 && !campaignsCanContinue ? 'research_segments'
    : PHASES.indexOf(selectedPhase) > 7 && !companiesCanContinue ? 'outreach_companies'
    : PHASES.indexOf(selectedPhase) > 9 && !peopleCanContinue ? 'outreach_people'
    : selectedPhase;
  const [peopleAnimationReady, setPeopleAnimationReady] = useState(false);
  useEffect(() => {
    setPeopleAnimationReady(false);
    if (!peopleEnabled) return;
    const timer = setTimeout(() => setPeopleAnimationReady(true), 4200);
    return () => clearTimeout(timer);
  }, [peopleEnabled, discoveryCampaignId]);
  const [discoveryAnimationReady, setDiscoveryAnimationReady] = useState(false);
  useEffect(() => {
    setDiscoveryAnimationReady(false);
    if (!discoveryEnabled) return;
    const timer = setTimeout(() => setDiscoveryAnimationReady(true), 4400);
    return () => clearTimeout(timer);
  }, [discoveryEnabled, discoveryCampaignId]);
  const [campaignAnimationReady, setCampaignAnimationReady] = useState(false);
  useEffect(() => {
    if (!campaignsEnabled) { setCampaignAnimationReady(false); return; }
    const timer = setTimeout(() => setCampaignAnimationReady(true), 4600);
    return () => clearTimeout(timer);
  }, [campaignsEnabled]);
  const [competitorAnimationReady, setCompetitorAnimationReady] = useState(false);
  useEffect(() => {
    if (!competitorEnabled) { setCompetitorAnimationReady(false); return; }
    const timer = setTimeout(() => setCompetitorAnimationReady(true), 4600);
    return () => clearTimeout(timer);
  }, [competitorEnabled]);
  const [companyAnimationReady, setCompanyAnimationReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setCompanyAnimationReady(true), 4800);
    return () => clearTimeout(timer);
  }, []);

  const [activeSegment, setActiveSegment] = useState(null);
  const [editingCampaign, setEditingCampaign] = useState(null);
  const [isTrialModalOpen, setIsTrialModalOpen] = useState(false);
  const [isAutoPlay, setIsAutoPlay] = useState(true);
  useEffect(() => {
    // Older saved plans can have no selection. Persist the first researched
    // campaign so the automatic flow never depends on a checkbox click.
    if (!isAutoPlay || !campaignsEnabled || !campaignPlan?.campaigns.length ||
        campaignPlan.selected_ids.length || savingCampaigns || campaignError || editingCampaign) return;
    changeCampaigns('select', { selected_ids: [campaignPlan.campaigns[0].id] });
  }, [isAutoPlay, campaignsEnabled, research?.job.id, campaignPlan?.version, savingCampaigns, campaignError, editingCampaign]);
  const selectDiscoveryCampaign = id => {
    setChosenCampaignId(id);
    setIsAutoPlay(true);
    const url = new URL(window.location.href);
    url.searchParams.set('campaign', id);
    window.history.replaceState({}, '', url.toString());
  };

  // Guarantee normalized data at boundary for all UI consumers
  const normalizedCampaigns = normalizeSegments(campaignSegments(campaignPlan));
  const selectCampaign = (segment) => {
    if (!campaignPlan || savingCampaigns) return;
    setActiveSegment(segment);
    const selected_ids = campaignPlan.selected_ids.includes(segment.id)
      ? campaignPlan.selected_ids.filter(id => id !== segment.id) : [...campaignPlan.selected_ids, segment.id];
    changeCampaigns('select', { selected_ids });
  };
  const normalizedCompetitors = normalizeCompetitors(competitorData?.results || []);
  const determinants = [
    ...(research?.profile?.products || []).map(item => item.description ? `${item.name}: ${item.description}` : item.name),
    company.description,
    ...(research?.profile?.customers || []).map(item => item.description ? `${item.name}: ${item.description}` : item.name),
  ].filter(Boolean).slice(0, 4);

  // Sync phase change to URL with replaceState
  const changePhase = (nextPhase, userTriggered = false) => {
    if (!researchReady && nextPhase !== 'research_company_loading') return;
    if (!competitorsReady && PHASES.indexOf(nextPhase) > 2) nextPhase = 'research_competitors_loading';
    else if (!campaignsReady && PHASES.indexOf(nextPhase) > 4) nextPhase = 'research_segments_loading';
    else if (!campaignsCanContinue && PHASES.indexOf(nextPhase) > 5) nextPhase = 'research_segments';
    else if (!companiesCanContinue && PHASES.indexOf(nextPhase) > 7) nextPhase = 'outreach_companies';
    else if (!peopleCanContinue && PHASES.indexOf(nextPhase) > 9) nextPhase = 'outreach_people';
    if (userTriggered) setIsAutoPlay(nextPhase.startsWith('research_segments') || nextPhase.startsWith('outreach_companies') || nextPhase.startsWith('outreach_people'));
    setPhase(nextPhase);

    if (typeof window !== 'undefined') {
      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.set('phase', nextPhase);
      window.history.replaceState({}, '', currentUrl.toString());
    }

    if (nextPhase === 'final') {
      setIsTrialModalOpen(true);
    }
  };

  useEffect(() => {
    // A later-phase URL must enter Phase 3, not merely render it, when the
    // saved plan has no usable campaigns. Entering it enables AI generation.
    if (campaignsEnabled && campaignsReady && !campaignError && !campaignPlan.campaigns.length &&
        PHASES.indexOf(selectedPhase) > 5) {
      changePhase('research_segments_loading');
    }
  }, [campaignsEnabled, campaignsReady, campaignError, campaignPlan?.campaigns.length, selectedPhase]);

  // Determine current numeric step (1 to 6)
  const getStepNumber = (p) => {
    if (p.startsWith('research_company')) return 1;
    if (p.startsWith('research_competitors')) return 2;
    if (p.startsWith('research_segments')) return 3;
    if (p.startsWith('outreach_companies')) return 4;
    if (p.startsWith('outreach_people')) return 5;
    if (p.startsWith('outreach_emails')) return 6;
    if (p === 'final') return 6;
    return 1;
  };

  const currentStep = getStepNumber(phase);

  // Determine which steps are completed for sidebar & rail
  const completedSteps = [];
  if (currentStep > 1 || phase === 'research_company') completedSteps.push(1);
  if (currentStep > 2 || phase === 'research_competitors') completedSteps.push(2);
  if (currentStep > 3 || phase === 'research_segments') completedSteps.push(3);
  if (companiesCanContinue) completedSteps.push(4);
  if (peopleCanContinue) completedSteps.push(5);
  if (phase === 'outreach_emails' || phase === 'final') completedSteps.push(6);

  // Auto progression timers for loading phases
  useEffect(() => {
    // Reveal real results after the original loading animation. Errors reveal
    // the existing recovery controls immediately, even when auto-play is paused.
    if (phase === 'outreach_companies_loading') {
      if (discovery.error || discovery.state?.status === 'failed' || (discovery.state?.criteria_changed && discovery.state.run >= 3) ||
          (discoveryAnimationReady && discovery.ready && !discovery.state?.criteria_changed &&
            (discovery.state?.results.length > 0 || discovery.state?.status === 'completed'))) {
        const reveal = setTimeout(() => changePhase('outreach_companies'), 0);
        return () => clearTimeout(reveal);
      }
      return;
    }
    // Manual continuation from real company results still completes the existing
    // loading animation even when the user has paused workflow auto-play.
    if (phase === 'outreach_people_loading' && companiesCanContinue) {
      if (people.error || people.state?.status === 'failed' || (peopleAnimationReady && people.ready &&
          (people.state.results.length > 0 || people.state.status === 'completed'))) {
        const handoff = setTimeout(() => changePhase('outreach_people'), 0);
        return () => clearTimeout(handoff);
      }
      return;
    }
    if (!isAutoPlay) return;

    let timer;
    if (phase === 'research_company_loading') {
      if (researchReady && companyAnimationReady) {
        timer = setTimeout(() => changePhase('research_company'), 0);
      }
    } else if (phase === 'research_company') {
      timer = setTimeout(() => changePhase('research_competitors_loading'), 3500);
    } else if (phase === 'research_competitors_loading') {
      if (competitorsReady && competitorAnimationReady) {
        timer = setTimeout(() => changePhase('research_competitors'), 0);
      }
    } else if (phase === 'research_competitors') {
      timer = setTimeout(() => changePhase('research_segments_loading'), 3500);
    } else if (phase === 'research_segments_loading') {
      if (campaignsReady && campaignAnimationReady) timer = setTimeout(() => changePhase('research_segments'), 0);
    } else if (phase === 'research_segments') {
      // Preserve the original viewing delay, then discover companies using the
      // saved campaign selection without requiring Continue or Find clicks.
      if (campaignsCanContinue && !editingCampaign && !campaignGenerationError && !campaignGenerationNotice) timer = setTimeout(() => changePhase('outreach_companies_loading'), 3500);
    } else if (phase === 'outreach_companies') {
      // Keep the original result-viewing pause, then continue only after this
      // campaign's real companies have been saved by the automatic discovery flow.
      if (companiesCanContinue && discovery.state?.status === 'completed' && !discovery.state.criteria_changed &&
          discovery.state.results.some(company => discovery.state.saved.some(saved => saved.domain === company.domain))) {
        timer = setTimeout(() => changePhase('outreach_people_loading'), 3500);
      }
    } else if (phase === 'outreach_people') {
      if (peopleCanContinue) timer = setTimeout(() => changePhase('outreach_emails_loading'), 3500);
    } else if (phase === 'outreach_emails_loading') {
      timer = setTimeout(() => changePhase('outreach_emails'), 7000);
    } else if (phase === 'outreach_emails') {
      timer = setTimeout(() => changePhase('final'), 4000);
    }

    return () => clearTimeout(timer);
  }, [phase, isAutoPlay, researchReady, companyAnimationReady, competitorsReady, competitorAnimationReady, campaignsReady, campaignsCanContinue, campaignAnimationReady, editingCampaign, companiesCanContinue,
    discoveryCampaignId, discoveryAnimationReady, discovery.ready, discovery.error, discovery.state?.status, discovery.state?.version, discovery.state?.criteria_changed,
    peopleAnimationReady, people.ready, people.error, people.state, peopleCanContinue, campaignGenerationError, campaignGenerationNotice]);

  // Jump to a step when clicked on the rail
  const handleStepClick = (step) => {
    setIsAutoPlay(false);
    if (step === 1) changePhase('research_company', true);
    if (step === 2) changePhase('research_competitors', true);
    if (step === 3) changePhase('research_segments', true);
    if (step === 4) changePhase('outreach_companies', true);
    if (step === 5) changePhase('outreach_people', true);
    if (step === 6) changePhase('outreach_emails', true);
  };

  // Step tasks matching the reference video and spec
  const WORKFLOW_STEP_TASKS = {
    1: [
      `fetching ${domain}…`,
      'reading /pricing and /about…',
      'extracting what you sell and to who…',
      'building the company profile…',
    ],
    2: [
      `listing ${domain} products…`,
      competitorData?.queries?.length ? `searching "${competitorData.queries[Math.max(0, competitorData.searches_used - 1)]}"…` : 'finding relevant search queries…',
      competitorData?.candidates_count ? `researching ${competitorData.candidates_count} candidate websites…` : 'searching for competing businesses…',
    ],
    3: [
      'analyzing value proposition…',
      'identifying buyer segments…',
      'defining ICP criteria & personas…',
    ],
    4: [
      'building search queries from campaigns…',
      `searching ${discovery.state?.searches_used || 0} of ${discovery.state?.queries.length || 3} queries…`,
      `checking ${discovery.state?.pages_attempted || 0} of ${discovery.state?.candidates_count || 0} candidate websites…`,
    ],
    5: [
      'searching company, corporate and public leadership sources…',
      `researching ${people.state?.companies_completed || 0} of ${people.state?.companies_total || discovery.state?.saved.length || 0} saved companies…`,
      'saving supported names, roles and professional sources…',
    ],
    6: [
      'picking the hottest lead…',
      'reading their company signals…',
      'drafting the first email…',
      'personalizing the opener…',
    ],
  };

  const isRunningPhase = phase.endsWith('_loading') || (currentStep === 4 && discoveryRunning && !discovery.state?.criteria_changed)
    || (currentStep === 5 && people.state?.status === 'researching' && !people.error);
  const [subtaskIndex, setSubtaskIndex] = useState(0);

  useEffect(() => {
    setSubtaskIndex(0);
  }, [phase]);

  useEffect(() => {
    if (!isRunningPhase) return;

    const tasks = WORKFLOW_STEP_TASKS[currentStep] || [];
    if (tasks.length <= 1) return;

    const interval = setInterval(() => {
      setSubtaskIndex((prev) => {
        if (prev < tasks.length - 1) return prev + 1;
        return prev;
      });
    }, 1100);

    return () => clearInterval(interval);
  }, [phase, currentStep, isRunningPhase]);

  const currentStepTasks = WORKFLOW_STEP_TASKS[currentStep] || [];
  const activeError = researchError || (currentStep === 2 ? competitorError : currentStep === 3 ? campaignError : currentStep === 4 ? discovery.error
    : currentStep === 5 ? people.error || (people.state?.error ? { message: people.state.error } : null) : null);
  const currentAgentItems = activeError ? [{ label: activeError.message, status: 'active' }] : isRunningPhase
    ? currentStepTasks.slice(0, subtaskIndex + 1).map((task, idx) => ({
        label: task,
        status: idx < subtaskIndex ? 'done' : 'active',
      }))
    : [];

  // Step 6 items derived from single source of truth (WORKFLOW_STEP_TASKS[6])
  const step6Items = currentStep === 6 && currentAgentItems.length > 0
    ? currentAgentItems
    : (WORKFLOW_STEP_TASKS[6] || []).map((task, idx) => ({
        label: task,
        status: idx < 3 ? 'done' : 'active',
      }));

  const showPromoBanner = [
    'outreach_companies_loading',
    'outreach_companies',
    'outreach_people_loading',
    'outreach_people',
    'outreach_emails_loading',
    'outreach_emails',
    'final',
  ].includes(phase);

  return (
    <AutoGtmErrorBoundary>
      <div className="flex h-dvh w-full flex-col bg-[#fbfbfb] text-[#0a0a0a] overflow-hidden font-sans md:flex-row">
        {/* Sidebar with completed context */}
        <AutoGtmNavigation
          currentPhase={phase}
          completedSteps={completedSteps}
          companyData={company}
          competitors={normalizedCompetitors}
          campaigns={normalizedCampaigns}
          activeSegment={activeSegment}
          onSelectSegment={selectCampaign}
          onRestart={() => navigate('/app-auto-gtm')}
          userEmail={session?.user.email || 'Not signed in'}
          activeAgentStep={isRunningPhase ? currentStep : null}
          activeAgentItems={currentAgentItems}
        />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-y-auto md:[scrollbar-gutter:stable] bg-[#fbfbfb] relative">
        {/* Top Header Controls / Auto-play status */}
        <div className="w-full max-w-5xl mx-auto px-4 pt-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="size-2 rounded-full bg-[#10b981] animate-pulse-dot" />
            <span className="break-all text-[11px] font-mono text-gray-500">
              Phase: <strong className="text-gray-800">{phase}</strong>
            </span>
          </div>

          <div className="flex flex-wrap items-start gap-2">
            <ProjectJsonExport jobId={research?.job.id || new URLSearchParams(window.location.search).get('job')}
              domain={domain} userId={session?.user.id} />
            <button
              type="button"
              onClick={() => setIsAutoPlay(!isAutoPlay)}
              className="text-[11px] px-2.5 py-1 rounded-md border border-black/10 bg-white text-gray-600 hover:text-gray-900 transition shadow-2xs cursor-pointer"
            >
              {isAutoPlay ? '⏸ Pause Auto-play' : '▶ Resume Auto-play'}
            </button>

            <button
              type="button"
              onClick={() => {
                if (researchError) {
                  setPhase('research_company_loading');
                  setIsAutoPlay(true);
                  retryResearch();
                  return;
                }
                if (currentStep === 2 && competitorError) {
                  setPhase('research_competitors_loading');
                  setIsAutoPlay(true);
                  retryCompetitors();
                  return;
                }
                if (currentStep === 3 && campaignError) { retryCampaigns(); return; }
                if (currentStep === 4 && discovery.error) { retryCampaigns(); discovery.reload(); return; }
                const nextIdx = (PHASES.indexOf(phase) + 1) % PHASES.length;
                changePhase(PHASES[nextIdx], true);
              }}
              disabled={(!researchReady && !researchError) || (currentStep === 2 && !competitorsReady && (!competitorError || competitorError.canRetry === false)) ||
                (currentStep === 3 && (savingCampaigns || (!campaignError && (!campaignsReady || (phase === 'research_segments' && !campaignsCanContinue))))) ||
                (currentStep === 4 && (discovery.busy || (!discovery.error && !companiesCanContinue)))}
              className="text-[11px] px-2.5 py-1 rounded-md bg-[#0d9467] text-white hover:bg-[#0a7854] transition shadow-2xs cursor-pointer"
            >
              {activeError ? (activeError.canRetry === false ? 'Research failed' : 'Retry research') : 'Next Phase →'}
            </button>
          </div>
        </div>

        {/* Promo Credit Banner in steps 4, 5, 6 */}
        {showPromoBanner && (
          <div className="pt-2 px-4">
            <PromoCreditBanner onOpenTrialModal={() => setIsTrialModalOpen(true)} />
          </div>
        )}

        {/* Top Rail (Steps 1 to 6) */}
        <AutoGtmRail
          currentStep={currentStep}
          onStepClick={handleStepClick}
        />

        {/* Dynamic Phase Stage Container */}
        <main className="flex-1 min-w-0 px-4 pb-24 flex flex-col justify-start">
          {/* Phase 1: research_company_loading */}
          {phase === 'research_company_loading' && (
            <div className="flex-1 flex flex-col items-center justify-center min-h-[55vh] space-y-2 select-none animate-card-enter">
              <div role={researchError ? 'alert' : 'status'} className="text-xs font-normal text-gray-400">{researchError ? researchError.message : 'Researching'}</div>
              <div className="max-w-full break-all text-center text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight font-mono">
                {domain}
              </div>
            </div>
          )}

          {/* Phase 2: research_company */}
          {phase === 'research_company' && (
            <Step1CompanyCard
              company={company}
              onNext={() => changePhase('research_competitors_loading', true)}
            />
          )}

          {/* Phase 3: research_competitors_loading */}
          {phase === 'research_competitors_loading' && (
            competitorError ? <Step2CompetitorsCard determinants={determinants} searchQueries={competitorData?.queries || []} error={competitorError.message} /> : <CompetitorSkeletonCard />
          )}

          {/* Phase 4: research_competitors */}
          {phase === 'research_competitors' && (
            <Step2CompetitorsCard
              determinants={determinants}
              searchQueries={competitorData?.queries || []}
              competitors={competitorData?.results || []}
              warnings={competitorData?.warnings || []}
              onRetry={!competitorData?.results.length && competitorData?.can_retry ? () => {
                setIsAutoPlay(true); changePhase('research_competitors_loading'); retryCompetitors();
              } : null}
              onNext={() => changePhase('research_segments_loading', true)}
            />
          )}

          {/* Phase 5: research_segments_loading */}
          {phase === 'research_segments_loading' && (
            campaignError ? <Step3CampaignsGrid error={campaignError.message} /> : <CompetitorSkeletonCard />
          )}

          {/* Phase 6: research_segments */}
          {phase === 'research_segments' && (
            <Step3CampaignsGrid
              segments={normalizedCampaigns}
              activeSegmentId={activeSegment?.id}
              selectedIds={campaignPlan?.selected_ids || []}
              onSelectSegment={selectCampaign}
              busy={savingCampaigns}
              error={editingCampaign ? null : campaignError?.message || campaignGenerationError}
              notice={campaignGenerationNotice}
              onRegenerate={() => { setIsAutoPlay(true); changeCampaigns('regenerate'); }}
              canContinue={campaignsCanContinue}
              onCreate={() => { setIsAutoPlay(false); setEditingCampaign({ id: crypto.randomUUID(), isNew: true }); }}
              onEdit={id => { setIsAutoPlay(false); setEditingCampaign(campaignPlan.campaigns.find(c => c.id === id)); }}
              onDelete={id => { setIsAutoPlay(false); changeCampaigns('delete', { campaign_id: id }); }}
              onNext={() => changePhase('outreach_companies_loading', true)}
            />
          )}
          {editingCampaign && phase === 'research_segments' && <CampaignEditor key={editingCampaign.id} campaign={editingCampaign}
            saving={savingCampaigns} error={campaignError?.message} onClose={() => setEditingCampaign(null)}
            onSave={async campaign => {
              if (await changeCampaigns(editingCampaign.isNew ? 'create' : 'update', { campaign_id: editingCampaign.id, campaign })) setEditingCampaign(null);
            }} />}

          {/* Original Phase 4 loading presentation while real discovery runs. */}
          {phase === 'outreach_companies_loading' && <TableSkeleton />}

          {phase === 'outreach_companies' && (
            <Step4CompaniesTable
              campaigns={discoveryCampaigns}
              campaignId={discoveryCampaignId}
              onCampaignChange={selectDiscoveryCampaign}
              discovery={{ ...discovery, inputs: companyInputs, reload: () => { retryCampaigns(); discovery.reload(); } }}
              onNext={() => changePhase('outreach_people_loading', true)}
            />
          )}

          {/* Phase 9: outreach_people_loading */}
          {phase === 'outreach_people_loading' && (
            <PeopleSkeleton />
          )}

          {/* Phase 10: outreach_people */}
          {phase === 'outreach_people' && (
            <Step5PeopleTable
              discovery={people}
              canContinue={peopleCanContinue}
              onNext={() => changePhase('outreach_emails_loading', true)}
            />
          )}

          {/* Phase 11: outreach_emails_loading */}
          {phase === 'outreach_emails_loading' && (
            <div className="space-y-4">
              <div className="max-w-md mx-auto mb-2">
                <AgentActivityFeed
                  step={6}
                  items={step6Items}
                  companyDomain={domain}
                />
              </div>
              <Step6EmailComposer
                onClaimCredits={() => setIsTrialModalOpen(true)}
                onComplete={() => changePhase('outreach_emails', true)}
              />
            </div>
          )}

          {/* Phase 12: outreach_emails */}
          {phase === 'outreach_emails' && (
            <Step6EmailComposer
              onClaimCredits={() => setIsTrialModalOpen(true)}
              onComplete={() => changePhase('final', true)}
            />
          )}

          {/* Phase 13: final */}
          {phase === 'final' && (
            <FinalProjectDashboard
              companyData={company}
              peopleDiscovery={people}
              companyDiscovery={discovery}
              campaigns={discoveryCampaigns}
              campaignId={discoveryCampaignId}
              onCampaignChange={selectDiscoveryCampaign}
              onOpenTrialModal={() => setIsTrialModalOpen(true)}
            />
          )}
        </main>

        {/* Trial Offer Modal Overlay */}
        <FinalTrialModal
          isOpen={isTrialModalOpen}
          onClose={() => setIsTrialModalOpen(false)}
          companyDomain={domain}
          userEmail={session?.user.email || 'Not signed in'}
        />

        {/* Crisp Chat Widget */}
        <CrispChatWidget />
      </div>
    </div>
  </AutoGtmErrorBoundary>
);
}
