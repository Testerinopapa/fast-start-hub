# Saved project JSON export

Use **Export project JSON** in the AutoGTM workflow header. The browser downloads a UTF-8, indented `.json` file named with the website, research job ID and export timestamp. This exports saved results only, including failed and unfinished research. It does not trigger provider calls, regeneration, retries, job advancement or email sending.

The file contains:

- `format` and `schema_version` identifying the report format.
- Project metadata and the latest project-level campaign-generation status/error.
- The selected research job's status, URLs, progress, errors and timestamps.
- Its company profile, competitor state, campaign plan, all saved campaign company-discovery states and company contact-discovery states, including their saved sources, selections, queries and diagnostics.
- Up to the latest 1,000 job events in chronological order; `events_truncated` indicates older omitted events.

This represents the selected research job, not the website's entire job history. Results from older campaign IDs within that job are preserved as stored. Missing stages are not filled with demo data. Console logs and raw provider responses are not included because they are not saved in these records. An independently running workflow may update records during export.

The existing `research-projects` Edge Function now accepts `{ "action": "export", "job_id": "..." }`. It authenticates through the existing login project and checks the research owner for every query. It reads database records directly rather than calling stage endpoints. Export field allowlists exclude authentication identities and unrelated columns. No credentials or frontend session objects are added to the report. Legacy list requests retain their existing behavior.

## Deployment

No database migration or new function is needed. After approval, deploy the updated existing function:

```powershell
npx supabase@2.120.0 functions deploy research-projects --project-ref cvpeezzkzsbosyuhmhmf --use-api
```

Publish the frontend through the existing Lovable workflow. An older backend produces an actionable deployment message instead of downloading its project-list response as a report.

This feature was prepared locally. No deployment, test script, build or provider request was run.
