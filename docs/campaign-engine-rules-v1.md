# Explee Campaign Engine v1 — credit-free campaign generation

The active Phase 3 generator is the readable TypeScript module at
\`supabase/functions/_shared/campaigns-rules.ts\`. It does not use a language model,
OpenRouter, private API keys, HTTP fetches or usage credits. The model identifier
persisted in the existing project-generation record is \`rules/v1\`.

## How suggestions are generated

1. Load the authenticated, owner-scoped **saved** company research (no new scraping).
2. Score the company's product names, product descriptions and first-party company
   descriptions against ten explicit product-capability families.
3. Ignore competitor products as evidence of what the researched business sells.
   Deduplicate first-party sources and suppress weak secondary feature categories.
4. Select 4–6 customer segments from public, editable, industry-specific B2B
   playbooks. Keywords describe potential **buyer organizations**, not software
   alternatives, directory pages or articles.
5. Mark each suggestion \`origin: suggested\` and \`audience_basis: inferred\`,
   include the matched research fact IDs and original source URLs, and leave
   geographic targeting empty unless a human edits it.

The generator provides **audience hypotheses**, not evidence of an existing
customer relationship or proof that a prospect is qualified. It intentionally
refuses unsupported research instead of inventing general-purpose audiences.
Expand the capability patterns and playbooks when testing new product categories.

## Data preservation

The old \`campaigns\` Edge Function API and database reservation/completion RPCs
remain in use. Generated suggestions replace only older untouched suggestions.
Custom/edited campaigns, their IDs and selections are preserved by the existing
database merge. The existing 12-campaign total and eight-protected-campaign
limit still apply. Historical AI suggestions do **not** change simply because
this code is deployed: use **Regenerate suggestions** to replace them.

The existing database SQL migration is still named *AI campaign generation* for
historical compatibility, and its saved plan warning still refers to AI until a
follow-on SQL migration updates that warning; that label does not indicate an
AI provider request. No database migration is necessary to deploy the new engine.

## Deployment

Pull the GitHub \`main\` branch into your local working directory, review local
changes before merging, and deploy **only** the campaigns Edge Function to the
research Supabase project:

\`\`\`powershell
npx --yes supabase@2.120.0 functions deploy campaigns --project-ref cvpeezzkzsbosyuhmhmf --use-api
\`\`\`

Publish the frontend if the updated regenerate button tooltip is desired.
\`OPENROUTER_API_KEY\` is no longer required for Phase 3. It can be retired from
the research project **after verifying that no other function depends on it**.

## Regression tests

From \`supabase/functions\` (with Deno installed):

\`\`\`powershell
deno task check
deno task test
\`\`\`

The Calendly regression file tests both Calendly and HubSpot capability selection,
suggestion fields, source attribution, preservation limits, and failure when
research cannot establish a supported product category.

To replay an exported company profile from a local file:

\`\`\`powershell
$env:AUTOGTM_CALENDLY_EXPORT = "C:\path\to\your\calendly-export.json"
deno test --allow-env --allow-read _shared/calendly-regression_test.ts
\`\`\`

No Supabase deployment, database writes or external AI calls occur during these tests.
