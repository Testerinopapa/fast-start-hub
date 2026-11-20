import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

const h = (n) => n.toString(16).padStart(64, '0');
async function setup() {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;');
  await db.exec(await readFile(new URL('../supabase/migrations/20261120000100_openoutfind_lead_results.sql', import.meta.url), 'utf8'));
  await db.exec('set role service_role');
  const owner = async (sub) => (await db.query("insert into lead_review_owners(auth_issuer,auth_subject) values('iss',$1) returning id", [sub])).rows[0].id;
  const code = async (o, n, mins = 120) => db.query(`insert into lead_import_codes(code_hash,owner_id,expires_at) values($1,$2,now()+interval '${mins} minutes')`, [h(n), o]);
  const ingest = async (n, run, leads) => (await db.query('select openoutfind_lead_ingest($1,$2,$3) r', [h(n), run, JSON.stringify({ campaign_name: 'C', leads })])).rows[0].r;
  return { db, owner, code, ingest };
}
const lead = (k, complete = true) => ({ lead_key: h(k), person_name: 'Test Person', title: 'Role', company: 'Co', needs_review: !complete, checks: { company_employment: 'not_independently_verified' } });

test('anonymous and signed-in direct database access is denied', async () => {
  const { db } = await setup();
  try {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      for (const t of ['lead_review_owners', 'lead_import_codes', 'lead_runs', 'lead_results', 'lead_sightings'])
        await assert.rejects(db.query(`select * from public.${t}`), /permission denied/);
      await assert.rejects(db.query('select openoutfind_lead_ingest($1,$2,$3)', [h(1), 'github-1', '{"leads":[]}']), /permission denied/);
    }
  } finally { await db.close(); }
});

test('import code is one-time, bound to its owner, rejects replay by another run and expiry', async () => {
  const { db, owner, code, ingest } = await setup();
  try {
    const a = await owner('a'), b = await owner('b');
    await code(a, 1); await code(b, 2, -1);
    assert.equal((await ingest(1, 'github-10', [lead(1), lead(2, false)])).status, 'imported');
    assert.equal((await ingest(1, 'github-11', [lead(3)])).status, 'code_used');
    assert.equal((await ingest(2, 'github-12', [lead(4)])).status, 'code_expired');
    assert.equal((await ingest(9, 'github-13', [lead(5)])).status, 'invalid_code');
    const rows = (await db.query('select owner_id from lead_results')).rows;
    assert.equal(rows.length, 2); assert.ok(rows.every(r => r.owner_id === a));
    const run = (await db.query('select complete_profiles, incomplete_profiles from lead_runs')).rows[0];
    assert.deepEqual([run.complete_profiles, run.incomplete_profiles], [1, 1]);
  } finally { await db.close(); }
});

test('rerun of the same run is idempotent and keeps human review fields', async () => {
  const { db, owner, code, ingest } = await setup();
  try {
    const a = await owner('a'); await code(a, 1);
    await ingest(1, 'github-10', [lead(1)]);
    await db.query("update lead_results set review_status='rejected', manual_score=12, manual_notes='n', reviewed_at=now()");
    const again = await ingest(1, 'github-10', [lead(1)]);
    assert.equal(again.status, 'imported'); assert.equal(again.already_imported, 1);
    const r = (await db.query('select review_status, manual_score, manual_notes from lead_results')).rows[0];
    assert.deepEqual(r, { review_status: 'rejected', manual_score: 12, manual_notes: 'n' });
    assert.equal((await db.query('select count(*)::int n from lead_sightings')).rows[0].n, 1);
  } finally { await db.close(); }
});

test('same person seen in a later run with a new code records a second sighting for that owner only', async () => {
  const { db, owner, code, ingest } = await setup();
  try {
    const a = await owner('a'), b = await owner('b'); await code(a, 1); await code(a, 2); await code(b, 3);
    await ingest(1, 'github-10', [lead(1)]); await ingest(2, 'github-20', [lead(1)]); await ingest(3, 'github-30', [lead(1)]);
    assert.equal((await db.query('select count(*)::int n from lead_sightings where owner_id=$1', [a])).rows[0].n, 2);
    assert.equal((await db.query('select count(*)::int n from lead_results')).rows[0].n, 2);
  } finally { await db.close(); }
});

test('verified requires an https evidence link and a human review time; score is 0-100', async () => {
  const { db, owner, code, ingest } = await setup();
  try {
    const a = await owner('a'); await code(a, 1); await ingest(1, 'github-10', [lead(1)]);
    await assert.rejects(db.query("update lead_results set review_status='verified', reviewed_at=now()"), /verified_requires_evidence/);
    await assert.rejects(db.query("update lead_results set review_status='verified', evidence_url='https://x.test'"), /verified_requires_evidence/);
    await assert.rejects(db.query("update lead_results set evidence_url='javascript:alert(1)'"), /check/);
    await assert.rejects(db.query('update lead_results set manual_score=101'), /check/);
    await db.query("update lead_results set review_status='verified', evidence_url='https://x.test', reviewed_at=now()");
  } finally { await db.close(); }
});
