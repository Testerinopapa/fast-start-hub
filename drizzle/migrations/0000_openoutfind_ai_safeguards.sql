create table public.openoutfind_ai_budget (id boolean primary key default true check(id), budget_day date not null default (now() at time zone 'UTC')::date, requests integer not null default 0 check(requests between 0 and 100), paused boolean not null default false);
grant all on public.openoutfind_ai_budget to service_role;
alter table public.openoutfind_ai_budget enable row level security;
create policy server_only on public.openoutfind_ai_budget for all to service_role using(true) with check(true);
create table public.openoutfind_ai_requests (run_id text not null, fingerprint text not null, created_at timestamptz not null default now(), stopped boolean not null default false, primary key(run_id,fingerprint));
grant all on public.openoutfind_ai_requests to service_role;
alter table public.openoutfind_ai_requests enable row level security;
create policy server_only on public.openoutfind_ai_requests for all to service_role using(true) with check(true);
create function public.openoutfind_ai_reserve(p_run_id text,p_fingerprint text) returns text language plpgsql security invoker set search_path=public as $$
declare b public.openoutfind_ai_budget; n integer; today date := (now() at time zone 'UTC')::date;
begin
 if p_run_id !~ '^github-[0-9]{1,24}-[0-9]{1,6}$' or p_fingerprint !~ '^[a-f0-9]{64}$' then return 'invalid'; end if;
 insert into public.openoutfind_ai_budget(id) values(true) on conflict(id) do nothing;
 select * into b from public.openoutfind_ai_budget where id=true for update;
 if b.paused then return 'paused'; end if;
 if exists(select 1 from public.openoutfind_ai_requests where run_id=p_run_id and stopped) then return 'stopped'; end if;
 if exists(select 1 from public.openoutfind_ai_requests where run_id=p_run_id and fingerprint=p_fingerprint) then return 'duplicate'; end if;
 if b.budget_day <> today then update public.openoutfind_ai_budget set budget_day=today,requests=0 where id=true; b.requests := 0; end if;
 select count(*) into n from public.openoutfind_ai_requests where run_id=p_run_id;
 if b.requests >= 100 or n >= 40 then return 'limit'; end if;
 insert into public.openoutfind_ai_requests(run_id,fingerprint) values(p_run_id,p_fingerprint);
 update public.openoutfind_ai_budget set requests=requests+1 where id=true;
 return 'admitted';
end $$;
revoke all on function public.openoutfind_ai_reserve(text,text) from public,anon,authenticated;
grant execute on function public.openoutfind_ai_reserve(text,text) to service_role;
create function public.openoutfind_ai_stop(p_run_id text,p_pause_all boolean) returns void language plpgsql security invoker set search_path=public as $$
begin
 perform 1 from public.openoutfind_ai_budget where id=true for update;
 update public.openoutfind_ai_requests set stopped=true where run_id=p_run_id;
 if p_pause_all then update public.openoutfind_ai_budget set paused=true where id=true; end if;
end $$;
revoke all on function public.openoutfind_ai_stop(text,boolean) from public,anon,authenticated;
grant execute on function public.openoutfind_ai_stop(text,boolean) to service_role;