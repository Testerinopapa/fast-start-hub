import { createEvidenceHandler } from './index.ts';

const endpoint = 'https://example.supabase.co/functions/v1/splee-web/v1/web/search';
const token = 'test-secret-not-a-real-key';
function request(path = endpoint, body: unknown = { query: 'public B2B companies' }, overrides: Record<string, string> = {}) {
  return new Request(path, {
    method: 'POST', headers: { authorization: 'Bearer ' + token,
      'x-explee-run-id': 'github-12345-1', 'content-type': 'application/json', ...overrides },
    body: JSON.stringify(body),
  });
}
function harness(reserveResult = 'admitted') {
  let searches = 0, pages = 0;
  const handle = createEvidenceHandler({
    token: () => token,
    reserve: async () => reserveResult,
    search: async (q) => { searches++; return { results: [{ url: 'https://calendar.example.org', title: q, description: 'Public source' }] }; },
    fetchPage: async (url) => { pages++; return { url, markdown: 'Read-only public facts' }; },
  });
  return { handle, counters: () => ({ searches, pages }) };
}

Deno.test('Splee web bridge denies missing token without contacting a provider', async () => {
  const h = harness();
  const res = await h.handle(request(endpoint, { query: 'companies' }, { authorization: 'Bearer wrong' }));
  if (res.status !== 401 || h.counters().searches !== 0) throw Error('auth check failed');
});

Deno.test('Splee web bridge allows bounded source search', async () => {
  const h = harness();
  const res = await h.handle(request());
  const payload = await res.json();
  if (res.status !== 200 || payload.results.length !== 1 || h.counters().searches !== 1) throw Error('search failed');
});

Deno.test('Splee web bridge rejects duplicate reservation without provider call', async () => {
  const h = harness('duplicate');
  const res = await h.handle(request());
  if (res.status !== 409 || h.counters().searches !== 0) throw Error('duplicate admission failed');
});

Deno.test('Splee web bridge rejects invalid tool input', async () => {
  const h = harness();
  const res = await h.handle(request(endpoint, { query: '' }));
  if (res.status !== 400 || h.counters().searches !== 0) throw Error('input validation failed');
});

Deno.test('Splee web bridge fetches only public HTTPS source URLs', async () => {
  const h = harness();
  const url = endpoint.replace('/web/search', '/web/fetch');
  const ok = await h.handle(request(url, { url: 'https://example.org/about' }));
  if (ok.status !== 200 || h.counters().pages !== 1) throw Error('fetch not handled');
  const invalid = await h.handle(request(url, { url: 'http://localhost/admin' }));
  if (invalid.status === 200 || h.counters().pages !== 1) throw Error('unsafe URL passed');
});

Deno.test('Splee web bridge does not accept GET requests', async () => {
  const h = harness();
  const res = await h.handle(new Request(endpoint));
  if (res.status !== 405) throw Error('read-only POST route missing method guard');
});
