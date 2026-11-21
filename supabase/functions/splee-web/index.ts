/** Read-only Context.dev evidence bridge for Splee's direct Lovable AI transport.
 * Distinct from the AI proxy so existing qualification remains unaffected.
 * Authenticated with the same server-only token and database-backed request cap.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { contextSearch, contextScrape } from '../_shared/context-dev.ts';
import { companyUrl } from '../_shared/research-core.ts';

type Json = Record<string, unknown>;
const MAX_BODY = 4096;
const HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS });
const deny = (status: number, code: string) => reply({ error: { code } }, status);

async function sameToken(a: string, b: string): Promise<boolean> {
  const digest = async (v: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function readBounded(req: Request): Promise<Json> {
  if (!req.headers.get('content-type')?.startsWith('application/json')) throw Error('invalid_content_type');
  if (Number(req.headers.get('content-length')) > MAX_BODY) throw Error('payload_too_large');
  const reader = req.body?.getReader();
  if (!reader) throw Error('missing_body');
  const parts: Uint8Array[] = []; let count = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    count += value.length;
    if (count > MAX_BODY) { await reader.cancel(); throw Error('payload_too_large'); }
    parts.push(value);
  }
  const bytes = new Uint8Array(count);
  let offset = 0;
  for (const chunk of parts) { bytes.set(chunk, offset); offset += chunk.length; }
  const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('invalid_json_body');
  return data as Json;
}

export function createEvidenceHandler(deps: {
  token: () => string | undefined;
  reserve: (runId: string, fingerprint: string) => Promise<string>;
  search: (query: string) => Promise<unknown>;
  fetchPage: (url: string) => Promise<unknown>;
}) {
  return async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname;
    const operation = path.endsWith('/v1/web/search') ? 'search' : path.endsWith('/v1/web/fetch') ? 'fetch' : null;
    if (!operation) return deny(404, 'not_found');
    if (req.method !== 'POST') return deny(405, 'method_not_allowed');
    const expected = deps.token();
    if (!expected) return deny(503, 'not_configured');
    const supplied = req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1] || '';
    if (!supplied || !(await sameToken(supplied, expected))) return deny(401, 'unauthorized');
    const runId = req.headers.get('x-explee-run-id') || '';
    if (!/^github-[0-9]{1,24}-[0-9]{1,6}$/.test(runId)) return deny(400, 'invalid_run_id');
    try {
      const data = await readBounded(req);
      const key = operation === 'search' ? 'query' : 'url';
      const value = data[key];
      if (Object.keys(data).length !== 1 || typeof value !== 'string' || value.length < 2 || value.length > 500) {
        return deny(400, 'invalid_request');
      }
      if (operation === 'fetch') {
        const parsed = companyUrl(value);
        if (parsed.protocol !== 'https:') return deny(400, 'invalid_https_url');
      }
      const canonical = JSON.stringify({ operation, value });
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
      const fingerprint = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
      const admission = await deps.reserve(runId, fingerprint);
      if (admission !== 'admitted') return deny(admission === 'duplicate' ? 409 : 429, admission);
      // Context.dev is invoked on the server only; never return API credentials.
      const result = operation === 'search' ? await deps.search(value) : await deps.fetchPage(value);
      const output = JSON.stringify(result);
      if (output.length > 16000) return deny(502, 'evidence_too_large');
      return new Response(output, { status: 200, headers: HEADERS });
    } catch {
      return deny(503, 'evidence_unavailable');
    }
  };
}

function database() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw Error('usage_safeguards_missing');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

if (import.meta.main) {
  Deno.serve(createEvidenceHandler({
    token: () => Deno.env.get('OPENOUTFIND_PROXY_TOKEN'),
    reserve: async (runId, fingerprint) => {
      const { data, error } = await database().rpc('openoutfind_ai_reserve', { p_run_id: runId, p_fingerprint: fingerprint });
      if (error || typeof data !== 'string') throw Error('admission_unavailable');
      return data;
    },
    search: async (query) => {
      const result = await contextSearch(query, { limit: 4, retries: 0 });
      return { results: result.results };
    },
    fetchPage: async (url) => {
      const page = await contextScrape(url, { schema: {
        type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'],
      } }, { retries: 0 });
      return { url: page.metadata.url, title: page.metadata.title || '', markdown: (page.markdown || '').slice(0, 10000) };
    },
  }));
}
