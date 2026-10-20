import { strict as assert } from 'node:assert';
import { handler as start } from '../start-research/index.ts';
import { handler as status } from '../research-status/index.ts';
import { handler as projects } from '../research-projects/index.ts';
import { handler as competitors } from '../competitor-research/index.ts';
import { handler as campaigns } from '../campaigns/index.ts';
import type { CampaignPlan } from './campaigns-core.ts';
import type { CompetitorState } from './competitor-core.ts';
import { handler as companyDiscovery } from '../company-discovery/index.ts';
import { handler as peopleDiscovery } from '../people-discovery/index.ts';
import { AUTH_ISSUER, AUTH_PROJECT_URL } from './auth-project.ts';

const owner = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const authSubject = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';
const jobId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const rawProvider = 'batch_test123';
const provider = `context:${rawProvider}`;
const base = { id: jobId, project_id: jobId, owner_id: owner, status: 'scraping', provider_job_id: provider,
  selected_urls: ['https://company.com/'], pages_completed: 0, created_at: new Date().toISOString() };
const response = (body: unknown, code = 200) => new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json' } });
const request = (body: unknown, token = 'user-token') => new Request('https://local.test/function', {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

async function withMock(run: (calls: { url: URL; body: Record<string, unknown> | null }[]) => Promise<void>, route: (url: URL, body: Record<string, unknown> | null) => Response) {
  const original = globalThis.fetch;
  const env = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-service-key', CONTEXT_DEV_API_KEY: 'test-context-key' };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, Deno.env.get(key)]));
  const calls: { url: URL; body: Record<string, unknown> | null }[] = [];
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url, body });
    if (url.pathname === '/auth/v1/user') {
      assert.equal(url.origin, AUTH_PROJECT_URL);
      return Promise.resolve(response({ id: authSubject, email: 'user@company.com', is_anonymous: false }));
    }
    if (url.pathname === '/rest/v1/research_owners') {
      assert.equal(url.origin, env.SUPABASE_URL);
      assert.equal(body?.auth_issuer, AUTH_ISSUER);
      assert.equal(body?.auth_subject, authSubject);
      return Promise.resolve(response({ id: owner }));
    }
    return Promise.resolve(route(url, body));
  };
  try { await run(calls); }
  finally {
    globalThis.fetch = original;
    for (const [key, value] of Object.entries(previous)) value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
  }
}

Deno.test('start rejects missing authorization before making any network calls', async () => {
  await withMock(async calls => {
    const result = await start(new Request('https://local.test', { method: 'POST', body: '{}' }));
    assert.equal(result.status, 401); assert.equal(calls.length, 0);
  }, () => { throw new Error('Unexpected request'); });
});
Deno.test('start sends ten prioritized URLs with extraction and idempotency', async () => {
  await withMock(async calls => {
    const result = await start(request({ website: 'company.com', request_id: crypto.randomUUID() }));
    assert.equal(result.status, 202);
    const batch = calls.find(call => call.url.pathname === '/v1/batch/submit')?.body;
    assert.ok(batch);
    const input = batch.input as { data: { urls: { url: string }[]; formats: { json: boolean; markdown: boolean } } };
    assert.equal(input.data.urls.length, 10);
    assert.ok(input.data.urls.some(row => row.url === 'https://company.com/contact'));
    assert.equal(input.data.formats.json, true);
    assert.equal(input.data.formats.markdown, true);
    assert.equal(batch.webhook, undefined);
    const data = JSON.stringify(await result.json());
    assert.ok(!data.includes('test-context-key') && !data.includes('x-autogtm-token'));
  }, (url, body) => {
    if (url.pathname.endsWith('/autogtm_reserve_job')) {
      assert.equal(body?.p_owner, owner);
      return response({ job: { ...base, status: 'mapping', provider_job_id: null }, created: true });
    }
    if (url.pathname.endsWith('/autogtm_update_job')) return response({ ...base, status: body?.p_status });
    if (url.pathname === '/v1/web/urls') return response({ success: true, urls: ['about', 'pricing', 'contact', ...Array.from({ length: 20 }, (_, i) => `products/${i}`)].map(path => ({ url: `https://company.com/${path}` })) });
    if (url.pathname === '/v1/batch/submit') return response({ id: rawProvider, status: 'queued' });
    throw new Error(`Unexpected ${url.pathname}`);
  });
});
Deno.test('duplicate request reuses job without calling Context.dev', async () => {
  await withMock(async calls => {
    const result = await start(request({ website: 'company.com', request_id: crypto.randomUUID() }));
    assert.equal(result.status, 200);
    assert.ok(!calls.some(call => call.url.hostname === 'api.context.dev'));
  }, () => response({ job: base, created: false }));
});
Deno.test('status and project listing filter by the mapped owner', async () => {
  await withMock(async calls => {
    const result = await status(request({ job_id: jobId }));
    assert.equal(result.status, 404);
    const list = await projects(request({ domain: 'company.com', owner_id: authSubject }));
    assert.equal(list.status, 200);
    assert.deepEqual(await list.json(), { projects: [] });
    assert.ok(!calls.some(call => call.url.hostname === 'api.context.dev'));
  }, url => {
    assert.equal(url.searchParams.get('owner_id'), `eq.${owner}`);
    if (url.pathname.endsWith('/projects')) {
      assert.equal(url.searchParams.get('domain'), 'eq.company.com');
      return response([]);
    }
    return response(null);
  });
});
const initialCompetitors = (): CompetitorState => ({ status: 'pending', version: 0, queries: [], searches_used: 0,
  candidates: [], results: [], warnings: [], batch_attempted: false, provider_job_id: null, pages_completed: 0 });
const competitorProfile = (state: CompetitorState) => ({ job_id: jobId, project_id: jobId, owner_id: owner,
  company_name: 'Company', business_description: 'English vocabulary learning games',
  products: [{ name: 'English vocabulary games' }], customers: [{ name: 'ESL students' }],
  source_urls: ['https://company.com/'], competitor_research: state });

Deno.test('authenticated status saves Context batch facts and never trusts client profile data', async () => {
  let saved = false;
  await withMock(async () => {
    const result = await status(request({ job_id: jobId, profile: { company_name: 'Fake' } }));
    assert.equal(result.status, 200);
    assert.equal(saved, true);
    assert.equal((await result.json()).job.status, 'completed');
  }, (url, body) => {
    if (url.pathname.endsWith('/research_jobs')) {
      assert.equal(url.searchParams.get('owner_id'), `eq.${owner}`);
      return response(base);
    }
    if (url.pathname === `/v1/batch/${rawProvider}`) return response({ status: 'completed', progress: { succeeded: 1, failed: 0 } });
    if (url.pathname === `/v1/batch/${rawProvider}/results`) return response({ has_more: false, data: [{
      status: 'ok', itemId: '0', url: 'https://company.com/', result: { url: 'https://company.com/',
        json: { success: true, data: { company_name: 'Actual', business_description: 'Makes widgets' } } },
    }] });
    if (url.pathname.endsWith('/autogtm_update_job')) {
      assert.equal((body?.p_profile as { company_name: string }).company_name, 'Actual');
      saved = true;
      return response({ ...base, status: 'completed' });
    }
    if (url.pathname.endsWith('/projects')) return response({ id: jobId });
    if (url.pathname.endsWith('/company_profiles')) return response({ company_name: 'Actual' });
    if (url.pathname.endsWith('/job_events')) return response([]);
    throw new Error(`Unexpected ${url.pathname}`);
  });
});
Deno.test('legacy unfinished batches fail explicitly without contacting Context', async () => {
  await withMock(async calls => {
    const result = await status(request({ job_id: jobId }));
    assert.equal(result.status, 200);
    assert.equal((await result.json()).job.status, 'failed');
    assert.ok(!calls.some(call => call.url.hostname === 'api.context.dev'));
  }, (url, body) => {
    if (url.pathname.endsWith('/research_jobs')) return response({ ...base, provider_job_id: 'cccccccc-cccc-4ccc-cccc-cccccccccccc' });
    if (url.pathname.endsWith('/autogtm_update_job')) {
      assert.equal(body?.p_error_code, 'PROVIDER_CHANGED');
      return response({ ...base, status: 'failed' });
    }
    if (url.pathname.endsWith('/projects')) return response({ id: jobId });
    if (url.pathname.endsWith('/company_profiles')) return response(null);
    if (url.pathname.endsWith('/job_events')) return response([]);
    throw new Error(`Unexpected ${url.pathname}`);
  });
});
Deno.test('company and people discovery require auth and ownership before Context requests', async () => {
  await withMock(async calls => {
    for (const handler of [companyDiscovery, peopleDiscovery]) {
      assert.equal((await handler(new Request('https://local.test', { method: 'POST', body: '{}' }))).status, 401);
      assert.equal((await handler(request({ job_id: jobId, campaign_id: jobId, data_version: 2 }))).status, 404);
    }
    assert.ok(!calls.some(call => call.url.hostname === 'api.context.dev'));
  }, url => {
    assert.equal(url.searchParams.get('owner_id'), `eq.${owner}`);
    return response(null);
  });
});

Deno.test('campaign CRUD persists selection, isolates owners, rejects stale writes and performs no provider requests', async () => {
  let plan: CampaignPlan | null = null;
  const foreignJob = crypto.randomUUID();
  const ownProfile = { ...competitorProfile({ ...initialCompetitors(), status: 'completed' }), campaign_plan: plan };
  await withMock(async calls => {
    assert.equal((await campaigns(new Request('https://local.test', { method: 'POST', body: '{}' }))).status, 401);
    assert.equal((await campaigns(request({ job_id: foreignJob }))).status, 404);
    const loaded = await campaigns(request({ job_id: jobId }));
    assert.equal(loaded.status, 200);
    const initial = await loaded.json();
    assert.ok(initial.plan.campaigns.length >= 4);
    const originalVersion = initial.plan.version;
    const id = crypto.randomUUID();
    const campaign = { name: 'Tutors in Brazil', target_audience: 'Private English tutors', target_industry: 'Education',
      ideal_customer: 'Independent tutors seeking English vocabulary practice between lessons.', keywords: ['English tutor'],
      target_locations: ['Brazil'], reasoning: 'A user-selected test market.' };
    const added = await (await campaigns(request({ job_id: jobId, action: 'create', version: originalVersion, campaign_id: id, campaign }))).json();
    assert.ok(added.plan.campaigns.some((c: { id: string }) => c.id === id));
    assert.equal((await campaigns(request({ job_id: jobId, action: 'update', version: originalVersion, campaign_id: id, campaign }))).status, 409);
    const updated = await (await campaigns(request({ job_id: jobId, action: 'update', version: added.plan.version, campaign_id: id,
      campaign: { ...campaign, name: 'Brazil tutors' } }))).json();
    const selected = await (await campaigns(request({ job_id: jobId, action: 'select', version: updated.plan.version, selected_ids: [id] }))).json();
    assert.equal(selected.targets.length, 1);
    assert.equal(selected.targets[0].name, 'Brazil tutors');
    assert.deepEqual(selected.targets[0].locations, ['Brazil']);
    assert.equal((await campaigns(request({ job_id: jobId, action: 'select', version: selected.plan.version, selected_ids: [foreignJob] }))).status, 400);
    const removed = await (await campaigns(request({ job_id: jobId, action: 'delete', version: selected.plan.version, campaign_id: id }))).json();
    assert.ok(!removed.plan.campaigns.some((c: { id: string }) => c.id === id));
    assert.deepEqual(removed.targets, []);
    const refreshed = await (await campaigns(request({ job_id: jobId }))).json();
    assert.equal(refreshed.plan.version, removed.plan.version);
    assert.deepEqual(refreshed.plan, removed.plan);
    assert.ok(!calls.some(call => call.url.hostname === 'api.context.dev'));
  }, (url, body) => {
    if (url.pathname.endsWith('/company_profiles')) {
      assert.equal(url.searchParams.get('owner_id'), `eq.${owner}`);
      return response(url.searchParams.get('job_id') === `eq.${foreignJob}` ? null : { ...ownProfile, campaign_plan: plan });
    }
    if (url.pathname.endsWith('/autogtm_save_campaigns')) {
      assert.equal(body?.p_owner, owner);
      if (body?.p_version !== (plan?.version || 0)) return response({ applied: false, plan });
      plan = { ...(body?.p_plan as CampaignPlan), version: (plan?.version || 0) + 1 };
      return response({ applied: true, plan });
    }
    throw new Error(`Unexpected ${url.pathname}`);
  });
});

Deno.test('competitor endpoint enforces auth and owner before any Context.dev calls', async () => {
  await withMock(async calls => {
    assert.equal((await competitors(new Request('https://local.test', { method: 'POST', body: '{}' }))).status, 401);
    assert.equal((await competitors(request({ job_id: jobId, owner_id: owner }))).status, 404);
    assert.ok(!calls.some(call => call.url.hostname === 'api.context.dev'));
  }, url => {
    assert.equal(url.searchParams.get('owner_id'), `eq.${owner}`);
    return response(null);
  });
});

Deno.test('competitors reserve at most three searches and one ten-page batch across duplicate requests and refresh', async () => {
  let state = initialCompetitors();
  await withMock(async calls => {
    const simultaneous = await Promise.all([competitors(request({ job_id: jobId })), competitors(request({ job_id: jobId }))]);
    assert.ok(simultaneous.every(res => res.status === 200));
    for (let i = 0; i < 4; i++) assert.equal((await competitors(request({ job_id: jobId }))).status, 200);
    const batch = calls.find(call => call.url.pathname === '/v1/batch/submit')?.body;
    assert.ok(batch);
    assert.equal((batch.input as { data: { urls: unknown[] } }).data.urls.length, 10);
    assert.equal(calls.filter(call => call.url.pathname === '/v1/web/search').length, 3);
    assert.equal(calls.filter(call => call.url.pathname === '/v1/batch/submit').length, 1);
    assert.equal(state.status, 'completed');
    assert.equal(state.results.length, 1);
    const before = calls.filter(call => call.url.hostname === 'api.context.dev').length;
    const saved = await competitors(request({ job_id: jobId, retry: true }));
    const serialized = JSON.stringify(await saved.json());
    assert.ok(serialized.includes('rival0.com'));
    assert.ok(!serialized.includes('test-context-key') && !serialized.includes('provider_job_id'));
    assert.equal(calls.filter(call => call.url.hostname === 'api.context.dev').length, before);
  }, (url, body) => {
    if (url.pathname.endsWith('/company_profiles')) return response(competitorProfile(state));
    if (url.pathname.endsWith('/autogtm_save_competitors')) {
      assert.equal(body?.p_owner, owner);
      if (body?.p_version !== state.version || state.status === 'completed') return response({ applied: false, state });
      state = { ...(body?.p_state as CompetitorState), version: state.version + 1, updated_at: new Date().toISOString() };
      return response({ applied: true, state });
    }
    if (url.pathname === '/v1/web/search') {
      assert.equal(body?.scrapeOptions, undefined);
      assert.equal(body?.numResults, 8);
      assert.equal(state.working, true);
      const offset = (state.searches_used - 1) * 4;
      return response({ results: Array.from({ length: 8 }, (_, i) => ({ url: `https://rival${offset + i}.com/`, title: 'English vocabulary learning games for ESL students' })) });
    }
    if (url.pathname === '/v1/batch/submit') {
      assert.equal(state.batch_attempted, true);
      assert.equal(body?.webhook, undefined);
      return response({ id: rawProvider, status: 'queued' });
    }
    if (url.pathname === `/v1/batch/${rawProvider}`) return response({ status: 'completed', progress: { succeeded: 10, failed: 0 } });
    if (url.pathname === `/v1/batch/${rawProvider}/results`) return response({ has_more: false, data: [{ status: 'ok', url: 'https://rival0.com/', result: {
      url: 'https://rival0.com/', markdown: { success: true, data: 'Rival. English vocabulary learning games for ESL students.' },
      json: { success: true, data: { is_business_website: true, company_name: 'Rival', description: { evidence_quote: 'English vocabulary learning games for ESL students' },
        products: [], customers: [{ name: 'ESL students', evidence_quote: 'English vocabulary learning games for ESL students' }], features: [], pricing: [] } },
    } }] });
    throw new Error(`Unexpected ${url.pathname}`);
  });
});

Deno.test('competitor search failures and interrupted reservations do not replay used searches', async () => {
  let state = initialCompetitors();
  await withMock(async calls => {
    await competitors(request({ job_id: jobId }));
    assert.equal(state.status, 'failed');
    await competitors(request({ job_id: jobId }));
    assert.equal(state.searches_used, 1);
    await competitors(request({ job_id: jobId, retry: true }));
    assert.equal(state.searches_used, 2);
    state = { ...state, status: 'searching', working: true, updated_at: new Date(Date.now() - 180000).toISOString() };
    await competitors(request({ job_id: jobId }));
    assert.equal(state.searches_used, 3);
    const result = await competitors(request({ job_id: jobId, retry: true }));
    assert.equal((await result.json()).research.can_retry, false);
    assert.equal(calls.filter(call => call.url.pathname === '/v1/web/search').length, 3);
    assert.ok(!calls.some(call => call.url.pathname === '/v1/batch/submit'));
  }, (url, body) => {
    if (url.pathname.endsWith('/company_profiles')) return response(competitorProfile(state));
    if (url.pathname.endsWith('/autogtm_save_competitors')) {
      state = { ...(body?.p_state as CompetitorState), version: state.version + 1, updated_at: new Date().toISOString() };
      return response({ applied: true, state });
    }
    if (url.pathname === '/v1/web/search') return response({}, 400);
    throw new Error(`Unexpected ${url.pathname}`);
  });
});
