-- Run in this CRM's Supabase project SQL editor. Supabase Auth owns passwords;
-- this table grants access to the ONE existing shared ClearFlow workspace.
begin;
create table if not exists public.crm_workspace_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace_id text not null default 'clearflow' check (workspace_id = 'clearflow'),
  role text not null default 'member' check (role in ('owner', 'member')),
  display_name text not null default '',
  created_at timestamptz not null default now()
);
alter table public.crm_workspace_members enable row level security;
revoke all on public.crm_workspace_members from anon, authenticated;
grant select on public.crm_workspace_members to authenticated;
drop policy if exists "Members can read their own workspace access" on public.crm_workspace_members;
create policy "Members can read their own workspace access"
  on public.crm_workspace_members for select to authenticated
  using ((select auth.uid()) = user_id);
comment on table public.crm_workspace_members is 'Admin-managed access to the single ClearFlow CRM. No browser inserts, updates or deletes.';
commit;
