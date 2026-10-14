import { useEffect, useRef, useState } from 'react';
import { peopleRequest } from '../lib/companyResearch';

export default function usePeopleDiscovery(jobId, projectId, userId, campaignId, enabled, selectionVersion) {
  const key = `${userId || ''}:${projectId || ''}:${jobId || ''}:${campaignId || ''}:${selectionVersion || 0}`;
  const current = useRef(key);
  current.current = key;
  const inFlight = useRef(null);
  const [snapshot, setSnapshot] = useState(null);
  const [failure, setFailure] = useState(null);
  const [operation, setOperation] = useState(null);
  const [revision, setRevision] = useState(0);
  const state = snapshot?.key === key ? snapshot.data : null;
  const error = failure?.key === key ? failure.error : null;
  const busy = operation === key;
  const accept = result => {
    if (result?.job_id !== jobId || result?.project_id !== projectId || result?.campaign_id !== campaignId ||
        !Array.isArray(result.results) || !['researching', 'completed', 'failed'].includes(result.status)) {
      throw new Error('The contact results do not match this project and campaign.');
    }
    if (current.current === key) setSnapshot({ key, data: result });
  };
  useEffect(() => {
    if (!enabled || !jobId || !userId || !campaignId) return;
    const controller = new AbortController();
    let active = true;
    setFailure(null);
    peopleRequest(jobId, campaignId, 'load', controller.signal).then(result => { if (active) accept(result); })
      .catch(error => { if (active && error.name !== 'AbortError') setFailure({ key, error }); });
    return () => { active = false; controller.abort(); };
  }, [key, enabled, revision]);
  const mutate = async action => {
    if (!enabled || !state || inFlight.current === key) return;
    inFlight.current = key; setOperation(key); setFailure(null);
    try { accept(await peopleRequest(jobId, campaignId, action)); }
    catch (error) {
      // Reload persisted reservations; never replay a paid request on transport failure.
      try { accept(await peopleRequest(jobId, campaignId)); } catch { /* Keep the last saved snapshot. */ }
      if (current.current === key) setFailure({ key, error });
    } finally {
      if (inFlight.current === key) inFlight.current = null;
      if (current.current === key) setOperation(null);
    }
  };
  useEffect(() => {
    if (!enabled || !state || state.status !== 'researching' || busy || error) return;
    const timer = setTimeout(() => mutate('advance'), state.working ? 5000 : 1200);
    return () => clearTimeout(timer);
  }, [key, enabled, state, busy, error]);
  return { state, ready: Boolean(state), busy, error, resume: () => mutate('resume'),
    reload: () => { setFailure(null); setRevision(value => value + 1); } };
}
