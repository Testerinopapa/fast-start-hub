import React from 'react';
export default function ResearchButton({children,className='',...props}) {
 return <button type="button" className={`rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--foreground)] disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-600)] ${className}`} {...props}>{children}</button>;
}
