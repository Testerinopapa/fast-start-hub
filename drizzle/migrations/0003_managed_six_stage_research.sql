CREATE TABLE public.splee_research_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL, request_id uuid NOT NULL,
 domain text NOT NULL, website_url text NOT NULL, state jsonb NOT NULL DEFAULT '{}'::jsonb,
 revision integer NOT NULL DEFAULT 0, working boolean NOT NULL DEFAULT false, claim_id uuid,
 ai_requests integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,request_id)
);
GRANT SELECT ON public.splee_research_jobs TO authenticated;
GRANT ALL ON public.splee_research_jobs TO service_role;
ALTER TABLE public.splee_research_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY splee_owner_read ON public.splee_research_jobs FOR SELECT TO authenticated USING (owner_id=(SELECT auth.uid()));
CREATE INDEX splee_owner_domain ON public.splee_research_jobs(owner_id,domain,created_at DESC);
CREATE FUNCTION public.splee_start(p_owner uuid,p_request uuid,p_domain text,p_url text,p_state jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE j public.splee_research_jobs;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 SELECT * INTO j FROM public.splee_research_jobs WHERE owner_id=p_owner AND request_id=p_request;
 IF FOUND THEN IF j.domain<>p_domain THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF; RETURN to_jsonb(j); END IF;
 SELECT * INTO j FROM public.splee_research_jobs WHERE owner_id=p_owner AND domain=p_domain AND created_at>now()-interval '24 hours' ORDER BY created_at DESC LIMIT 1;
 IF FOUND THEN RETURN to_jsonb(j); END IF;
 IF (SELECT count(*) FROM public.splee_research_jobs WHERE owner_id=p_owner AND created_at>now()-interval '24 hours')>=5 THEN RAISE EXCEPTION 'DAILY_LIMIT'; END IF;
 INSERT INTO public.splee_research_jobs(owner_id,request_id,domain,website_url,state) VALUES(p_owner,p_request,p_domain,p_url,p_state) RETURNING * INTO j;
 RETURN to_jsonb(j);
END $$;
CREATE FUNCTION public.splee_claim(p_job uuid,p_owner uuid,p_revision integer,p_state jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE j public.splee_research_jobs;
BEGIN
 SELECT * INTO j FROM public.splee_research_jobs WHERE id=p_job AND owner_id=p_owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF j.revision<>p_revision OR j.working THEN RETURN jsonb_build_object('claimed',false,'job',to_jsonb(j)); END IF;
 UPDATE public.splee_research_jobs SET state=p_state,working=true,claim_id=gen_random_uuid(),revision=revision+1,updated_at=now() WHERE id=j.id RETURNING * INTO j;
 RETURN jsonb_build_object('claimed',true,'job',to_jsonb(j));
END $$;
CREATE FUNCTION public.splee_finish(p_job uuid,p_owner uuid,p_claim uuid,p_state jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE j public.splee_research_jobs;
BEGIN
 SELECT * INTO j FROM public.splee_research_jobs WHERE id=p_job AND owner_id=p_owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF j.claim_id<>p_claim OR NOT j.working THEN RETURN to_jsonb(j); END IF;
 UPDATE public.splee_research_jobs SET state=p_state,working=false,claim_id=null,revision=revision+1,updated_at=now() WHERE id=j.id RETURNING * INTO j;
 RETURN to_jsonb(j);
END $$;
CREATE FUNCTION public.splee_ai_admit(p_job uuid,p_owner uuid) RETURNS text LANGUAGE plpgsql SET search_path=public AS $$
DECLARE j public.splee_research_jobs; b public.openoutfind_ai_budget; today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
 INSERT INTO public.openoutfind_ai_budget(id) VALUES(true) ON CONFLICT(id) DO NOTHING;
 SELECT * INTO b FROM public.openoutfind_ai_budget WHERE id=true FOR UPDATE;
 SELECT * INTO j FROM public.splee_research_jobs WHERE id=p_job AND owner_id=p_owner FOR UPDATE;
 IF NOT FOUND OR NOT j.working THEN RETURN 'invalid'; END IF;
 IF b.paused THEN RETURN 'paused'; END IF;
 IF b.budget_day<>today THEN UPDATE public.openoutfind_ai_budget SET budget_day=today,requests=0 WHERE id=true; b.requests:=0; END IF;
 IF b.requests>=100 OR j.ai_requests>=40 THEN RETURN 'limit'; END IF;
 UPDATE public.openoutfind_ai_budget SET requests=requests+1 WHERE id=true;
 UPDATE public.splee_research_jobs SET ai_requests=ai_requests+1 WHERE id=j.id;
 RETURN 'admitted';
END $$;
REVOKE ALL ON FUNCTION public.splee_start(uuid,uuid,text,text,jsonb),public.splee_claim(uuid,uuid,integer,jsonb),public.splee_finish(uuid,uuid,uuid,jsonb),public.splee_ai_admit(uuid,uuid) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.splee_start(uuid,uuid,text,text,jsonb),public.splee_claim(uuid,uuid,integer,jsonb),public.splee_finish(uuid,uuid,uuid,jsonb),public.splee_ai_admit(uuid,uuid) TO service_role;