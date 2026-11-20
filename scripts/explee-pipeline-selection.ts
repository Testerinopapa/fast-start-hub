/**
 * Conservative first-page selection for a low-credit live QA smoke.
 * It is deliberately stricter than production discovery: search candidates
 * remain unverified until a page is extracted and matched with evidence.
 */
export type PreviewCandidate = { url: string; relevance: number; search_title?: string };
const editorialPath = /\/(?:articles?|blog|resources?|guides?|learn|compare|tag|network|partner|community|forum|news|categories|events)(?:\/|$)/i;
const editorialTitle = /\b(?:directory|network|community|guide|article|resources|association)\b/i;

export function selectBuyerPreview<T extends PreviewCandidate>(candidates: T[]): T | null {
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate.url);
      if (!['https:', 'http:'].includes(url.protocol) || candidate.relevance < 4 ||
        editorialPath.test(url.pathname) || /\.(?:pdf|docx?|xlsx?)$/i.test(url.pathname) ||
        (candidate.search_title && editorialTitle.test(candidate.search_title))) continue;
      return candidate;
    } catch { /* Malformed links cannot be promoted to a buyer website. */ }
  }
  return null;
}
