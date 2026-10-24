-- Additive setup state; does not modify existing records, tokens or workflows.
begin;
create table if not exists public.crm_business_connections (
  workspace_id text primary key references public.crm_workspace_state(workspace_id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  payload text not null check (length(payload) between 20 and 200000),
  updated_at timestamptz not null default now()
);
alter table public.crm_business_connections enable row level security;
revoke all on public.crm_business_connections from public, anon, authenticated;
grant all on public.crm_business_connections to service_role;
create or replace function public.crm_connection_read(p_workspace_id text) returns jsonb
language sql security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('revision', revision, 'payload', payload) from public.crm_business_connections where workspace_id = p_workspace_id), jsonb_build_object('revision', 0, 'payload', null));
$$;
create or replace function public.crm_connection_save(p_workspace_id text, p_revision bigint, p_payload text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare saved_revision bigint;
begin
  if p_workspace_id = 'clearflow' or p_payload is null or length(p_payload) not between 20 and 200000 then raise exception 'Invalid connection state.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('connection:' || p_workspace_id, 0));
  select revision into saved_revision from public.crm_business_connections where workspace_id = p_workspace_id;
  if coalesce(saved_revision, 0) <> p_revision then return jsonb_build_object('applied', false); end if;
  insert into public.crm_business_connections(workspace_id, revision, payload) values(p_workspace_id, 1, p_payload)
    on conflict(workspace_id) do update set revision = public.crm_business_connections.revision + 1, payload = excluded.payload, updated_at = now()
    returning revision into saved_revision;
  return jsonb_build_object('applied', true, 'revision', saved_revision);
end;
$$;
-- Setup may only register a new token or confirm its own exact token. It cannot
-- rotate a manually configured integration or another business connection.
create or replace function public.crm_connection_register(p_workspace_id text, p_token_hash text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare existing_hash text;
begin
  if p_workspace_id = 'clearflow' or p_token_hash !~ '^[a-f0-9]{64}$' or not exists(select 1 from public.crm_business_connections where workspace_id = p_workspace_id) then raise exception 'Invalid business connection.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('connection-token:' || p_workspace_id, 0));
  insert into public.crm_workspace_integrations(workspace_id, token_hash) values(p_workspace_id, p_token_hash) on conflict(workspace_id) do nothing;
  select token_hash into existing_hash from public.crm_workspace_integrations where workspace_id = p_workspace_id;
  return existing_hash = p_token_hash;
end;
$$;
revoke all on function public.crm_connection_read(text), public.crm_connection_save(text,bigint,text), public.crm_connection_register(text,text) from public, anon, authenticated;
grant execute on function public.crm_connection_read(text), public.crm_connection_save(text,bigint,text), public.crm_connection_register(text,text) to service_role;
notify pgrst, 'reload schema';
commit;
