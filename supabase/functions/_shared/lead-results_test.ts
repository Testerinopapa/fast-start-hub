import { createLeadResultsHandler, type LeadDeps, sha256Hex } from './lead-results.ts';
const eq = (a: unknown, b: unknown, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const TOKEN = 'proxy-token-for-tests';
const CODE = 'A'.repeat(32);
const lead = (o: Record<string, unknown> = {}) => ({ lead_id: 'x1', person_name: 'Synthetic Person', title: 'Head of Ops', company: 'Synthetic Co', company_website: 'https://synthetic.test', professional_profile: 'https://www.linkedin.com/in/synthetic', qualification_reason: 'Hypothesis only', qualified_at: null, email: null, checks: { provider_profile: 'returned_by_openoutfind', company_employment: 'not_independently_verified', campaign_fit: 'llm_assessed_not_verified', email: 'not_requested' }, needs_review: false, ...o });
const report = (leads = [lead()]) => ({ schema_version: 'explee.openoutfind.leads.v1', campaign: { campaign_name: 'C' }, summary: { independently_verified_people: 0, email_purchases: 0, outreach_sent: 0 }, leads });
const ingestBody = (o: Record<string, unknown> = {}) => ({ action: 'ingest', import_code: CODE, repository: 'Testerinopapa/fast-start-hub', run_id: '123', run_attempt: '1', report: report(), ...o });

function setup() {
  const calls: Record<string, unknown[]> = { ownerId: [], ingest: [], review: [], storeCode: [], list: [] };
  const deps: LeadDeps = {
    proxyToken: () => TOKEN, repository: () => 'Testerinopapa/fast-start-hub',
    verifyUser: async (jwt) => jwt === 'user-a' ? { issuer: 'iss', subject: 'a' } : jwt === 'user-b' ? { issuer: 'iss', subject: 'b' } : null,
    ownerId: async (i) => { calls.ownerId.push(i); return `owner-${i.subject}`; },
    activeCodes: async () => 0,
    storeCode: async (...a) => { calls.storeCode.push(a); },
    list: async (o) => { calls.list.push(o); return { leads: [], runs: [] }; },
    review: async (o, id, f) => { calls.review.push([o, id, f]); return o === 'owner-a'; },
    ingest: async (...a) => { calls.ingest.push(a); return { status: 'imported', new_sightings: 1, already_imported: 0 }; },
    random: (n) => new Uint8Array(n).fill(7), now: () => new Date('2026-11-20T00:00:00Z'),
  };
  const h = createLeadResultsHandler(deps);
  const call = async (body: unknown, auth?: string) => { const r = await h(new Request('http://x', { method: 'POST', headers: auth ? { Authorization: `Bearer ${auth}` } : {}, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
  return { calls, call };
}

Deno.test('anonymous, invalid and proxy-token callers cannot use browser actions', async () => {
  const { call, calls } = setup();
  for (const auth of [undefined, 'bogus', TOKEN]) for (const action of ['list', 'create_import_code']) eq((await call({ action }, auth)).status, 401, `${action}/${auth}`);
  eq(calls.list.length, 0);
});
Deno.test('forged owner claims in the body are ignored or rejected', async () => {
  const { call, calls } = setup();
  eq((await call({ action: 'list', owner_id: 'owner-b' }, 'user-a')).status, 400);
  eq((await call({ action: 'list' }, 'user-a')).status, 200);
  eq(calls.list, ['owner-a']);
  eq((await call({ action: 'review', lead_id: crypto.randomUUID(), review_status: 'rejected', manual_score: 5, manual_notes: null, evidence_url: null, user_id: 'b' }, 'user-a')).status, 400);
});
Deno.test('cross-account review of another owner\'s lead is not found', async () => {
  const { call } = setup();
  const b = { action: 'review', lead_id: crypto.randomUUID(), review_status: 'rejected', manual_score: 10, manual_notes: null, evidence_url: null };
  eq((await call(b, 'user-b')).status, 404);
  eq((await call(b, 'user-a')).status, 200);
});
Deno.test('verified requires https evidence; review time is recorded server-side; score 0-100', async () => {
  const { call, calls } = setup();
  const base = { action: 'review', lead_id: crypto.randomUUID(), manual_notes: null };
  eq((await call({ ...base, review_status: 'verified', manual_score: 90, evidence_url: null }, 'user-a')).status, 400);
  eq((await call({ ...base, review_status: 'verified', manual_score: 90, evidence_url: 'javascript:alert(1)' }, 'user-a')).status, 400);
  eq((await call({ ...base, review_status: 'rejected', manual_score: 101, evidence_url: null }, 'user-a')).status, 400);
  const ok = await call({ ...base, review_status: 'verified', manual_score: 90, evidence_url: 'https://source.test/page' }, 'user-a');
  eq(ok.body.reviewed_at, '2026-11-20T00:00:00.000Z');
  eq(((calls.review[0] as unknown[])[2] as { reviewed_at: string }).reviewed_at, '2026-11-20T00:00:00.000Z');
});
Deno.test('import code is random, returned once and only its hash is stored with a 2 hour expiry', async () => {
  const { call, calls } = setup();
  const r = await call({ action: 'create_import_code' }, 'user-a');
  eq(r.status, 200);
  const [owner, hash, exp] = calls.storeCode[0] as [string, string, Date];
  eq(owner, 'owner-a'); eq(hash, await sha256Hex(r.body.import_code)); eq(exp.toISOString(), '2026-11-20T02:00:00.000Z');
  if (r.body.import_code.length < 32 || JSON.stringify(calls).includes(r.body.import_code)) throw new Error('code stored or too short');
});
Deno.test('ingest needs the server bearer AND the code; code alone or a user session is rejected', async () => {
  const { call, calls } = setup();
  eq((await call(ingestBody())).status, 401);
  eq((await call(ingestBody(), 'user-a')).status, 401);
  eq((await call(ingestBody(), 'wrong')).status, 401);
  eq((await call(ingestBody({ import_code: undefined }), TOKEN)).status, 400);
  eq((await call(ingestBody({ repository: 'attacker/fork' }), TOKEN)).status, 403);
  eq(calls.ingest.length, 0);
  const ok = await call(ingestBody(), TOKEN);
  eq(ok.status, 200);
  const [hash, run] = calls.ingest[0] as [string, string];
  eq(hash, await sha256Hex(CODE)); eq(run, 'github-123');
});
Deno.test('ingest rejects emails, phones, untrusted URLs, verification claims and oversized batches', async () => {
  const { call, calls } = setup();
  const bad = [
    lead({ email: 'a@b.com' }), lead({ qualification_reason: 'mail me a@b.com' }), lead({ title: 'Call +1 415 555 0100' }),
    lead({ professional_profile: 'javascript:alert(1)' }), lead({ professional_profile: 'https://evil.test/in/x' }),
    lead({ company_website: 'ftp://x.test' }),
    lead({ checks: { provider_profile: 'returned_by_openoutfind', company_employment: 'verified', campaign_fit: 'llm_assessed_not_verified', email: 'not_requested' } }),
    lead({ extra: 'field' }),
  ];
  for (const l of bad) eq((await call(ingestBody({ report: report([l]) }), TOKEN)).status, 400, JSON.stringify(l).slice(0, 80));
  eq((await call(ingestBody({ report: report(Array.from({ length: 26 }, () => lead())) }), TOKEN)).status, 400);
  eq((await call(ingestBody({ report: { ...report(), summary: { independently_verified_people: 3, email_purchases: 0, outreach_sent: 0 } } }), TOKEN)).status, 400);
  eq(calls.ingest.length, 0);
});
Deno.test('code failures map to clear non-sensitive errors', async () => {
  for (const [status, http] of [['code_used', 409], ['code_expired', 410], ['invalid_code', 403]] as const) {
    const s = setup();
    const h = createLeadResultsHandler({ ...({} as LeadDeps), proxyToken: () => TOKEN, repository: () => 'Testerinopapa/fast-start-hub', ingest: async () => ({ status }) } as LeadDeps);
    const r = await h(new Request('http://x', { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(ingestBody()) }));
    const body = await r.text(); eq(r.status, http);
    if (body.includes(CODE)) throw new Error('code leaked'); void s;
  }
});
Deno.test('duplicate leads within one report are collapsed before import', async () => {
  const { call, calls } = setup();
  await call(ingestBody({ report: report([lead(), lead({ lead_id: 'other' })]) }), TOKEN);
  eq(((calls.ingest[0] as unknown[])[2] as { leads: unknown[] }).leads.length, 1);
});
