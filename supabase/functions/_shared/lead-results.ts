// Private OpenOutFind Lead Results API. Browser routes use a verified user session;
// ingestion uses the server-to-server proxy bearer PLUS a one-time import code.
import { z } from 'zod';

export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_LEADS = 25;
export const CODE_TTL_MS = 2 * 60 * 60 * 1000;
export const MAX_ACTIVE_CODES = 5;
export const DEFAULT_REPOSITORY = 'Testerinopapa/fast-start-hub';

export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export type Identity = { issuer: string; subject: string };
export interface LeadDeps {
  proxyToken(): string | undefined;
  repository(): string;
  verifyUser(jwt: string): Promise<Identity | null>;
  ownerId(identity: Identity): Promise<string>;
  activeCodes(ownerId: string): Promise<number>;
  storeCode(ownerId: string, hash: string, expiresAt: Date): Promise<void>;
  list(ownerId: string): Promise<unknown>;
  review(ownerId: string, leadId: string, fields: ReviewFields): Promise<boolean>;
  ingest(hash: string, runId: string, payload: unknown): Promise<{ status: string; [k: string]: unknown }>;
  random(bytes: number): Uint8Array;
  now(): Date;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const enc = new TextEncoder();
export async function sha256Hex(value: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value)));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}
export async function timingSafeEqual(a: string, b: string) {
  const [x, y] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const PHONE = /\+?\d[\d\s().-]{7,}\d/;
const text = (max: number, noPhone = false) => z.string().max(max).nullable()
  .refine((v) => v === null || !EMAIL.test(v), 'Email addresses are not accepted')
  .refine((v) => v === null || !noPhone || !PHONE.test(v), 'Phone numbers are not accepted');
export function safeUrl(v: string | null, linkedinOnly = false) {
  if (v === null) return true;
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && !linkedinOnly)) return false;
    if (u.username || u.password || u.port) return false;
    if (linkedinOnly && !/(^|\.)linkedin\.com$/i.test(u.hostname)) return false;
    return u.hostname.includes('.');
  } catch { return false; }
}
const url = (linkedinOnly = false) => z.string().max(500).nullable().refine((v) => safeUrl(v, linkedinOnly), 'Untrusted URL');

const leadSchema = z.object({
  lead_id: z.string().max(100).nullable(),
  person_name: text(200, true),
  title: text(200, true),
  company: text(200, true),
  company_website: url(),
  professional_profile: url(true),
  qualification_reason: text(1200),
  qualified_at: z.string().max(80).nullable(),
  email: z.null(),
  checks: z.object({
    provider_profile: z.enum(['returned_by_openoutfind', 'missing']),
    company_employment: z.literal('not_independently_verified'),
    campaign_fit: z.enum(['llm_assessed_not_verified', 'missing_reason']),
    email: z.literal('not_requested'),
  }).strict(),
  needs_review: z.boolean(),
}).strict();
const summarySchema = z.object({ independently_verified_people: z.literal(0), email_purchases: z.literal(0), outreach_sent: z.literal(0) }).passthrough();
export const ingestSchema = z.object({
  action: z.literal('ingest'),
  import_code: z.string().regex(/^[A-Za-z0-9_-]{32,64}$/),
  repository: z.string().max(140),
  run_id: z.string().regex(/^[0-9]{1,24}$/),
  run_attempt: z.string().regex(/^[0-9]{1,6}$/),
  report: z.object({
    schema_version: z.literal('explee.openoutfind.leads.v1'),
    campaign: z.object({ campaign_name: z.string().max(300).nullable().optional(), research_company: z.string().max(300).nullable().optional() }).passthrough(),
    summary: summarySchema,
    leads: z.array(leadSchema).max(MAX_LEADS),
  }).strict(),
}).strict();
export const reviewSchema = z.object({
  action: z.literal('review'),
  lead_id: z.string().uuid(),
  review_status: z.enum(['pending', 'verified', 'rejected']),
  manual_score: z.number().int().min(0).max(100).nullable(),
  manual_notes: z.string().max(2000).nullable(),
  evidence_url: z.string().max(500).nullable(),
}).strict().superRefine((v, ctx) => {
  if (v.evidence_url !== null && !(safeUrl(v.evidence_url) && v.evidence_url.startsWith('https://'))) ctx.addIssue({ code: 'custom', message: 'Evidence link must be an https URL', path: ['evidence_url'] });
  if (v.review_status === 'verified' && !v.evidence_url) ctx.addIssue({ code: 'custom', message: 'Verified requires an evidence link', path: ['evidence_url'] });
});
export type ReviewFields = Omit<z.infer<typeof reviewSchema>, 'action' | 'lead_id'> & { reviewed_at: string | null };

export async function leadKey(l: z.infer<typeof leadSchema>) {
  const basis = l.professional_profile ? `p:${l.professional_profile.toLowerCase().replace(/\/+$/, '')}`
    : `n:${(l.person_name || '').toLowerCase()}|${(l.company || '').toLowerCase()}|${(l.lead_id || '')}`;
  return sha256Hex(basis);
}

export function createLeadResultsHandler(deps: LeadDeps) {
  async function user(req: Request) {
    const m = req.headers.get('Authorization')?.match(/^Bearer (\S+)$/i);
    if (!m) throw new ApiError('UNAUTHORIZED', 'Sign in to view lead results.', 401);
    const identity = await deps.verifyUser(m[1]).catch(() => null);
    if (!identity) throw new ApiError('UNAUTHORIZED', 'Your session expired. Please sign in again.', 401);
    return deps.ownerId(identity);
  }
  async function handle(req: Request) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') throw new ApiError('METHOD_NOT_ALLOWED', 'Use POST.', 405);
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) throw new ApiError('TOO_LARGE', 'Request too large.', 413);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { throw new ApiError('INVALID_REQUEST', 'Invalid JSON.'); }
    if (!body || typeof body !== 'object') throw new ApiError('INVALID_REQUEST', 'Invalid JSON.');

    if (body.action === 'ingest') {
      const expected = deps.proxyToken();
      if (!expected) throw new ApiError('NOT_CONFIGURED', 'Import is not configured.', 503);
      const m = req.headers.get('Authorization')?.match(/^Bearer (\S+)$/i);
      if (!m || !(await timingSafeEqual(m[1], expected))) throw new ApiError('UNAUTHORIZED', 'Invalid import credentials.', 401);
      const parsed = ingestSchema.safeParse(body);
      if (!parsed.success) throw new ApiError('INVALID_REPORT', `Report rejected: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      const p = parsed.data;
      if (p.repository !== deps.repository()) throw new ApiError('WRONG_REPOSITORY', 'Imports are only accepted from the configured repository.', 403);
      const leads = await Promise.all(p.report.leads.map(async (l) => ({
        lead_key: await leadKey(l), person_name: l.person_name, title: l.title, company: l.company,
        company_website: l.company_website, professional_profile: l.professional_profile,
        qualification_reason: l.qualification_reason, checks: l.checks, needs_review: l.needs_review,
      })));
      const unique = [...new Map(leads.map((l) => [l.lead_key, l])).values()];
      const result = await deps.ingest(await sha256Hex(p.import_code), `github-${p.run_id}`, {
        campaign_name: p.report.campaign.campaign_name ?? null, research_company: p.report.campaign.research_company ?? null, leads: unique,
      });
      const failures: Record<string, [string, string, number]> = {
        invalid_code: ['INVALID_CODE', 'Import code not recognised. Create a new code on the Lead Results page.', 403],
        code_used: ['CODE_USED', 'This import code was already used by a different run. Create a new code.', 409],
        code_expired: ['CODE_EXPIRED', 'This import code expired. Create a new code.', 410],
        invalid: ['INVALID_REPORT', 'Report rejected.', 400],
      };
      if (result.status !== 'imported') { const [c, msg, s] = failures[result.status] ?? ['IMPORT_FAILED', 'Import failed.', 500]; throw new ApiError(c, msg, s); }
      return json({ status: 'imported', leads: unique.length, new_sightings: result.new_sightings, already_imported: result.already_imported });
    }

    const owner = await user(req);
    if (body.action === 'create_import_code') {
      if (Object.keys(body).length !== 1) throw new ApiError('INVALID_REQUEST', 'Unexpected fields.');
      if ((await deps.activeCodes(owner)) >= MAX_ACTIVE_CODES) throw new ApiError('TOO_MANY_CODES', 'You have several unused codes. Use one or wait for them to expire.', 429);
      const code = b64url(deps.random(24));
      const expires = new Date(deps.now().getTime() + CODE_TTL_MS);
      await deps.storeCode(owner, await sha256Hex(code), expires);
      return json({ import_code: code, expires_at: expires.toISOString() });
    }
    if (body.action === 'list') {
      if (Object.keys(body).length !== 1) throw new ApiError('INVALID_REQUEST', 'Unexpected fields.');
      return json(await deps.list(owner));
    }
    if (body.action === 'review') {
      const parsed = reviewSchema.safeParse(body);
      if (!parsed.success) throw new ApiError('INVALID_REVIEW', parsed.error.issues[0]?.message || 'Invalid review.');
      const { action: _a, lead_id, ...fields } = parsed.data;
      const reviewed_at = fields.review_status === 'pending' ? null : deps.now().toISOString();
      if (!(await deps.review(owner, lead_id, { ...fields, reviewed_at }))) throw new ApiError('NOT_FOUND', 'Lead not found.', 404);
      return json({ status: 'saved', reviewed_at });
    }
    throw new ApiError('INVALID_REQUEST', 'Unknown action.');
  }
  return async (req: Request) => {
    try { return await handle(req); }
    catch (e) {
      // Never log bodies, codes, names, URLs or tokens.
      if (e instanceof ApiError) return json({ error: { code: e.code, message: e.message } }, e.status);
      console.error('lead-results internal error');
      return json({ error: { code: 'INTERNAL_ERROR', message: 'Lead results are temporarily unavailable.' } }, 500);
    }
  };
}
