-- Explicit recovery only: one fresh bounded run after an empty completed search.
create function public.autogtm_retry_empty_competitors(p_job uuid, p_owner uuid, p_version integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare previous jsonb; saved jsonb;
begin
  select competitor_research into previous from public.company_profiles
    where job_id = p_job and owner_id = p_owner for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  if (previous->>'version')::integer <> p_version then
    return jsonb_build_object('applied', false, 'state', previous);
  end if;
  if previous->>'status' is distinct from 'completed'
    or jsonb_array_length(previous->'results') <> 0
    or coalesce((previous->>'run')::integer, 1) >= 2 then
    raise exception 'COMPETITOR_RETRY_LIMIT';
  end if;
  saved := jsonb_build_object('status', 'searching', 'version', p_version + 1,
    'run', 2, 'queries', '[]'::jsonb, 'searches_used', 0, 'search_successes', 0,
    'candidates', '[]'::jsonb, 'results', '[]'::jsonb, 'warnings', '[]'::jsonb,
    'batch_attempted', false, 'provider_job_id', null, 'pages_completed', 0,
    'working', false, 'updated_at', now());
  update public.company_profiles set competitor_research = saved where job_id = p_job and owner_id = p_owner;
  return jsonb_build_object('applied', true, 'state', saved);
end;
$$;
revoke all on function public.autogtm_retry_empty_competitors(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.autogtm_retry_empty_competitors(uuid, uuid, integer) to service_role;
notify pgrst, 'reload schema';
