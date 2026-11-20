import type {} from './generated/ai-gateway/models.d.ts';
import { generateChatCompletion, GatewayError, type RequestFor, type ResponseFor } from '@lovable.dev/ai-gateway';
import { z } from 'zod';
import { corsHeaders } from 'npm:@supabase/supabase-js@2.117.2/cors';

export const AI_MODEL = 'openai/gpt-6-luna';
export const MAX_BODY_BYTES = 65536;
export const MAX_OUTPUT_TOKENS = 4096;
type Payload = Extract<RequestFor<'chat-completions'>, { model: typeof AI_MODEL }>;
type Completion = ResponseFor<'chat-completions', typeof AI_MODEL>;
const text = z.string().max(MAX_BODY_BYTES);
const name = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const content = z.union([text, z.array(z.object({ type: z.literal('text'), text }).strict()).max(32)]);
const call = z.object({ id: name, type: z.literal('function'), function: z.object({ name, arguments: text }).strict() }).strict();
const message = z.discriminatedUnion('role', [
  z.object({ role: z.literal('system'), content, name: name.optional() }).strict(),
  z.object({ role: z.literal('developer'), content, name: name.optional() }).strict(),
  z.object({ role: z.literal('user'), content, name: name.optional() }).strict(),
  z.object({ role: z.literal('assistant'), content: content.nullish(), tool_calls: z.array(call).max(16).optional() }).strict(),
  z.object({ role: z.literal('tool'), content, tool_call_id: name }).strict(),
]);
const schema = z.record(z.string(), z.unknown());
const tool = z.object({ type: z.literal('function'), function: z.object({
  name, description: text.optional(), parameters: schema, strict: z.boolean().nullish(),
}).strict() }).strict();
const format = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text') }).strict(),
  z.object({ type: z.literal('json_object') }).strict(),
  z.object({ type: z.literal('json_schema'), json_schema: z.object({ name, description: text.optional(), schema, strict: z.boolean().nullish() }).strict() }).strict(),
]);
export const requestSchema = z.object({
  model: z.literal(AI_MODEL), messages: z.array(message).min(1).max(100),
  tools: z.array(tool).min(1).max(16).optional(),
  tool_choice: z.union([z.enum(['auto','none','required']), z.object({ type: z.literal('function'), function: z.object({ name }).strict() }).strict()]).optional(),
  response_format: format.optional(), parallel_tool_calls: z.boolean().optional(),
  stream: z.literal(false).optional(), n: z.literal(1).optional(),
  max_tokens: z.number().int().positive().max(MAX_OUTPUT_TOKENS).optional(),
  max_completion_tokens: z.number().int().positive().max(MAX_OUTPUT_TOKENS).optional(),
  reasoning_effort: z.literal('none').optional(), temperature: z.number().min(0).max(2).optional(),
}).strict();

class ProxyError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export function toPayload(input: unknown): Payload {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) throw new ProxyError(400, 'invalid_request', 'Unsupported or invalid chat-completions request. Only text, function tools and JSON output are allowed.');
  const r = parsed.data;
  if (r.max_tokens && r.max_completion_tokens && r.max_tokens !== r.max_completion_tokens) throw new ProxyError(400,'invalid_request','Conflicting output limits.');
  if (r.tool_choice && !r.tools) throw new ProxyError(400,'invalid_request','tool_choice requires tools.');
  const chosen = typeof r.tool_choice === 'object' ? r.tool_choice.function.name : undefined;
  if (chosen && !r.tools?.some(t => t.function.name === chosen)) throw new ProxyError(400,'invalid_request','Unknown tool choice.');
  // The generated native contract omits function.description: retain its meaning
  // as schema documentation rather than sending an unsupported native field.
  const descriptions = r.tools?.filter(t => t.function.description).map(t => `${t.function.name}: ${t.function.description}`).join('\n');
  const messages: Payload['messages'] = [...r.messages];
  if (descriptions) messages.unshift({ role: 'developer', content: `Function descriptions (schema documentation, not evidence):\n${descriptions}` });
  const responseFormat = r.response_format?.type === 'json_schema' ? {
    type: 'json_schema' as const,
    json_schema: { name: r.response_format.json_schema.name, schema: r.response_format.json_schema.schema, strict: r.response_format.json_schema.strict },
  } : r.response_format;
  return {
    model: AI_MODEL, messages, reasoning_effort: 'none',
    max_completion_tokens: r.max_completion_tokens ?? r.max_tokens ?? MAX_OUTPUT_TOKENS,
    ...(r.tools ? { tools: r.tools.map(t => ({ type: 'function' as const, function: { name: t.function.name, parameters: t.function.parameters, strict: t.function.strict } })) } : {}),
    ...(r.tool_choice ? { tool_choice: r.tool_choice } : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
    ...(r.parallel_tool_calls === undefined ? {} : { parallel_tool_calls: r.parallel_tool_calls }),
    ...(r.temperature === undefined ? {} : { temperature: r.temperature }),
    n: 1,
  };
}

export interface ProxyDeps {
  token: () => string | undefined;
  reserve: (runId: string, fingerprint: string) => Promise<string>;
  stop: (runId: string, pauseAll: boolean) => Promise<void>;
  generate?: (payload: Payload, signal: AbortSignal, runId: string) => Promise<Completion>;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'content-type': 'application/json', 'cache-control': 'no-store' } });
const errorResponse = (status: number, code: string, message: string, extra: object = {}) => json({ error: { message, type: 'proxy_error', code, ...extra } }, status);

async function sameToken(a: string, b: string): Promise<boolean> {
  const digest = async (v: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));
  const [aa,bb] = await Promise.all([digest(a),digest(b)]);
  let diff = 0;
  for (let i=0; i<aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}
async function boundedBody(req: Request) {
  if (!req.headers.get('content-type')?.startsWith('application/json')) throw new ProxyError(415,'invalid_request','Use application/json.');
  if (Number(req.headers.get('content-length')) > MAX_BODY_BYTES) throw new ProxyError(413,'request_too_large','Request exceeds 64 KiB.');
  const reader = req.body?.getReader();
  if (!reader) throw new ProxyError(400,'invalid_request','Request body required.');
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const {value,done} = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new ProxyError(413,'request_too_large','Request exceeds 64 KiB.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new ProxyError(400,'invalid_request','Invalid JSON.'); }
}

export function createAIProxy(deps: ProxyDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null,{status:204,headers:corsHeaders});
    const configuredToken = deps.token();
    if (!configuredToken) return errorResponse(503,'not_configured','Proxy authentication is not configured.');
    const supplied = req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!supplied || !(await sameToken(supplied, configuredToken))) return errorResponse(401,'unauthorized','Invalid proxy credentials.');
    const path = new URL(req.url).pathname;
    if (req.method === 'GET' && path.endsWith('/v1/models')) return json({object:'list', data:[{id:AI_MODEL,object:'model',owned_by:'lovable'}]});
    if (req.method !== 'POST') return errorResponse(405,'method_not_allowed','Use POST.');
    if (!path.endsWith('/v1/chat/completions')) return errorResponse(404,'not_found','Unknown proxy endpoint.');
    const runId = req.headers.get('x-explee-run-id') ?? '';
    if (!/^github-[0-9]{1,24}-[0-9]{1,6}$/.test(runId)) return errorResponse(400,'invalid_run_id','Provide the GitHub run ID and attempt.');
    let admitted = false;
    try {
      const payload = toPayload(await boundedBody(req));
      const hash = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)));
      const fingerprint = Array.from(new Uint8Array(hash), b=>b.toString(16).padStart(2,'0')).join('');
      const admission = await deps.reserve(runId,fingerprint);
      if (admission !== 'admitted') return errorResponse(admission === 'duplicate' ? 409 : 429,admission,'AI request was not admitted. Check the run and usage safeguards before authorizing new work.');
      admitted = true;
      const signal = AbortSignal.any([req.signal, AbortSignal.timeout(45000)]);
      const result = await (deps.generate ?? ((p,s,id)=>generateChatCompletion(p,{signal:s,runId:id})))(payload,signal,runId);
      if (result.choices.some(c=>c.message.refusal)) {
        await deps.stop(runId,false);
        return errorResponse(422,'model_refusal','The model declined this request. The run is stopped; no automatic rephrasing or model switching.');
      }
      if (!result.choices.length || result.choices.some(c=>c.finish_reason === 'length')) {
        await deps.stop(runId,false);
        return errorResponse(422,'incomplete_output','The model output was incomplete. Review the request before authorizing another run.');
      }
      return json(result);
    } catch (error) {
      if (error instanceof ProxyError) return errorResponse(error.status,error.code,error.message);
      if (error instanceof GatewayError) {
        const permanent = ['payment_required','permission_denied','authentication_error','configuration_error'].includes(error.code);
        if (admitted) await deps.stop(runId,permanent).catch(()=>{});
        const status = error.code === 'payment_required' ? 402 : error.code === 'permission_denied' ? 403 : error.code === 'rate_limited' ? 429 : error.code === 'request_rejected' ? 400 : 503;
        return errorResponse(status,error.code,'Lovable AI could not complete qualification. Review the error code and Gateway request logs before authorizing another run.',{outcome:error.outcome,request_ids:error.ids,recovery:error.recovery,retry_after:error.retryAfter});
      }
      if (admitted) await deps.stop(runId,false).catch(()=>{});
      return errorResponse(503,'proxy_unavailable','Qualification could not complete. The outcome may be unknown; do not automatically replay the request.');
    }
  };
}