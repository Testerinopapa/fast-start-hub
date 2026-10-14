import { type Admin } from './backend.ts';
import { isUuid, ResearchError } from './research-core.ts';

const pick = (row: Record<string, unknown>, fields: string[]) => Object.fromEntries(
  fields.filter(field => Object.hasOwn(row, field)).map(field => [field, row[field]]),
);

// Read saved records directly. Status/load endpoints can advance research or
// upgrade cached jobs, so an export must not call them.
export async function exportProject(db: Admin, ownerId: string, jobId: unknown) {
  if (!isUuid(jobId)) throw new ResearchError('INVALID_REQUEST', 'A saved research job is required for export.');
  const { data: job, error: jobError } = await db.from('research_jobs').select('*')
    .eq('id', jobId).eq('owner_id', ownerId).maybeSingle();
  if (jobError) throw new ResearchError('DATABASE_UNAVAILABLE', 'Could not read the saved research job for export.', 503);
  if (!job) throw new ResearchError('NOT_FOUND', 'This research job was not found in your projects.', 404);

  const [projectResult, profileResult, eventsResult] = await Promise.all([
    db.from('projects').select('*').eq('id', job.project_id).eq('owner_id', ownerId).maybeSingle(),
    db.from('company_profiles').select('*').eq('job_id', jobId).eq('project_id', job.project_id).eq('owner_id', ownerId).maybeSingle(),
    db.from('job_events').select('id, job_id, project_id, status, message, pages_completed, created_at')
      .eq('job_id', jobId).eq('project_id', job.project_id).eq('owner_id', ownerId).order('id', { ascending: false }).limit(1001),
  ]);
  if (projectResult.error || profileResult.error || eventsResult.error || !projectResult.data) {
    throw new ResearchError('DATABASE_UNAVAILABLE', 'Could not export all saved project records. Please try again.', 503);
  }
  const profile = profileResult.data;
  const events = eventsResult.data || [];
  return {
    format: 'autogtm.project-export', schema_version: 1, exported_at: new Date().toISOString(),
    scope: {
      research_job_id: jobId, saved_results_only: true,
      notes: [
        'Contains the selected research job and all of its saved campaigns and discovery results, not other research jobs for this website.',
        'Missing stages are absent or null; unfinished stages retain their saved status. No research was started or retried for this export.',
        'Project-level campaign_generation identifies the job used by the latest generation attempt, which may differ from this exported job.',
        'Records were read independently; a workflow running in another tab may change them during export.',
        'Includes saved diagnostics only, not Edge Function console logs or raw provider responses.',
      ],
    },
    // Explicit allowlists keep auth identities and future unrelated columns out.
    project: pick(projectResult.data, ['id', 'domain', 'website_url', 'created_at', 'updated_at', 'campaign_generation']),
    job: pick(job, ['id', 'project_id', 'status', 'provider_job_id', 'selected_urls', 'pages_completed',
      'error_code', 'error_message', 'created_at', 'updated_at', 'finished_at']),
    profile: profile ? pick(profile, ['id', 'project_id', 'job_id', 'company_name', 'business_description',
      'descriptions', 'products', 'customers', 'locations', 'source_urls', 'warnings', 'created_at',
      'competitor_research', 'campaign_plan', 'company_discovery', 'people_discovery']) : null,
    events: events.slice(0, 1000).reverse(),
    events_truncated: events.length > 1000,
  };
}
