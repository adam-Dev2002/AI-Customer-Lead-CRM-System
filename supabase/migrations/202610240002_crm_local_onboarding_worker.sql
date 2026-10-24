-- Outbound local worker transport. Only the server's service role has access.
begin;
create table if not exists public.crm_onboarding_workers (
  worker_id text primary key,
  ready boolean not null default false,
  last_seen_at timestamptz not null default now()
);
create table if not exists public.crm_connection_jobs (
  id uuid primary key,
  workspace_id text not null references public.crm_business_connections(workspace_id) on delete cascade,
  operation text not null check(operation in ('gmail-credential','sheets-credential','crm-credential','workflow','verify','enable','pause')),
  status text not null default 'Queued' check(status in ('Queued','Claimed','Succeeded','Failed','Uncertain')),
  payload text not null check(length(payload) between 20 and 1000000),
  claim_owner text,
  claim_id uuid unique,
  result_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists crm_connection_jobs_open_workspace on public.crm_connection_jobs(workspace_id) where status in ('Queued','Claimed');
alter table public.crm_onboarding_workers enable row level security;
alter table public.crm_connection_jobs enable row level security;
revoke all on public.crm_onboarding_workers, public.crm_connection_jobs from public,anon,authenticated;
grant all on public.crm_onboarding_workers, public.crm_connection_jobs to service_role;

create or replace function public.crm_onboarding_heartbeat(p_worker_id text,p_ready boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_worker_id !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'Invalid worker.'; end if;
  insert into public.crm_onboarding_workers(worker_id,ready) values(p_worker_id,p_ready)
    on conflict(worker_id) do update set ready=excluded.ready,last_seen_at=now();
  return true;
end; $$;
create or replace function public.crm_onboarding_worker_ready(p_worker_id text) returns boolean
language sql security definer set search_path = '' as $$
  select exists(select 1 from public.crm_onboarding_workers where worker_id=p_worker_id and ready and last_seen_at>now()-interval '90 seconds');
$$;
create or replace function public.crm_connection_enqueue(p_workspace_id text,p_revision bigint,p_payload text,p_job_id uuid,p_operation text,p_job_payload text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare current_revision bigint;
begin
  if p_workspace_id='clearflow' then raise exception 'Existing business is protected.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('connection:'||p_workspace_id,0));
  select revision into current_revision from public.crm_business_connections where workspace_id=p_workspace_id;
  if exists(select 1 from public.crm_connection_jobs where id=p_job_id and workspace_id=p_workspace_id and operation=p_operation and payload=p_job_payload) then
    return jsonb_build_object('applied',true,'revision',current_revision);
  end if;
  if current_revision is distinct from p_revision or exists(select 1 from public.crm_connection_jobs where workspace_id=p_workspace_id and status in ('Queued','Claimed')) then return jsonb_build_object('applied',false); end if;
  insert into public.crm_connection_jobs(id,workspace_id,operation,payload) values(p_job_id,p_workspace_id,p_operation,p_job_payload);
  update public.crm_business_connections set payload=p_payload,revision=revision+1,updated_at=now() where workspace_id=p_workspace_id returning revision into current_revision;
  return jsonb_build_object('applied',true,'revision',current_revision);
end; $$;
create or replace function public.crm_connection_job_claim(p_worker_id text,p_claim_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job public.crm_connection_jobs;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('worker:'||p_worker_id,0));
  select * into job from public.crm_connection_jobs where claim_id=p_claim_id and claim_owner=p_worker_id;
  if found then return to_jsonb(job); end if;
  if not public.crm_onboarding_worker_ready(p_worker_id) then return null; end if;
  -- Claims never expire automatically: a lost create/activation result is not
  -- permission to execute it again on another worker.
  select * into job from public.crm_connection_jobs where status='Queued' order by created_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.crm_connection_jobs set status='Claimed',claim_owner=p_worker_id,claim_id=p_claim_id,updated_at=now() where id=job.id returning * into job;
  return to_jsonb(job);
end; $$;
create or replace function public.crm_connection_job_read(p_job_id uuid,p_worker_id text,p_claim_id uuid) returns jsonb
language sql security definer set search_path = '' as $$
  select to_jsonb(j) from public.crm_connection_jobs j where id=p_job_id and claim_owner=p_worker_id and claim_id=p_claim_id;
$$;
create or replace function public.crm_connection_job_finish(p_job_id uuid,p_worker_id text,p_claim_id uuid,p_result_hash text,p_status text,p_revision bigint,p_payload text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job public.crm_connection_jobs; current_revision bigint;
begin
  if p_status not in ('Succeeded','Failed','Uncertain') or p_result_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid result.'; end if;
  select * into job from public.crm_connection_jobs where id=p_job_id and claim_owner=p_worker_id and claim_id=p_claim_id for update;
  if not found then raise exception 'Unknown claim.'; end if;
  if job.status<>'Claimed' then return jsonb_build_object('applied',job.status=p_status and job.result_hash=p_result_hash,'duplicate',true); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('connection:'||job.workspace_id,0));
  select revision into current_revision from public.crm_business_connections where workspace_id=job.workspace_id;
  if current_revision is distinct from p_revision then return jsonb_build_object('applied',false); end if;
  update public.crm_business_connections set payload=p_payload,revision=revision+1,updated_at=now() where workspace_id=job.workspace_id;
  update public.crm_connection_jobs set status=p_status,result_hash=p_result_hash,updated_at=now() where id=job.id;
  return jsonb_build_object('applied',true,'duplicate',false);
end; $$;
revoke all on function public.crm_onboarding_heartbeat(text,boolean),public.crm_onboarding_worker_ready(text),public.crm_connection_enqueue(text,bigint,text,uuid,text,text),public.crm_connection_job_claim(text,uuid),public.crm_connection_job_read(uuid,text,uuid),public.crm_connection_job_finish(uuid,text,uuid,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.crm_onboarding_heartbeat(text,boolean),public.crm_onboarding_worker_ready(text),public.crm_connection_enqueue(text,bigint,text,uuid,text,text),public.crm_connection_job_claim(text,uuid),public.crm_connection_job_read(uuid,text,uuid),public.crm_connection_job_finish(uuid,text,uuid,text,text,bigint,text) to service_role;
notify pgrst,'reload schema';
commit;
