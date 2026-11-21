import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { AUTH_PROJECT_URL, AUTH_PROJECT_PUBLISHABLE_KEY, AUTH_ISSUER } from './auth-project.ts';
import { ResearchError } from './research-core.ts';
export type ValidatedUser={id:string;is_anonymous?:boolean};
export async function researchOwner(token:string,validateManaged:(token:string)=>Promise<ValidatedUser|null>,validateLegacy:(token:string)=>Promise<ValidatedUser|null>=async value=>{
 const client=createClient(AUTH_PROJECT_URL,AUTH_PROJECT_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await client.auth.getUser(value);return error?null:data.user;
}) {
 const managed=await validateManaged(token);
 if(managed&&!managed.is_anonymous)return managed.id;
 const legacy=await validateLegacy(token);
 if(!legacy||legacy.is_anonymous)throw new ResearchError('UNAUTHORIZED','Sign in with your existing account to save private research.',401);
 // Separate namespace for cryptographically verified legacy accounts; no client owner claims.
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${AUTH_ISSUER}\n${legacy.id}`)));
 hash[6]=(hash[6]&15)|80;hash[8]=(hash[8]&63)|128;
 const h=[...hash.slice(0,16)].map(v=>v.toString(16).padStart(2,'0')).join('');
 return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
