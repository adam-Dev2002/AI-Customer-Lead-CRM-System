-- First create this application user in Authentication > Users > Add user.
-- This does not create a user or set/change their password.
insert into public.crm_workspace_members (user_id, workspace_id, role, display_name)
select id, 'clearflow', 'owner', 'Adam'
from auth.users where lower(email) = 'adamromas0634@gmail.com'
on conflict (user_id) do update set role = excluded.role, display_name = excluded.display_name
returning user_id, workspace_id, role, display_name;
-- Expect ONE returned row. Zero rows means the application user does not exist yet.
