-- Private OpenOutFind lead-review workspace. Server (service_role) access only.
create table public.lead_review_owners (
  id uuid primary key default gen_random_uuid(),
  auth_issuer text not null,
  auth_subject text not null,
  created_at timestamptz not null default now(),
  unique (auth_issuer, auth_subject)
);
create table public.lead_import_codes (
  code_hash text primary key check (code_hash ~ '^[a-f0-9]{64}$'),
  owner_id uuid not null references public.lead_review_owners(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_run_id text,
  created_at timestamptz not null default now()
);
create index lead_import_codes_owner on public.lead_import_codes(owner_id);
create table public.lead_runs (
  owner_id uuid not null references public.lead_review_owners(id) on delete cascade,
  run_id text not null,
  campaign_name text,
  research_company text,
  source text not null default 'openoutfind-github-actions',
  returned_leads integer not null default 0,
  complete_profiles integer not null default 0,
  incomplete_profiles integer not null default 0,
  imported_at timestamptz not null default now(),
  primary key (owner_id, run_id)
);
create table public.lead_results (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.lead_review_owners(id) on delete cascade,
  lead_key text not null check (lead_key ~ '^[a-f0-9]{64}$'),
  person_name text, title text, company text,
  company_website text, professional_profile text, qualification_reason text,
  checks jsonb not null default '{}'::jsonb,
  needs_review boolean not null default true,
  campaign_name text,
  source text not null default 'openoutfind-github-actions',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_run_id text not null,
  review_status text not null default 'pending' check (review_status in ('pending','verified','rejected')),
  manual_score integer check (manual_score between 0 and 100),
  manual_notes text check (char_length(manual_notes) <= 2000),
  evidence_url text check (evidence_url ~ '^https://'),
  reviewed_at timestamptz,
  constraint verified_requires_evidence check (review_status <> 'verified' or (evidence_url is not null and reviewed_at is not null)),
  unique (owner_id, lead_key)
);
create table public.lead_sightings (
  lead_id uuid not null references public.lead_results(id) on delete cascade,
  owner_id uuid not null references public.lead_review_owners(id) on delete cascade,
  run_id text not null,
  campaign_name text,
  complete boolean not null,
  seen_at timestamptz not null default now(),
  primary key (lead_id, run_id)
);

grant all on public.lead_review_owners, public.lead_import_codes, public.lead_runs, public.lead_results, public.lead_sightings to service_role;
revoke all on public.lead_review_owners, public.lead_import_codes, public.lead_runs, public.lead_results, public.lead_sightings from anon, authenticated, public;
alter table public.lead_review_owners enable row level security;
alter table public.lead_import_codes enable row level security;
alter table public.lead_runs enable row level security;
alter table public.lead_results enable row level security;
alter table public.lead_sightings enable row level security;
create policy server_only on public.lead_review_owners for all to service_role using (true) with check (true);
create policy server_only on public.lead_import_codes for all to service_role using (true) with check (true);
create policy server_only on public.lead_runs for all to service_role using (true) with check (true);
create policy server_only on public.lead_results for all to service_role using (true) with check (true);
create policy server_only on public.lead_sightings for all to service_role using (true) with check (true);

-- Atomic one-time import. Same run may re-deliver (idempotent); human review fields are never written here.
create or replace function public.openoutfind_lead_ingest(p_code_hash text, p_run_id text, p_payload jsonb)
returns jsonb language plpgsql set search_path to 'public' as $$
declare c public.lead_import_codes; l jsonb; lid uuid; n_new integer := 0; n_seen integer := 0; camp text;
begin
  if p_code_hash !~ '^[a-f0-9]{64}$' or p_run_id !~ '^github-[0-9]{1,24}$' or jsonb_typeof(p_payload->'leads') <> 'array' then
    return jsonb_build_object('status','invalid');
  end if;
  select * into c from public.lead_import_codes where code_hash = p_code_hash for update;
  if not found then return jsonb_build_object('status','invalid_code'); end if;
  if c.used_at is not null and c.used_run_id is distinct from p_run_id then return jsonb_build_object('status','code_used'); end if;
  if c.used_at is null and c.expires_at <= now() then return jsonb_build_object('status','code_expired'); end if;
  if c.used_at is null then
    update public.lead_import_codes set used_at = now(), used_run_id = p_run_id where code_hash = p_code_hash;
  end if;
  camp := left(p_payload->>'campaign_name', 300);
  insert into public.lead_runs(owner_id, run_id, campaign_name, research_company, returned_leads, complete_profiles, incomplete_profiles)
  values (c.owner_id, p_run_id, camp, left(p_payload->>'research_company',300),
    jsonb_array_length(p_payload->'leads'),
    (select count(*) from jsonb_array_elements(p_payload->'leads') x where not (x->>'needs_review')::boolean),
    (select count(*) from jsonb_array_elements(p_payload->'leads') x where (x->>'needs_review')::boolean))
  on conflict (owner_id, run_id) do update set imported_at = now();
  for l in select * from jsonb_array_elements(p_payload->'leads') loop
    insert into public.lead_results(owner_id, lead_key, person_name, title, company, company_website, professional_profile,
      qualification_reason, checks, needs_review, campaign_name, last_run_id)
    values (c.owner_id, l->>'lead_key', l->>'person_name', l->>'title', l->>'company', l->>'company_website',
      l->>'professional_profile', l->>'qualification_reason', coalesce(l->'checks','{}'::jsonb), (l->>'needs_review')::boolean, camp, p_run_id)
    on conflict (owner_id, lead_key) do update set
      person_name = excluded.person_name, title = excluded.title, company = excluded.company,
      company_website = excluded.company_website, professional_profile = excluded.professional_profile,
      qualification_reason = excluded.qualification_reason, checks = excluded.checks, needs_review = excluded.needs_review,
      campaign_name = excluded.campaign_name, last_run_id = excluded.last_run_id, last_seen_at = now()
    returning id into lid;
    insert into public.lead_sightings(lead_id, owner_id, run_id, campaign_name, complete)
    values (lid, c.owner_id, p_run_id, camp, not (l->>'needs_review')::boolean)
    on conflict (lead_id, run_id) do nothing;
    if found then n_new := n_new + 1; else n_seen := n_seen + 1; end if;
  end loop;
  return jsonb_build_object('status','imported','new_sightings',n_new,'already_imported',n_seen);
end $$;
revoke all on function public.openoutfind_lead_ingest(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.openoutfind_lead_ingest(text,text,jsonb) to service_role;
