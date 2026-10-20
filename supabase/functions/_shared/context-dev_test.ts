import { strict as assert } from 'node:assert';
import { contextSearch } from './context-dev.ts';

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
  } }), { message: 'Context.dev search is temporarily unavailable.' });
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
