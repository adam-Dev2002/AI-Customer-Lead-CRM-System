-- Apply after the workspace-access and cloud-storage migrations. Existing
-- ClearFlow records, memberships, private objects and legacy RPCs are preserved.
begin;

alter table public.crm_workspace_members drop constraint if exists crm_workspace_members_workspace_id_check;
alter table public.crm_workspace_state drop constraint if exists crm_workspace_state_workspace_id_check;
alter table public.crm_workspace_members alter column workspace_id drop default;
alter table public.crm_workspace_members add constraint crm_workspace_members_workspace_id_check
  check (workspace_id = 'clearflow' or workspace_id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$');
alter table public.crm_workspace_state add constraint crm_workspace_state_workspace_id_check
  check (workspace_id = 'clearflow' or workspace_id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$');
comment on table public.crm_workspace_members is 'One private business workspace per account. Only the server provisions access; members may read their own membership.';

create table if not exists public.crm_tenant_commit_receipts (
  workspace_id text not null references public.crm_workspace_state(workspace_id) on delete cascade,
  request_id uuid not null,
  revision bigint not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, request_id)
);
create index if not exists crm_tenant_commit_receipts_created on public.crm_tenant_commit_receipts(created_at);
create table if not exists public.crm_workspace_integrations (
  workspace_id text primary key references public.crm_workspace_state(workspace_id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz not null default now()
);
alter table public.crm_tenant_commit_receipts enable row level security;
alter table public.crm_workspace_integrations enable row level security;
revoke all on public.crm_tenant_commit_receipts, public.crm_workspace_integrations from public, anon, authenticated;
grant all on public.crm_tenant_commit_receipts, public.crm_workspace_integrations to service_role;

create or replace function public.crm_tenant_read(p_workspace_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare saved public.crm_workspace_state;
begin
  select * into saved from public.crm_workspace_state where workspace_id = p_workspace_id;
  if not found then raise exception 'The authorized workspace has not been provisioned.' using errcode = 'P0002'; end if;
  return jsonb_build_object('revision', saved.revision, 'data', saved.data);
end;
$$;

create or replace function public.crm_tenant_commit(p_workspace_id text, p_revision bigint, p_data jsonb, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare current_revision bigint;
begin
  select revision into current_revision from public.crm_workspace_state where workspace_id = p_workspace_id for update;
  if not found then raise exception 'The authorized workspace has not been provisioned.'; end if;
  if exists(select 1 from public.crm_tenant_commit_receipts where workspace_id = p_workspace_id and request_id = p_request_id) then
    return jsonb_build_object('applied', true);
  end if;
  if current_revision <> p_revision then return jsonb_build_object('applied', false); end if;
  update public.crm_workspace_state set data = p_data, revision = revision + 1, updated_at = now() where workspace_id = p_workspace_id;
  insert into public.crm_tenant_commit_receipts(workspace_id, request_id, revision) values (p_workspace_id, p_request_id, current_revision + 1);
  delete from public.crm_tenant_commit_receipts where workspace_id = p_workspace_id and created_at < now() - interval '7 days';
  return jsonb_build_object('applied', true);
end;
$$;

-- A verified email receives a NEW empty workspace. Existing owners, including
-- ClearFlow, return their membership unchanged even after a repeated signup.
create or replace function public.crm_provision_workspace(p_user_id uuid, p_name text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare existing public.crm_workspace_members; created_workspace text; account_email text; field text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));
  select * into existing from public.crm_workspace_members where user_id = p_user_id;
  if found then return jsonb_build_object('workspace_id', existing.workspace_id, 'role', existing.role); end if;
  select email into account_email from auth.users where id = p_user_id and email_confirmed_at is not null and email is not null and deleted_at is null;
  if not found then raise exception 'Confirm the account email before creating a workspace.'; end if;
  if p_name is null or length(btrim(p_name)) < 2 or length(btrim(p_name)) > 100
    or p_data is null or jsonb_typeof(p_data) <> 'object' or pg_column_size(p_data) > 50000
    or p_data->>'version' is distinct from '1' or jsonb_typeof(p_data->'settings') is distinct from 'object'
    or (p_data - array['version','settings','leads','drafts','tasks','activities','syncChanges','mailJobs','processedEventIds','archivedLeadIds','notificationsReadAt','lastAutomationEventAt','lastSyncPollAt','lastConfigReadAt','lastMailPollAt','mailSenderEmail','mailSenderCapabilities','emailMirrorVersion']) <> '{}'::jsonb
  then raise exception 'Provide a business name and an empty workspace.'; end if;
  foreach field in array array['leads','drafts','tasks','activities','syncChanges','mailJobs','processedEventIds','archivedLeadIds'] loop
    if p_data->field is distinct from '[]'::jsonb then raise exception 'New workspaces cannot contain existing records.'; end if;
  end loop;
  foreach field in array array['notificationsReadAt','lastAutomationEventAt','lastSyncPollAt','lastConfigReadAt','lastMailPollAt','mailSenderEmail'] loop
    if p_data ? field and p_data->field is distinct from '""'::jsonb then raise exception 'New workspaces cannot inherit automation state.'; end if;
  end loop;
  if (p_data ? 'mailSenderCapabilities' and p_data->'mailSenderCapabilities' is distinct from '[]'::jsonb)
    or (p_data ? 'emailMirrorVersion' and p_data->'emailMirrorVersion' not in ('0'::jsonb,'1'::jsonb))
    or p_data->'settings'->'automaticEmailsEnabled' is distinct from 'false'::jsonb
  then raise exception 'New workspaces require a separate automation connection.'; end if;
  created_workspace := gen_random_uuid()::text;
  p_data := jsonb_set(jsonb_set(p_data, '{settings,businessName}', to_jsonb(btrim(p_name))), '{settings,ownerEmail}', to_jsonb(account_email));
  insert into public.crm_workspace_state(workspace_id, data) values (created_workspace, p_data);
  insert into public.crm_workspace_members(user_id, workspace_id, role, display_name) values (p_user_id, created_workspace, 'owner', '');
  return jsonb_build_object('workspace_id', created_workspace, 'role', 'owner');
end;
$$;

create or replace function public.crm_set_workspace_token(p_workspace_id text, p_token_hash text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid connection token hash.'; end if;
  insert into public.crm_workspace_integrations(workspace_id, token_hash) values (p_workspace_id, p_token_hash)
    on conflict (workspace_id) do update set token_hash = excluded.token_hash, updated_at = now();
  return true;
end;
$$;

create or replace function public.crm_resolve_workspace_token(p_token_hash text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('workspace_id', workspace_id) from public.crm_workspace_integrations where token_hash = p_token_hash;
$$;

create or replace function public.crm_workspace_connection(p_workspace_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.crm_workspace_integrations where workspace_id = p_workspace_id);
$$;

revoke all on function public.crm_tenant_read(text), public.crm_tenant_commit(text,bigint,jsonb,uuid), public.crm_provision_workspace(uuid,text,jsonb), public.crm_set_workspace_token(text,text), public.crm_resolve_workspace_token(text), public.crm_workspace_connection(text) from public, anon, authenticated;
grant execute on function public.crm_tenant_read(text), public.crm_tenant_commit(text,bigint,jsonb,uuid), public.crm_provision_workspace(uuid,text,jsonb), public.crm_set_workspace_token(text,text), public.crm_resolve_workspace_token(text), public.crm_workspace_connection(text) to service_role;
notify pgrst, 'reload schema';
commit;
