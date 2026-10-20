> Provider migration: the provider setup and deployment instructions below are historical. See [Context.dev migration](context-dev-migration.md) for the current implementation.

# Automatic Phase 3 campaigns

Prepared locally; not deployed. Only the `campaigns` Edge Function and the frontend need publishing. No migration, new secrets, services, dependencies or Firecrawl calls are required.

After explicit deployment approval:

```powershell
npx supabase@2.120.0 functions deploy campaigns --project-ref cvpeezzkzsbosyuhmhmf --use-api
```

Publish the frontend through the existing Lovable/Git workflow so the cards display audience provenance, possible pain points, criteria and staggered entrances. Existing Phase 3 autoplay and loading timing stay unchanged.

## Generation and persistence

Entering Phase 3 already calls the authenticated `campaigns` load endpoint. The updated generator uses saved products, business description, explicit audiences and direct competitor audiences. It proposes four to six distinct audiences when the profile contains an offering description or product. Consumer, parent, learner and individual segments are allowed. Named customer logos are not automatically treated as customer segments.

Generation is deterministic and local to the Edge Function. Offering vocabulary activates audience rules for language learning, education, software builders, commerce or marketing. Other offerings use explicitly inferred buying-context suggestions tied to the saved product. These rules are hypotheses, not a market analysis model. Each campaign contains its own proposed use case, pain point, criteria, keywords and source context. No audience sizes, market estimates or unresearched target locations are added.

An audience explicitly present in saved company research is labeled “Audience observed in research”; its proposed targeting and pain points still require validation. Competitor-derived and other inferred audiences are labeled “Inferred audience suggestion.” Source links support the underlying research, not a claim that an inferred audience is a verified customer. User-created or edited campaigns are labeled “Your campaign.” Editing removes generated details that could become stale after changing the audience.

The existing `campaign_plan` JSON and ownership-checked compare-and-swap RPC persist the result. Old empty plans, including plans emptied by removal of obsolete demo suggestions, regenerate automatically once. `generation_version` prevents repeated writes and respects intentional deletions from a newly generated plan. Existing nonempty plans, custom campaigns, edited campaigns and selections are preserved. A concurrent save wins over regeneration without being overwritten. Refreshing reuses saved campaigns.

If the profile has neither a product nor a business description, generation saves an explanatory warning instead of inventing an offering. Individual audiences remain individual audiences; this change does not implement consumer discovery in Phase 4.

Tests, builds and live provider requests were not run, following the request to avoid validation scripts. Remote changes require approval.
