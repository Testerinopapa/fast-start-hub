-- Retain the latest bounded model response for owner-scoped troubleshooting.
-- No campaign, profile or previous generation record is rewritten by migration.
create function public.autogtm_record_campaign_diagnostic(p_job uuid, p_owner uuid,
  p_request uuid, p_diagnostic jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare project uuid;
begin
  if jsonb_typeof(p_diagnostic) is distinct from 'object'
    or octet_length(p_diagnostic::text) > 270000
    or jsonb_typeof(p_diagnostic->'validation') is distinct from 'string' then
    raise exception 'INVALID_DIAGNOSTIC';
  end if;
  select project_id into project from public.company_profiles where job_id = p_job and owner_id = p_owner;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  update public.projects set campaign_generation = campaign_generation || jsonb_build_object('diagnostic', p_diagnostic)
    where id = project and owner_id = p_owner
      and campaign_generation->>'job_id' = p_job::text
      and campaign_generation->>'request_id' = p_request::text
      and campaign_generation->>'status' = 'running';
  return found;
end;
$$;
revoke all on function public.autogtm_record_campaign_diagnostic(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.autogtm_record_campaign_diagnostic(uuid, uuid, uuid, jsonb) to service_role;
notify pgrst, 'reload schema';
