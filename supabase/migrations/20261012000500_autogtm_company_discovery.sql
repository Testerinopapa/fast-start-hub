-- Campaign-keyed discovery and saved leads inherit the existing profile's RLS.
alter table public.company_profiles add column company_discovery jsonb not null default '{}';

create function public.autogtm_save_discovery(p_job uuid, p_owner uuid, p_campaign uuid,
  p_version integer, p_plan_version integer, p_state jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare profile public.company_profiles%rowtype; previous jsonb; saved jsonb;
begin
  select * into profile from public.company_profiles where job_id = p_job and owner_id = p_owner for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  if coalesce((profile.campaign_plan->>'version')::integer, 0) <> p_plan_version
    or not exists (select 1 from jsonb_array_elements(profile.campaign_plan->'campaigns') c where c->>'id' = p_campaign::text) then
    raise exception 'CAMPAIGN_CHANGED';
  end if;
  previous := profile.company_discovery->p_campaign::text;
  if coalesce((previous->>'version')::integer, 0) <> p_version then
    return jsonb_build_object('applied', false, 'state', previous);
  end if;
  if jsonb_typeof(p_state) is distinct from 'object'
    or coalesce(p_state->>'status', '') not in ('searching','researching','completed','failed')
    or jsonb_typeof(p_state->'criteria') is distinct from 'object'
    or p_state->'criteria'->>'campaign_id' is distinct from p_campaign::text
    or jsonb_typeof(p_state->'queries') is distinct from 'array'
    or jsonb_typeof(p_state->'candidates') is distinct from 'array'
    or jsonb_typeof(p_state->'results') is distinct from 'array'
    or jsonb_typeof(p_state->'saved') is distinct from 'array'
    or jsonb_typeof(p_state->'removed_domains') is distinct from 'array'
    or jsonb_typeof(p_state->'working') is distinct from 'boolean'
    or jsonb_typeof(p_state->'run') is distinct from 'number'
    or jsonb_typeof(p_state->'searches_used') is distinct from 'number'
    or jsonb_typeof(p_state->'pages_attempted') is distinct from 'number' then
    raise exception 'INVALID_DISCOVERY';
  end if;
  if jsonb_array_length(p_state->'queries') > 3 or jsonb_array_length(p_state->'candidates') > 10
    or jsonb_array_length(p_state->'results') > 10 or jsonb_array_length(p_state->'saved') > 30
    or (p_state->>'run')::integer not between 1 and 3
    or (p_state->>'searches_used')::integer not between 0 and jsonb_array_length(p_state->'queries')
    or (p_state->>'pages_attempted')::integer not between 0 and jsonb_array_length(p_state->'candidates')
    or exists (select 1 from jsonb_array_elements(p_state->'results') c where coalesce(c->>'domain','') = '')
    or exists (select 1 from jsonb_array_elements(p_state->'saved') c where coalesce(c->>'domain','') = '')
    or (select count(*) from jsonb_array_elements(p_state->'results')) <>
       (select count(distinct c->>'domain') from jsonb_array_elements(p_state->'results') c)
    or (select count(*) from jsonb_array_elements(p_state->'saved')) <>
       (select count(distinct c->>'domain') from jsonb_array_elements(p_state->'saved') c) then
    raise exception 'DISCOVERY_LIMIT_OR_DUPLICATE';
  end if;
  if previous is not null then
    if (p_state->>'run')::integer = (previous->>'run')::integer then
      if (p_state->>'searches_used')::integer < (previous->>'searches_used')::integer
        or (p_state->>'pages_attempted')::integer < (previous->>'pages_attempted')::integer
        or p_state->>'signature' is distinct from previous->>'signature'
        or p_state->'queries' is distinct from previous->'queries' then raise exception 'DISCOVERY_LIMIT_OR_CONFLICT'; end if;
    elsif (p_state->>'run')::integer <> (previous->>'run')::integer + 1
      or p_state->>'signature' is not distinct from previous->>'signature'
      or p_state->'saved' is distinct from previous->'saved' then raise exception 'INVALID_DISCOVERY_RESTART'; end if;
  end if;
  saved := p_state || jsonb_build_object('version', p_version + 1, 'updated_at', now());
  update public.company_profiles set company_discovery = jsonb_set(company_discovery, array[p_campaign::text], saved)
    where job_id = p_job and owner_id = p_owner;
  return jsonb_build_object('applied', true, 'state', saved);
end;
$$;
revoke all on function public.autogtm_save_discovery(uuid, uuid, uuid, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.autogtm_save_discovery(uuid, uuid, uuid, integer, integer, jsonb) to service_role;
notify pgrst, 'reload schema';
