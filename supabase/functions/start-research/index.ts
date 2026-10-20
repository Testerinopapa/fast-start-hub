import { adminClient, authenticate, endpoint, json, readBody, secret } from '../_shared/backend.ts';
import { companyUrl, domainOf, extractionFormat, isUuid, ResearchError, selectPages } from '../_shared/research-core.ts';
import { contextMap, contextSubmit } from '../_shared/context-dev.ts';
import { type Job, updateJob } from '../_shared/jobs.ts';

export const handler = endpoint(async (req) => {
  const db = adminClient();
  const { ownerId } = await authenticate(req, db);
  const body = await readBody(req);
  const website = companyUrl(body.website);
  website.pathname = '/';
  if (!isUuid(body.request_id)) throw new ResearchError('INVALID_REQUEST', 'A unique request ID is required.');
  secret('CONTEXT_DEV_API_KEY'); // Check availability before reserving a job; never return the value.
  const { data, error } = await db.rpc('autogtm_reserve_job', {
    p_owner: ownerId, p_domain: domainOf(website), p_url: website.href, p_request: body.request_id,
  });
  if (error) {
    if (error.message.includes('DAILY_LIMIT')) throw new ResearchError('DAILY_LIMIT', 'You can start up to five research jobs in 24 hours.', 429);
    if (error.message.includes('REQUEST_CONFLICT')) throw new ResearchError('REQUEST_CONFLICT', 'This request belongs to another website.', 409);
    throw new ResearchError('DATABASE_UNAVAILABLE', 'Could not create the project. Confirm the research backend is deployed.', 503);
  }
  const job = data.job as Job;
  if (!data.created) return json({ job }, 200);
  let submitted = false;
  try {
    let links: { url?: string }[] = [];
    try {
      links = await contextMap(website.href);
    } catch (error) {
      if (!(error instanceof ResearchError) || !['PROVIDER_UNAVAILABLE', 'PROVIDER_RESPONSE'].includes(error.code)) throw error;
      // Discovery can fail independently; the homepage is still useful evidence.
    }
    const urls = selectPages(website.href, links);
    await updateJob(db, job.id, 'mapping', { p_urls: urls });
    submitted = true;
    const batch = await contextSubmit(urls, extractionFormat, `research:${job.id}`);
    const started = await updateJob(db, job.id, 'scraping', { p_provider: batch.id });
    return json({ job: started }, 202);
  } catch (error) {
    const known = error instanceof ResearchError;
    // A timeout after POST may still have created a paid provider job. Do not submit again.
    // Do not automatically resubmit a batch whose confirmation was lost.
    if (submitted && (!known || ['PROVIDER_UNAVAILABLE', 'PROVIDER_RESPONSE', 'SAVE_FAILED'].includes(error.code))) {
      return json({ job, warning: 'Context.dev submission confirmation was lost. Check provider activity before starting another job.' }, 202);
    }
    await updateJob(db, job.id, 'failed', { p_error_code: known ? error.code : 'START_FAILED',
      p_error_message: known ? error.message : 'Could not start company research.' });
    throw error;
  }
});
if (import.meta.main) Deno.serve(handler);
