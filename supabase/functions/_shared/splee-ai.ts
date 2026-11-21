import type {} from './generated/ai-gateway/models.d.ts';
import { generateResponse, GatewayError } from '@lovable.dev/ai-gateway';
import type { AIRequest } from './splee-core.ts';
import { ResearchError } from './research-core.ts';
export async function researchAI(request:AIRequest,runId:string) {
 try {
  const response=await generateResponse({model:'openai/gpt-6-astra',input:[{role:'user',content:JSON.stringify({instructions:request.prompt,evidence:request.evidence})}],max_output_tokens:3500,text:{format:{type:'json_schema',name:request.name,schema:request.schema,strict:true}}},{maxRetries:0,runId,signal:AbortSignal.timeout(45000)});
  if(response.status!=='completed') throw new ResearchError('AI_INCOMPLETE','Lovable AI did not finish. The request will not be replayed.',422);
  const parts=response.output.flatMap(item=>item.type==='message'?item.content:[]);
  if(parts.some(p=>p.type==='refusal')) throw new ResearchError('AI_REFUSAL','Lovable AI declined this request; saved evidence is unchanged.',422);
  const text=parts.filter(p=>p.type==='output_text').map(p=>p.text).join('');
  try {return JSON.parse(text);} catch {throw new ResearchError('AI_INVALID_JSON','Lovable AI returned invalid structured results. No automatic retry.',422);}
 } catch(error) {
  if(error instanceof GatewayError) throw new ResearchError(error.code,'Lovable AI could not complete this stage. Saved results remain available; no automatic retry.',error.httpStatus||503);
  throw error;
 }
}
