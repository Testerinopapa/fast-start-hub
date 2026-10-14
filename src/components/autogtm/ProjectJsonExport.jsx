import React, { useEffect, useRef, useState } from 'react';
import { exportResearchProject } from '../../lib/companyResearch';

export default function ProjectJsonExport({ jobId, domain, userId }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const request = useRef(null);
  useEffect(() => {
    setBusy(false); setMessage(null);
    return () => { request.current?.abort(); request.current = null; };
  }, [jobId, domain, userId]);

  const download = async () => {
    if (request.current || !jobId || !userId) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setMessage(null);
    try {
      const report = await exportResearchProject(jobId, domain, controller.signal);
      if (controller.signal.aborted) return;
      const blob = new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const fileDomain = report.project.domain.replace(/[^a-zA-Z0-9.-]/g, '_');
      const timestamp = report.exported_at.replace(/[:.]/g, '-');
      link.href = url;
      link.download = `autogtm-${fileDomain}-${jobId}-${timestamp}.json`;
      document.body.appendChild(link);
      try { link.click(); }
      finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
      setMessage({ error: false, text: 'JSON download requested.' });
    } catch (error) {
      if (!controller.signal.aborted) setMessage({ error: true, text: error.message || 'Could not export this project.' });
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  };

  return <div className="flex flex-col items-start gap-1">
    <button type="button" onClick={download} disabled={!jobId || !userId || busy}
      title="Download saved project results and diagnostics. Does not run research or use API credits."
      className="text-[11px] px-2.5 py-1 rounded-md border border-black/10 bg-white text-gray-600 hover:text-gray-900 transition shadow-2xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
      {busy ? 'Exporting JSON…' : 'Export project JSON'}
    </button>
    {message && <span role={message.error ? 'alert' : 'status'} className="max-w-xs text-[11px] text-gray-500">{message.text}</span>}
  </div>;
}
