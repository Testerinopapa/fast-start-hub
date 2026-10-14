-- One automatic model request per project, including across research jobs.
alter table public.projects add column campaign_generation jsonb;

create function public.autogtm_claim_campaign_generation(p_job uuid, p_owner uuid,
  p_mode text, p_request uuid, p_version integer, p_model text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare profile public.company_profiles%rowtype; generation jsonb; plan jsonb;
begin
  select * into profile from public.company_profiles where job_id = p_job and owner_id = p_owner;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  select campaign_generation into generation from public.projects where id = profile.project_id and owner_id = p_owner for update;
  select * into profile from public.company_profiles where job_id = p_job and owner_id = p_owner for update;
  if profile.competitor_research->>'status' is distinct from 'completed'
    or not exists (select 1 from public.research_jobs where id = p_job and owner_id = p_owner and status = 'completed') then raise exception 'RESEARCH_PENDING'; end if;
  if p_mode not in ('auto', 'explicit') then raise exception 'INVALID_GENERATION_MODE'; end if;
  plan := profile.campaign_plan;
  if plan is null then
    plan := public.autogtm_save_campaigns(p_job, p_owner, 0,
      '{"status":"completed","version":0,"campaigns":[],"selected_ids":[],"warnings":[]}'::jsonb)->'plan';
  end if;
  if generation->>'status' = 'running' and (generation->>'started_at')::timestamptz < now() - interval '2 minutes' then
    generation := generation || jsonb_build_object('status', 'failed', 'error', 'The reserved generation was interrupted. Use Regenerate to make a new request.', 'finished_at', now());
    update public.projects set campaign_generation = generation where id = profile.project_id and owner_id = p_owner;
  end if;
  if generation->>'status' = 'running' or generation->>'request_id' = p_request::text
    or (p_mode = 'auto' and coalesce((generation->>'auto_attempted')::boolean, false)) then
    return jsonb_build_object('claimed', false, 'generation', generation, 'plan', plan);
  end if;
  if p_mode = 'explicit' and coalesce((profile.campaign_plan->>'version')::integer, 0) <> p_version then raise exception 'CAMPAIGN_CONFLICT'; end if;
  if (select count(*) from jsonb_array_elements(plan->'campaigns') c where c->>'origin' is distinct from 'suggested') > 8 then raise exception 'CAMPAIGN_LIMIT'; end if;
  generation := jsonb_build_object('status', 'running', 'request_id', p_request, 'job_id', p_job,
    'auto_attempted', true, 'attempts', coalesce((generation->>'attempts')::integer, 0) + 1,
    'started_at', now(), 'error', null, 'model', p_model);
  update public.projects set campaign_generation = generation where id = profile.project_id and owner_id = p_owner;
  return jsonb_build_object('claimed', true, 'generation', generation, 'plan', plan);
end;
$$;

create function public.autogtm_finish_campaign_generation(p_job uuid, p_owner uuid,
  p_request uuid, p_campaigns jsonb, p_error text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare profile public.company_profiles%rowtype; generation jsonb; preserved jsonb; suggestions jsonb;
  campaigns jsonb; selected jsonb; plan jsonb; failure text := p_error;
begin
  select * into profile from public.company_profiles where job_id = p_job and owner_id = p_owner;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  select campaign_generation into generation from public.projects where id = profile.project_id and owner_id = p_owner for update;
  select * into profile from public.company_profiles where job_id = p_job and owner_id = p_owner for update;
  plan := profile.campaign_plan;
  if generation->>'request_id' is distinct from p_request::text or generation->>'job_id' is distinct from p_job::text
    or generation->>'status' is distinct from 'running' then
    return jsonb_build_object('generation', generation, 'plan', plan);
  end if;
  if failure is null then
    if jsonb_typeof(p_campaigns) is distinct from 'array' or jsonb_array_length(p_campaigns) not between 4 and 6
      or exists (select 1 from jsonb_array_elements(p_campaigns) c where c->>'origin' is distinct from 'suggested'
        or c->>'audience_basis' is distinct from 'inferred') then raise exception 'INVALID_GENERATED_CAMPAIGNS'; end if;
    -- Read customizations at completion, not from the pre-request snapshot.
    select coalesce(jsonb_agg(c order by ord), '[]'::jsonb) into preserved
      from jsonb_array_elements(plan->'campaigns') with ordinality as t(c, ord) where c->>'origin' is distinct from 'suggested';
    select coalesce(jsonb_agg(c order by ord), '[]'::jsonb) into suggestions from (
      select c, ord from jsonb_array_elements(p_campaigns) with ordinality as t(c, ord)
      where not exists (select 1 from jsonb_array_elements(preserved) old
        where lower(trim(old->>'target_audience')) = lower(trim(c->>'target_audience')))
      order by ord limit greatest(0, 12 - jsonb_array_length(preserved))
    ) filtered;
    if jsonb_array_length(suggestions) < 4 then
      failure := 'Custom campaigns changed or duplicate the new suggestions. Your saved plan was preserved; make room for four suggestions before regenerating.';
    else
      campaigns := preserved || suggestions;
      select coalesce(jsonb_agg(id), '[]'::jsonb) into selected from jsonb_array_elements_text(plan->'selected_ids') id
        where exists (select 1 from jsonb_array_elements(preserved) c where c->>'id' = id);
      if jsonb_array_length(selected) = 0 then selected := jsonb_build_array(suggestions->0->>'id'); end if;
      plan := public.autogtm_save_campaigns(p_job, p_owner, (plan->>'version')::integer,
        plan || jsonb_build_object('campaigns', campaigns, 'selected_ids', selected, 'generation_version', 3,
          'warnings', jsonb_build_array('AI audience suggestions are inferred opportunities, not verified customers.')))->'plan';
    end if;
  end if;
  generation := generation || jsonb_build_object('status', case when failure is null then 'completed' else 'failed' end,
    'error', failure, 'finished_at', now());
  update public.projects set campaign_generation = generation where id = profile.project_id and owner_id = p_owner;
  return jsonb_build_object('generation', generation, 'plan', plan);
end;
$$;
revoke all on function public.autogtm_claim_campaign_generation(uuid, uuid, text, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.autogtm_finish_campaign_generation(uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.autogtm_claim_campaign_generation(uuid, uuid, text, uuid, integer, text) to service_role;
grant execute on function public.autogtm_finish_campaign_generation(uuid, uuid, uuid, jsonb, text) to service_role;
notify pgrst, 'reload schema';
