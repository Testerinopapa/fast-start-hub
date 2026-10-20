import { contextSearch } from '../supabase/functions/_shared/context-dev.ts';

// Explicit manual paid check: exactly one request, no automatic retries.
try {
  const result = await contextSearch('independent management consulting firm London about team clients -software -directory', { retries: 0 });
  console.log(JSON.stringify({ query: result.query, request_id: result.request_id,
    credits_consumed: result.key_metadata?.credits_consumed, results: result.results }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Context.dev check failed.');
  Deno.exitCode = 1;
}
