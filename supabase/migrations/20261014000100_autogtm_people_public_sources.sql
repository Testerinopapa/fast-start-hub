-- Broader professional-source discovery: cumulative limits, never reset on upgrade.
create or replace function public.autogtm_save_people(p_job uuid, p_owner uuid, p_campaign uuid,
  p_domain text, p_version integer, p_state jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare profile public.company_profiles%rowtype; previous jsonb; saved jsonb;
begin
  select * into profile from public.company_profiles where job_id = p_job and owner_id = p_owner for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  if not exists (select 1 from jsonb_array_elements(profile.campaign_plan->'campaigns') c where c->>'id' = p_campaign::text)
    or not exists (select 1 from jsonb_array_elements(profile.company_discovery->p_campaign::text->'saved') c where c->>'domain' = p_domain)
    or coalesce(profile.company_discovery->p_campaign::text->'removed_domains' ? p_domain, false) then
    raise exception 'COMPANY_SELECTION_CHANGED';
  end if;
  previous := profile.people_discovery->p_domain;
  if coalesce((previous->>'version')::integer, 0) <> p_version then
    return jsonb_build_object('applied', false, 'state', previous);
  end if;
  if previous is null and (select count(*) from jsonb_object_keys(profile.people_discovery)) >= 10 then
    raise exception 'PEOPLE_LIMIT';
  end if;
  if jsonb_typeof(p_state) is distinct from 'object'
    or p_state->>'domain' is distinct from p_domain
    or coalesce(p_state->>'status', '') not in ('searching', 'researching', 'completed', 'failed')
    or jsonb_typeof(p_state->'results') is distinct from 'array'
    or jsonb_typeof(p_state->'urls') is distinct from 'array'
    or jsonb_typeof(p_state->'working') is distinct from 'boolean'
    or jsonb_typeof(p_state->'searches_used') is distinct from 'number'
    or jsonb_typeof(p_state->'pages_attempted') is distinct from 'number' then raise exception 'INVALID_PEOPLE_STATE'; end if;
  if jsonb_array_length(p_state->'urls') > 4 or jsonb_array_length(p_state->'results') > 10
    or (p_state->>'searches_used')::integer not between 0 and 2
    or (p_state->>'pages_attempted')::integer not between 0 and jsonb_array_length(p_state->'urls')
    or (p_state->>'searches_used')::integer < coalesce((previous->>'searches_used')::integer, 0)
    or (p_state->>'pages_attempted')::integer < coalesce((previous->>'pages_attempted')::integer, 0)
    or exists (select 1 from jsonb_array_elements(p_state->'results') c
      where c->>'company_domain' is distinct from p_domain or coalesce(c->>'name', '') = ''
        or c->>'research_status' is distinct from 'publicly_identified'
        or c->'contact_details_verified' is distinct from 'false'::jsonb
        or jsonb_array_length(c->'source_urls') = 0) then raise exception 'PEOPLE_LIMIT_OR_INVALID_CONTACT'; end if;
  saved := p_state || jsonb_build_object('version', p_version + 1, 'updated_at', now());
  update public.company_profiles set people_discovery = jsonb_set(people_discovery, array[p_domain], saved)
    where job_id = p_job and owner_id = p_owner;
  return jsonb_build_object('applied', true, 'state', saved);
end;
$$;
revoke all on function public.autogtm_save_people(uuid, uuid, uuid, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.autogtm_save_people(uuid, uuid, uuid, text, integer, jsonb) to service_role;
notify pgrst, 'reload schema';

