import { strict as assert } from 'node:assert';
import { selectBuyerPreview } from './explee-pipeline-selection.ts';

Deno.test('live QA will not mistake consulting guides and directories for prospect websites', () => {
  const rows = [
    { url: 'https://umbrex.com/resources/independent-consulting-path/', relevance: 26, search_title: 'Independent consulting guide' },
    { url: 'https://directory.example.org/', relevance: 22, search_title: 'Consulting directory' },
    { url: 'https://practicemanagementconsultancy.com/', relevance: 18, search_title: 'Practice Management Consultancy' },
  ];
  assert.equal(selectBuyerPreview(rows)?.url, 'https://practicemanagementconsultancy.com/');
});

Deno.test('live QA refuses poor, unsupported or unsafe search candidates', () => {
  assert.equal(selectBuyerPreview([
    { url: 'javascript:alert(1)', relevance: 999 },
    { url: 'https://site.com/blog/consultants', relevance: 20 },
    { url: 'https://company.com/', relevance: 2 },
  ]), null);
});

Deno.test('live QA allows strong first-party about and service pages for verification', () => {
  assert.equal(selectBuyerPreview([
    { url: 'https://agency.com/services/consulting', relevance: 11, search_title: 'Agency Consulting' },
  ])?.url, 'https://agency.com/services/consulting');
});
