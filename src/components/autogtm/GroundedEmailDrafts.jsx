import React, {useState} from 'react';
import ResearchButton from './ResearchButton';
export default function GroundedEmailDrafts({drafts=[]}) {
 const [copied,setCopied]=useState('');
 return <div className="mx-auto w-full max-w-5xl space-y-4">
  {!drafts.length && <p className="text-sm text-[var(--muted-foreground)]">No drafts: no supported decision-maker and company evidence is available.</p>}
  {drafts.map(draft=><article key={draft.person_id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
   <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
    <div><h2 className="text-sm font-semibold">{draft.recipient_name}</h2><p className="text-xs text-[var(--muted-foreground)]">{draft.company_domain} · Draft only · No email address</p></div>
    <ResearchButton onClick={async()=>{try {await navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`);setCopied(draft.person_id);}catch {setCopied('failed');}}}>{copied===draft.person_id?'Copied':'Copy draft'}</ResearchButton>
   </header>
   <h3 className="mt-4 text-sm font-semibold">{draft.subject}</h3><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">{draft.body}</p>
   <div className="mt-5 flex flex-wrap gap-3 text-xs">{draft.source_urls.map((url,i)=><a key={url} className="text-[var(--brand-700)] underline" href={url} target="_blank" rel="noopener noreferrer">Source {i+1}</a>)}</div>
   <p className="mt-3 text-xs text-[var(--muted-foreground)]">Current employment and buyer fit require review. Sending disabled.</p>
  </article>)}
  {copied==='failed'&&<p role="alert">Could not copy. Your saved draft is unchanged.</p>}
 </div>;
}
