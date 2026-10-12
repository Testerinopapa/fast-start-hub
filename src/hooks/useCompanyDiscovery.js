import { useEffect, useRef, useState } from 'react';
import { discoveryRequest } from '../lib/companyResearch';

export default function useCompanyDiscovery(jobId, projectId, userId, campaignId, enabled) {
  const key = `${userId || ''}:${projectId || ''}:${jobId || ''}`;
  const currentKey = useRef(key);
  currentKey.current = key;
  const inFlight = useRef(null);
  const [snapshot, setSnapshot] = useState(null);
  const [failure, setFailure] = useState(null);
  const [operation, setOperation] = useState(null);
  const [revision, setRevision] = useState(0);
  const data = snapshot?.key === key ? snapshot : null;
  const state = data?.discoveries?.[campaignId] || null;
  const error = failure?.key === key && (!failure.campaignId || failure.campaignId === campaignId) ? failure.error : null;
  const busy = operation?.key === key;
  const accept = result => {
    if (result?.job_id !== jobId || result?.project_id !== projectId || !result.discoveries || typeof result.discoveries !== 'object' || Array.isArray(result.discoveries)) {
      throw new Error('The company results do not match this project.');
    }
    for (const value of Object.values(result.discoveries)) {
      if (!value || !Array.isArray(value.results) || !Array.isArray(value.saved) || !Array.isArray(value.removed_domains)) throw new Error('Could not read the saved company results.');
    }
    if (currentKey.current === key) setSnapshot(previous => {
      const discoveries = Object.fromEntries(Object.entries(result.discoveries).map(([id, value]) => [id,
        previous?.key === key && previous.discoveries[id]?.version > value.version ? previous.discoveries[id] : value]));
      return { key, discoveries };
    });
  };
  useEffect(() => {
    if (!enabled || !jobId || !userId) return;
    let active = true;
    const controller = new AbortController();
    setFailure(null);
    discoveryRequest(jobId, 'load', {}, controller.signal).then(result => {
      if (active) accept(result);
    }).catch(error => {
      if (active && error.name !== 'AbortError') setFailure({ key, error });
    });
    return () => { active = false; controller.abort(); };
  }, [key, enabled, revision]);

  const mutate = async (action, values = {}) => {
    if (!enabled || !data || !campaignId || inFlight.current?.key === key) return false;
    const request = { key, campaignId };
    inFlight.current = request; setOperation(request); setFailure(null);
    try {
      accept(await discoveryRequest(jobId, action, { ...values, campaign_id: campaignId, version: state?.version || 0 }));
      return true;
    } catch (error) {
      // Recover only with a read. Never replay an ambiguous paid request or write.
      try { accept(await discoveryRequest(jobId)); } catch { /* Retain last saved results. */ }
      if (currentKey.current === key) setFailure({ key, campaignId, error });
      return false;
    } finally {
      if (inFlight.current === request) inFlight.current = null;
      if (currentKey.current === key) setOperation(null);
    }
  };
  useEffect(() => {
    if (!enabled || !state || state.criteria_changed || error || busy || !['searching', 'researching'].includes(state.status)) return;
    const timer = setTimeout(() => mutate('advance'), state.working ? 5000 : 1200);
    return () => clearTimeout(timer);
  }, [key, campaignId, enabled, state?.version, state?.criteria_changed, error, busy]);

  const inputs = Object.entries(data?.discoveries || {}).flatMap(([id, discovery]) => discovery.saved.map(company => ({
    job_id: jobId, project_id: projectId, campaign_id: id, campaign_name: discovery.criteria.name,
    company, targeting: company.matched_criteria,
  })));
  return { state, inputs, ready: Boolean(data), busy, error, mutate, reload: () => { setFailure(null); setRevision(value => value + 1); } };
}
