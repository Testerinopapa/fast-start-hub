# Explee ↔ Splee six-stage QA integration

This is a **pipeline-only** integration in Explee's GitHub repository. It does not change Explee's frontend, authentication, Supabase functions, or current Context.dev/OpenOutFind pipeline, and it NEVER sends or approves email. It is an independent, parallel benchmark for the stages of Explee's Go-To-Market output.

## Splee upstream and licensing

- Upstream: https://github.com/Iweisc/splee
- Pin: `3c2b1723bc9651a2cd2872ae6a3b4939501c8435` (Nov 20, 2026), so upstream changes cannot silently alter our QA.
- License: **AGPL-3.0**. Splee is an independently licensed Rust/PostgreSQL/Claude application, not a permissively licensed Explee library. We have **not copied Splee's implementation into our repository**, linked its Rust code into Explee, or changed Explee's license.
- If you modify and offer Splee over a network, honor its AGPL source-availability and notice requirements. Review the full license before incorporating its implementation into a proprietary distribution.
- Splee README claims the full six-stage workflow, but that claim does **not** demonstrate accurate company facts, prospects or email content.
- Splee itself must be deployed separately for live API testing. It requires PostgreSQL, its own agent/Claude configuration and a Splee API key. The GitHub workflow does **not** silently deploy a production Splee server or run agent code against the public internet.

## What this integration does today

**Workflow:** [Explee Splee Six-Stage QA](../.github/workflows/explee-splee-qa.yml)

### On every relevant PR or push: offline + source verification

1. Read the exact pinned Splee GitHub source (sparse checkout, read-only; Splee is not built or executed).
2. Check the AGPL license and actual source for research, competitor routes, campaigns, company/person discovery and draft writing.
3. Check Splee's published API v1 endpoints used by the live adapter. This is based on the code, not README marketing.
4. Run local Python mock and synthetic quality tests.
5. Produce two **aggregate-only** artifacts: `splee-source-contract.json` and `splee-synthetic-qa.json`.

This confirms our adapter/source compatibility only. Synthetic results cannot be represented as real lead quality. No secrets are needed for this mode.

### Optional live comparison: existing Splee project, read only

**Prerequisite:** A separately hosted **Splee instance with an existing research project**. In that Splee test instance, set `SENDING_ENABLED=false`; do not connect real sending mailboxes for QA. Create a Splee API key with as little access as the instance allows. Using an isolated test Splee server/account is strongly recommended.

In Explee's GitHub repository:

- **Repository variable** `SPLEE_BASE_URL`: the public HTTPS base URL of your own deployed Splee API, e.g. `https://splee-test.example.com`. The adapter calls `/api/v1/*`; it refuses HTTP, IP-based URLs, redirects and URL-embedded credentials.
- **Repository secret** `SPLEE_API_KEY`: a Splee API key for the QA organization; never paste it into chat, repository variables or code.
- **Workflow input** `splee_project_id`: the UUID of an existing Splee research project.
- Optional workflow input `explee_source_run_id`: the GitHub Actions run ID of a completed **Explee Pipeline QA** run with `pipeline-live.json` available as `explee-live-qa-<run>-*`. Example: `44815551658` (historical, artifact may eventually expire). This compares project domains and campaign counts; it does **not** prove customer fit.

Run: **Actions → Explee Splee Six-Stage QA → Run workflow → run_live=true**.

The live job accesses **six read-only API endpoint categories** under Splee API v1 (more than six HTTP GETs when pagination is necessary). It reads up to 1,000 companies, 1,000 people, 1,000 email drafts and 1,000 research rows; larger datasets are explicitly flagged as not fully scanned:

1. `GET /api/v1/projects` (ensures selected project belongs to the API-key organization and reads saved company metadata).
2. `GET /api/v1/projects/{id}/campaigns`.
3. `GET /api/v1/projects/{id}/companies`.
4. `GET /api/v1/projects/{id}/leads`.
5. `GET /api/v1/projects/{id}/research` (company Q&A grid, not full fact verification).
6. `GET /api/v1/emails?project_id={id}&status=draft` (drafts only).

**It never invokes project research creation, discovery writes, email drafting, approval, campaign launch, or sending endpoints.** It never exports individual lead records, names, emails or content. The aggregate report `splee-live-qa.json` contains counts, missing-field/duplicate/template flags and safe status codes only. Paginated results are fetched in pages of 100 with an upper bound of 1,000 records per category.

Splee's project competitor route is exposed to its browser session rather than its API-key v1 surface, so we explicitly report `competitor_research: not_exposed_by_api_v1`. Do not imply this step passed. A later Splee-owned API enhancement or permissioned sidecar is needed to inspect competitor output without a browser login.

## Stages and current coverage

| Stage | Static source | Live API-key quality audit |
| --- | --- | --- |
| Company research | Splee explore agent | Presence of saved business metadata, expected-domain match; **not fact-checked** |
| Competitors | Splee competitor routes | **Not exposed** by read-only API v1 |
| Campaign generation | Splee explore agent | Campaign count and missing names/descriptions; **not buyer-fit verified** |
| Buyer companies | Splee prospect agent | Company count, missing first-party source, duplicates, self-matches and editorial links |
| Decision-makers | Splee prospect agent | Name/role/employer/source completeness and duplicate detection; employment unverified |
| Emails/outbound | Splee writer agent | Existing draft count, unfilled template indicators; **never sends** |

All quality reports preserve the distinction between complete fields, actual source evidence, *independent factual verification* and real sales readiness. An empty stage is not a pass. Even if all fields exist, `quality_verified` remains false until human or separately validated source checks confirm the business facts and roles.

## Relationship to the current Explee test pipeline

- [Explee Pipeline QA](../.github/workflows/explee-pipeline-qa.yml) remains the Context.dev research + local campaign-stage test.
- [Explee OpenOutFind Lead QA](../.github/workflows/explee-openoutfind.yml) remains the optional OpenOutFind people-finder stage.
- **Splee Six-Stage QA** is a third, independent and **read-only** comparison runner. It does not replace the above or claim functional service integration without Splee deployment.

The objective is to eventually benchmark both engines on identical businesses with source-backed pass/fail criteria. Current reports are *coverage and consistency diagnostics*, not a validated recommendation to send live sales emails.

## Offline reproduction

From the Explee checkout:

```bash
python -m unittest discover -s scripts -p 'test_splee_pipeline_qa.py' -v
python scripts/splee_pipeline_qa.py --output artifacts/splee-synthetic-qa.json fixture --input scripts/fixtures/splee-qa-synthetic.json
```

To verify upstream, separately check out Splee at the pinned commit into `splee-upstream/`, then:

```bash
python scripts/splee_source_contract.py --root splee-upstream --output artifacts/splee-source-contract.json
```

The repo `scripts/fixtures/splee-qa-synthetic.json` contains **invented examples** for unit tests, never actual Splee or Explee leads.
