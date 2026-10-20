import { strict as assert } from 'node:assert';
import { contextSearch, contextMap, contextScrape, contextSubmit, contextBatchStatus } from './context-dev.ts';

const ok = () => Response.json({ request_id: 'test', query: 'consultants', results: [
  { url: 'https://example.com/', title: 'Consultants', description: 'Our team', extra: 'omitted' },
] });
Deno.test('Context search uses the official endpoint and returns discovery-compatible evidence', async () => {
  const result = await contextSearch('consultants', { apiKey: 'test-only', fetch: async (input, init) => {
    const req = new Request(input, init);
    assert.equal(req.url, 'https://api.context.dev/v1/web/search');
    assert.equal(req.headers.get('Authorization'), 'Bearer test-only');
    assert.deepEqual(await req.json(), { query: 'consultants', numResults: 8 });
    return ok();
  } });
  assert.deepEqual(result.results, [{ url: 'https://example.com/', title: 'Consultants', description: 'Our team' }]);
});

const extraction = { prompt: 'Only evidenced company facts.', schema: { type: 'object', properties: { name: { type: 'string' } } } };
const pageOutput = (url = 'https://company.com/') => ({ url,
  markdown: { success: true, data: 'Company makes widgets.' },
  json: { success: true, data: { name: 'Company' } }, metadata: { finalUrl: url } });
Deno.test('Context mapping uses domain and bounded URL discovery', async () => {
  const urls = await contextMap('https://company.com/about', { apiKey: 'test', fetch: async (input, init) => {
    const req = new Request(input, init), url = new URL(req.url);
    assert.equal(req.method, 'GET');
    assert.equal(url.pathname, '/v1/web/urls');
    assert.equal(url.searchParams.get('domain'), 'company.com');
    assert.equal(url.searchParams.get('maxLinks'), '100');
    assert.equal(url.searchParams.get('includeSubdomains'), 'false');
    return Response.json({ urls: [{ url: 'https://company.com/about' }] });
  } });
  assert.equal(urls[0].url, 'https://company.com/about');
});
Deno.test('Context structured scrape maps schema, evidence and redirects', async () => {
  const page = await contextScrape('https://company.com/', extraction, { apiKey: 'test', fetch: async (input, init) => {
    const req = new Request(input, init), body = await req.json();
    assert.equal(new URL(req.url).pathname, '/v1/web/scrape');
    assert.deepEqual(body.formats, { markdown: true, json: true });
    assert.deepEqual(body.jsonParams, { schema: extraction.schema, instructions: extraction.prompt });
    assert.equal(body.maxAgeMs, 86400000);
    return Response.json(pageOutput('https://other.com/'));
  } });
  assert.equal(page.metadata?.url, 'https://other.com/');
  assert.equal(page.metadata?.sourceURL, 'https://company.com/');
  assert.equal(page.markdown, 'Company makes widgets.');
  assert.deepEqual(page.json, { name: 'Company' });
});
Deno.test('Context format failures do not become invented structured evidence', async () => {
  const page = await contextScrape('https://company.com/', extraction, { apiKey: 'test', fetch: async () =>
    Response.json({ ...pageOutput(), json: { success: false, data: { name: 'Invalid' } } }) });
  assert.equal(page.json, undefined);
  assert.ok(page.markdown);
  await assert.rejects(contextScrape('https://company.com/', extraction, { apiKey: 'test', fetch: async () =>
    Response.json({ markdown: { success: false, error_code: 'WEBSITE_BLOCKED' }, json: { success: false } }) }),
    { code: 'SOURCE_RESTRICTED' });
});
Deno.test('Context batch submission reserves ten pages and uses a stable idempotency key', async () => {
  let calls = 0;
  const options = { apiKey: 'test', sleep: async () => {}, fetch: (async (input, init) => {
    const req = new Request(input, init), body = await req.json();
    assert.equal(new URL(req.url).pathname, '/v1/batch/submit');
    assert.equal(req.headers.get('Idempotency-Key'), 'research:test');
    assert.equal(body.input.mode, 'scrape');
    assert.equal(body.input.data.urls.length, 10);
    assert.equal(body.input.data.urls[9].itemId, '9');
    return ++calls === 1 ? Response.json({}, { status: 503 }) : Response.json({ id: 'batch_123' });
  }) as typeof fetch };
  const result = await contextSubmit(Array.from({ length: 10 }, (_, i) => `https://company.com/${i}`), extraction, 'research:test', options);
  assert.equal(calls, 2);
  assert.equal(result.id, 'context:batch_123');
  await assert.rejects(contextSubmit(Array(11).fill('https://company.com/'), extraction, 'research:test', options));
  assert.equal(calls, 2);
});
Deno.test('Context batch results paginate with opaque cursors, sort by itemId and retain partial successes', async () => {
  const calls: string[] = [];
  const result = await contextBatchStatus('context:batch_123', { apiKey: 'test', fetch: async (input, init) => {
    const url = new URL(new Request(input, init).url);
    calls.push(url.href);
    assert.equal(url.origin, 'https://api.context.dev');
    if (!url.pathname.endsWith('/results')) return Response.json({ status: 'completed', progress: { succeeded: 2, failed: 1 } });
    if (!url.searchParams.has('cursor')) return Response.json({ has_more: true, next_cursor: 'https://evil.example/page', data: [
      { status: 'ok', itemId: '2', url: 'https://company.com/last', result: pageOutput('https://company.com/last') },
      { status: 'error', url: 'https://company.com/failed', error_code: 'NOT_FOUND' },
    ] });
    assert.equal(url.searchParams.get('cursor'), 'https://evil.example/page');
    return Response.json({ has_more: false, data: [{ status: 'ok', itemId: '0', url: 'https://company.com/', result: pageOutput() }] });
  } });
  assert.equal(result.completed, 2);
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].metadata?.sourceURL, 'https://company.com/');
  assert.equal(calls.length, 3);
});
Deno.test('Context batch polling rejects legacy IDs without network access and bounds repeated cursors', async () => {
  let calls = 0;
  const options = { apiKey: 'test', fetch: (async (input, init) => {
    calls++;
    return Response.json(new Request(input, init).url.includes('/results')
      ? { data: [], has_more: true, next_cursor: 'same' }
      : { status: 'completed', progress: { succeeded: 0 } });
  }) as typeof fetch };
  await assert.rejects(contextBatchStatus('cccccccc-cccc-4ccc-cccc-cccccccccccc', options), { code: 'PROVIDER_CHANGED' });
  assert.equal(calls, 0);
  await assert.rejects(contextBatchStatus('context:batch_123', options), { code: 'PROVIDER_RESPONSE' });
  assert.equal(calls, 3);
});
Deno.test('Context running batches do not fetch results before completion', async () => {
  for (const state of ['queued', 'running', 'cancelling', 'failed', 'cancelled']) {
    let calls = 0;
    const result = await contextBatchStatus('context:batch_123', { apiKey: 'test', fetch: async () => {
      calls++; return Response.json({ status: state, progress: { succeeded: 1 } });
    } });
    assert.equal(calls, 1);
    assert.deepEqual(result.data, []);
    assert.equal(result.status, ['failed', 'cancelled'].includes(state) ? state : 'scraping');
  }
});
Deno.test('Context retries transient HTTP failures and honors Retry-After', async () => {
  let calls = 0;
  const waits: number[] = [];
  await contextSearch('consultants', { apiKey: 'test-only', sleep: async ms => { waits.push(ms); },
    fetch: async () => ++calls === 1 ? Response.json({}, { status: 429, headers: { 'Retry-After': '2' } })
      : calls === 2 ? Response.json({}, { status: 503 }) : ok() });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [2000, 1000]);
});
Deno.test('Context never retries validation errors or exposes raw error bodies', async () => {
  let calls = 0;
  await assert.rejects(contextSearch('consultants', { apiKey: 'test-only', fetch: async () => {
    calls++; return Response.json({ message: 'sensitive-provider-detail' }, { status: 400 });
  } }), { code: 'PROVIDER_REQUEST_REJECTED', message: 'Context.dev rejected the research request. Check the server integration configuration.' });
  assert.equal(calls, 1);
});
Deno.test('Context bounds retries and does not retry before a long Retry-After', async () => {
  for (const [status, header, expected] of [[500, '', 3], [429, '60', 1]] as const) {
    let calls = 0;
    await assert.rejects(contextSearch('consultants', { apiKey: 'test-only', sleep: async () => {}, fetch: async () => {
      calls++; return Response.json({}, { status, headers: header ? { 'Retry-After': header } : {} });
    } }));
    assert.equal(calls, expected);
  }
});
