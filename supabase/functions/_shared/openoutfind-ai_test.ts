import { strict as assert } from 'node:assert';
import { createAIProxy, toPayload, AI_MODEL, MAX_OUTPUT_TOKENS, type ProxyDeps } from './openoutfind-ai.ts';
import { PaymentRequiredError, PermissionDeniedError, NetworkError, RateLimitError } from '@lovable.dev/ai-gateway';
const input = { model: AI_MODEL, messages: [{role:'user',content:'Assess Calendly campaign fit from provided fields only.'}] };
const req = (body: unknown = input, token = 'fixture-only', run = 'github-1-1') => new Request('https://test.invalid/openoutfind-ai/v1/chat/completions', {method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-explee-run-id':run},body:JSON.stringify(body)});
const completion: Awaited<ReturnType<NonNullable<ProxyDeps['generate']>>> = {id:'chat-test',object:'chat.completion',created:1,model:AI_MODEL,choices:[{index:0,finish_reason:'tool_calls',logprobs:null,message:{role:'assistant',content:null,refusal:null,tool_calls:[{id:'call_1',type:'function',function:{name:'final_result',arguments:'{"qualified":true,"reason":"Consulting owner can approve scheduling software."}'}}]}}]};
const deps = (overrides: Partial<ProxyDeps> = {}): ProxyDeps => ({token:()=> 'fixture-only',reserve:async()=> 'admitted', stop:async()=>{},generate:async()=>completion,...overrides});

Deno.test('proxy authenticates before any admission or inference', async()=> {
  let calls=0; const proxy=createAIProxy(deps({reserve:async()=>{calls++;return 'admitted';}}));
  assert.equal((await proxy(req(input,'wrong'))).status,401); assert.equal(calls,0);
});
Deno.test('Pydantic function output schema and tool roundtrip preserve qualification', async()=> {
  const body={...input, tools:[{type:'function',function:{name:'final_result',description:'QualificationDecision',parameters:{type:'object',properties:{qualified:{type:'boolean'},reason:{type:'string'}},required:['qualified','reason']}}}],tool_choice:'required'};
  const payload=toPayload(body); assert.equal(payload.reasoning_effort,'none');
  assert.equal(payload.tools?.[0].type,'function');
  const response=await createAIProxy(deps())(req(body)); assert.equal(response.status,200);
  const output=await response.json(); assert.deepEqual(JSON.parse(output.choices[0].message.tool_calls[0].function.arguments),{qualified:true,reason:'Consulting owner can approve scheduling software.'});
  const followup=toPayload({...body,messages:[...input.messages,completion.choices[0].message,{role:'tool',tool_call_id:'call_1',content:'validated'}]});
  assert.equal(followup.messages.at(-1)?.role,'tool');
});
Deno.test('strict JSON schema output and enforced output budget',()=> {
  const p=toPayload({...input,response_format:{type:'json_schema',json_schema:{name:'qualification',schema:{type:'object'},strict:true}}});
  assert.equal(p.max_completion_tokens,4096); assert.equal(MAX_OUTPUT_TOKENS,4096);
  assert.equal(p.response_format?.type,'json_schema');
  assert.equal(toPayload({...input,max_tokens:1000}).max_completion_tokens,1000);
  assert.throws(()=>toPayload({...input,max_tokens:4097}));
});
Deno.test('reject streaming, alternate models, multiple outputs, and external tools', async()=> {
  for (const change of [{stream:true},{model:'openai/gpt-6-astra'},{n:2},{web_search_options:{}},{tools:[{type:'web_search'}]}]) assert.equal((await createAIProxy(deps())(req({...input,...change}))).status,400);
});
Deno.test('input limit is bytes, including multi-byte prospect data',async()=> {
  assert.equal((await createAIProxy(deps())(req({...input,messages:[{role:'user',content:'é'.repeat(33000)}]}))).status,413);
});
Deno.test('duplicates and quotas never invoke paid inference',async()=> {
  for (const admission of ['duplicate','limit','paused','stopped']) {
    let calls=0;
    const response=await createAIProxy(deps({reserve:async()=>admission,generate:async()=>{calls++;return completion;}}))(req());
    assert.equal(response.status,admission==='duplicate'?409:429); assert.equal(calls,0);
  }
});
Deno.test('permanent credit and access failures pause all entry points without replay', async()=> {
  for (const [error,status] of [[new PaymentRequiredError('private provider details'),402],[new PermissionDeniedError('private provider details'),403]] as const) {
    let stopped=false;let calls=0;
    const response=await createAIProxy(deps({generate:async()=>{calls++;throw error;},stop:async(_run,pause)=>{stopped=pause;}}))(req());
    assert.equal(response.status,status);assert.equal(stopped,true);assert.equal(calls,1);assert.equal((await response.text()).includes('private provider details'),false);
  }
});
Deno.test('unknown network outcome and exhausted rate limit stop the run',async()=> {
  for (const error of [new NetworkError('unknown'),new RateLimitError('slow down')]) {
    let stopped=false;
    const response=await createAIProxy(deps({generate:async()=>{throw error;},stop:async(_run,pause)=>{stopped=!pause;}}))(req());
    assert.equal(stopped,true); assert.ok([429,503].includes(response.status));
  }
});
Deno.test('model refusal and truncated answers stop qualification',async()=> {
  for (const c of [{...completion.choices[0],message:{...completion.choices[0].message,refusal:'declined'}},{...completion.choices[0],finish_reason:'length' as const}]) {
    let stopped=false;
    const response=await createAIProxy(deps({generate:async()=>({...completion,choices:[c]}),stop:async()=>{stopped=true;}}))(req());
    assert.equal(response.status,422);assert.equal(stopped,true);
  }
});