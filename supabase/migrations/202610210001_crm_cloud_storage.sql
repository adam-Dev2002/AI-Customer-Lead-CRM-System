-- Run once in the EXISTING Supabase project's SQL editor. Contains no customer data.
-- Browser users still access CRM data through authorized application API routes.
begin;
create table if not exists public.crm_workspace_state (
  workspace_id text primary key check (workspace_id = 'clearflow'),
  revision bigint not null default 0 check (revision >= 0),
  data jsonb not null check (
    data ?& array['version','settings','leads','drafts','tasks','activities','syncChanges','mailJobs']
    and data->>'version' = '1' and jsonb_typeof(data->'settings') = 'object'
    and jsonb_typeof(data->'leads') = 'array' and jsonb_typeof(data->'drafts') = 'array'
    and jsonb_typeof(data->'tasks') = 'array' and jsonb_typeof(data->'activities') = 'array'
    and jsonb_typeof(data->'syncChanges') = 'array' and jsonb_typeof(data->'mailJobs') = 'array'
  ),
  updated_at timestamptz not null default now()
);
create table if not exists public.crm_commit_receipts (
  request_id uuid primary key,
  revision bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists crm_commit_receipts_created on public.crm_commit_receipts(created_at);
create table if not exists public.crm_rate_limits (
  key text primary key,
  count integer not null,
  expires_at timestamptz not null
);
alter table public.crm_workspace_state enable row level security;
alter table public.crm_commit_receipts enable row level security;
alter table public.crm_rate_limits enable row level security;
revoke all on public.crm_workspace_state, public.crm_commit_receipts, public.crm_rate_limits from public, anon, authenticated;
grant all on public.crm_workspace_state, public.crm_commit_receipts, public.crm_rate_limits to service_role;

create or replace function public.crm_store_read() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare saved public.crm_workspace_state;
begin
  select * into saved from public.crm_workspace_state where workspace_id = 'clearflow';
  if not found then raise exception 'Import the existing CRM workspace first.' using errcode = 'P0002'; end if;
  return jsonb_build_object('revision', saved.revision, 'data', saved.data);
end;
$$;

create or replace function public.crm_store_commit(p_revision bigint, p_data jsonb, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare current_revision bigint;
begin
  select revision into current_revision from public.crm_workspace_state where workspace_id = 'clearflow' for update;
  if not found then raise exception 'Import the existing CRM workspace first.'; end if;
  if exists(select 1 from public.crm_commit_receipts where request_id = p_request_id) then
    return jsonb_build_object('applied', true);
  end if;
  if current_revision <> p_revision then return jsonb_build_object('applied', false); end if;
  update public.crm_workspace_state set data = p_data, revision = revision + 1, updated_at = now() where workspace_id = 'clearflow';
  insert into public.crm_commit_receipts(request_id, revision) values (p_request_id, current_revision + 1);
  delete from public.crm_commit_receipts where created_at < now() - interval '7 days';
  return jsonb_build_object('applied', true);
end;
$$;

-- Insert-only: importing again cannot overwrite a workspace already in use.
create or replace function public.crm_store_import(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare inserted integer;
begin
  insert into public.crm_workspace_state(workspace_id, data) values ('clearflow', p_data) on conflict do nothing;
  get diagnostics inserted = row_count;
  return jsonb_build_object('imported', inserted = 1);
end;
$$;

create or replace function public.crm_consume_limit(p_key text, p_limit integer, p_window_ms integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare used integer;
begin
  if length(p_key) > 200 or p_limit < 1 or p_window_ms < 1 or p_window_ms > 86400000 then raise exception 'Invalid quota.'; end if;
  insert into public.crm_rate_limits(key, count, expires_at) values (p_key, 1, now() + p_window_ms * interval '1 millisecond')
  on conflict (key) do update set
    count = case when public.crm_rate_limits.expires_at <= now() then 1 else public.crm_rate_limits.count + 1 end,
    expires_at = case when public.crm_rate_limits.expires_at <= now() then now() + p_window_ms * interval '1 millisecond' else public.crm_rate_limits.expires_at end
  returning count into used;
  delete from public.crm_rate_limits where expires_at < now() - interval '1 day';
  return used <= p_limit;
end;
$$;

revoke all on function public.crm_store_read(), public.crm_store_commit(bigint,jsonb,uuid), public.crm_store_import(jsonb), public.crm_consume_limit(text,integer,integer) from public, anon, authenticated;
grant execute on function public.crm_store_read(), public.crm_store_commit(bigint,jsonb,uuid), public.crm_store_import(jsonb), public.crm_consume_limit(text,integer,integer) to service_role;

insert into storage.buckets(id, name, public, file_size_limit)
values ('crm-private', 'crm-private', false, 20000000) on conflict (id) do nothing;
do $$ begin
  if exists(select 1 from storage.buckets where id = 'crm-private' and public) then raise exception 'crm-private must be a private bucket.'; end if;
end $$;
-- No browser policies are added to storage.objects. The server uses its secret key.
notify pgrst, 'reload schema';
commit;
