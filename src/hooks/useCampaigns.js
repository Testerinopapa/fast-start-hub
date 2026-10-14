import { useEffect, useRef, useState } from 'react';
import { campaignRequest } from '../lib/companyResearch';
import { withoutCampaignTemplates } from '../lib/campaigns';

export default function useCampaigns(jobId, projectId, userId, enabled, allowAutomatic = false) {
  const key = `${userId || ''}:${projectId || ''}:${jobId || ''}`;
  const currentKey = useRef(key);
  currentKey.current = key;
  const [snapshot, setSnapshot] = useState(null);
  const [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [loadingKey, setLoadingKey] = useState(null);
  const saving = useRef(false);
  const [revision, setRevision] = useState(0);
  const accept = (result) => {
    if (result?.job_id !== jobId || result?.project_id !== projectId || !Array.isArray(result?.plan?.campaigns) ||
        !Array.isArray(result?.plan?.selected_ids) || !Array.isArray(result?.targets)) {
      throw new Error('The saved campaigns do not match this project.');
    }
    const plan = withoutCampaignTemplates(result.plan);
    const targets = result.targets.filter(target => plan.selected_ids.includes(target.campaign_id));
    if (currentKey.current === key) setSnapshot(previous => {
      if (previous?.key === key && (previous.plan.version > result.plan.version ||
          (previous.generation?.attempts || 0) > (result.generation?.attempts || 0) ||
          (previous.generation?.request_id === result.generation?.request_id && previous.generation?.status !== 'running' && result.generation?.status === 'running'))) return previous;
      return { key, ...result, plan, targets };
    });
  };
  useEffect(() => {
    if (!enabled || !jobId || !userId) return;
    let active = true;
    const controller = new AbortController();
    setFailure(null);
    setLoadingKey(key);
    campaignRequest(jobId, 'load', { auto_generate: allowAutomatic }, controller.signal).then(result => {
      if (active) accept(result);
    }).catch(error => {
      if (active && error.name !== 'AbortError') setFailure({ key, error });
    }).finally(() => {
      if (active) setLoadingKey(null);
    });
    return () => { active = false; controller.abort(); };
  }, [key, enabled, revision, allowAutomatic]);
  useEffect(() => {
    if (!enabled || snapshot?.key !== key || snapshot.generation?.status !== 'running' || busy || failure?.key === key) return;
    const timer = setTimeout(() => setRevision(value => value + 1), 3000);
    return () => clearTimeout(timer);
  }, [key, enabled, snapshot, busy, failure]);
  const mutate = async (action, values) => {
    if (saving.current || !snapshot || snapshot.key !== key) return false;
    saving.current = true; setBusy(true); setRegenerating(action === 'regenerate'); setFailure(null);
    try {
      const result = await campaignRequest(jobId, action, { ...values, version: snapshot.plan.version,
        ...(action === 'regenerate' ? { request_id: crypto.randomUUID() } : {}) });
      accept(result);
      return true;
    } catch (error) {
      // Load saved reservations; never replay an explicit model request after an ambiguous response.
      try { accept(await campaignRequest(jobId)); } catch { /* Keep the last saved view and original error. */ }
      if (currentKey.current === key) setFailure({ key, error });
      return false;
    } finally { saving.current = false; if (currentKey.current === key) { setBusy(false); setRegenerating(false); } }
  };
  return {
    plan: snapshot && snapshot.key === key ? snapshot.plan : null,
    targets: snapshot && snapshot.key === key ? snapshot.targets : [],
    error: failure && failure.key === key ? failure.error : null,
    generating: regenerating || (allowAutomatic && loadingKey === key) || (snapshot?.key === key && snapshot.generation?.status === 'running'),
    generationError: snapshot?.key === key ? snapshot.generation_error : null,
    generationNotice: snapshot?.key === key ? snapshot.generation_notice : null,
    busy: busy || (allowAutomatic && loadingKey === key) || (snapshot?.key === key && snapshot.generation?.status === 'running'), mutate, retry: () => setRevision(value => value + 1),
  };
}
