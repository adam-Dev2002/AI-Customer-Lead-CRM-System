# ClearFlow sign-in and Gemini assistant

**22 October 2026 update:** the private-business signup release supersedes this
guide's original invitation-only setup. Follow [business accounts and hosting](business-accounts-and-hosting.md)
for the new migration, immediate signup without email confirmation, and deployment checks.
Verify the live rollout steps in that guide. The original owner and deliberately
invited ClearFlow staff keep their existing workspace; new public accounts get
their own empty business after the release is applied. Signup does not connect Gmail.

The app now uses your Supabase project at `https://ygxpxmntcjhmjxfzuaqt.supabase.co`.
Supabase Auth stores login identities, password hashes and sessions. The app has
the project's **public publishable key** for browser login. The CRM storage
migration also uses a separate **server-only** `SUPABASE_SECRET_KEY`; that key
never belongs in browser code. With `CRM_STORAGE_BACKEND=supabase`, existing CRM
records and private files live in Supabase. See
[the current deployment guide](vercel-supabase-n8n-personal-guide.md).

## Original ClearFlow setup reference

The following records the earlier single-business setup. Preserve an existing
owner and applied migrations; use the new guide for signup rollout instead of
recreating accounts or replacing records.

1. Open [this project's SQL editor](https://supabase.com/dashboard/project/ygxpxmntcjhmjxfzuaqt/sql/new).
   Open `supabase/migrations/202610200001_crm_workspace_access.sql` in VS Code,
   copy the complete file into the SQL editor, and click **Run**. It creates only
   the workspace access table and its row access policy.
2. Open **Authentication → Users → Add user → Create new user** in Supabase.
   Use `adamromas0634@gmail.com`, choose your own strong password, and confirm
   the email for this owner account. This is an application login, separate from
   your Supabase dashboard account. Keep the password private.
3. In the SQL editor, run the complete `supabase/grant-owner-access.sql` file.
   Expect **one returned row**. Zero rows means you must create the user in step 2.
   This grants that user access to the existing shared ClearFlow workspace.
4. The original deployment used invitation-only access. The new private-business
   release needs **Allow new users to sign up** enabled, **Confirm Email** retained,
   and working custom SMTP, after its database migration and deployment checks.
   See the [current signup instructions](business-accounts-and-hosting.md#enable-supabase-email-signup).
5. Under **Authentication → URL Configuration**, set the local site URL to
   `http://127.0.0.1:3001`. Add these redirect URLs:

   ```text
   http://127.0.0.1:3001/auth/callback
   http://127.0.0.1:3001/auth/callback?next=/update-password
   http://localhost:3001/auth/callback
   http://localhost:3001/auth/callback?next=/update-password
   ```

6. Open [the login page](http://127.0.0.1:3001/login) and sign in with the new
   application account. Your existing inquiries and photos should appear.
   **Ask assistant** is in the bottom-right corner after sign-in.

The public URL and publishable key you supplied have already been placed in
`templates/leads/.env.local`, preserving the previous environment values. Restart
the app if Next.js has not reloaded the environment:

```powershell
./scripts/start-local.ps1 -Template leads
```

## Password resets and inviting more people

The invitation steps below are for staff intentionally joining the existing
ClearFlow team. Do not use that shared membership for an unrelated business.
New business owners should use the separate signup flow after rollout.

The login page has **Forgot your password?**. For reliable server-side recovery,
open **Authentication → Email Templates → Reset Password** and use this link in
the email template (replace your local origin with your real HTTPS app URL when
hosting):

```html
<a href="http://127.0.0.1:3001/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">Reset password</a>
```

For **Invite user**, use the same link with `type=invite`. Create the membership
before the invited person opens their link. Every invite/reset link is private
and one-time; never paste it into chat. Configure your own SMTP sender in Supabase
before relying on email delivery to a team; the built-in email service has limits.

To add another member, create/invite them in Authentication and run this SQL,
replacing the email and display name:

```sql
insert into public.crm_workspace_members (user_id, workspace_id, role, display_name)
select id, 'clearflow', 'member', 'Team member'
from auth.users where lower(email) = lower('teammate@example.com')
on conflict (user_id) do nothing
returning user_id;
```

To revoke ClearFlow team access, remove their ClearFlow membership row from
`public.crm_workspace_members` in the Supabase dashboard. After the private-business
release, that account can receive its own new empty business on a later sign-in;
it must no longer see ClearFlow's records. Access is checked on every server request. Sign out and
sign back in after changing accounts. Owners can upload or restore the business
logo in Settings; members can view the logo. Both roles have the existing CRM
record/reply/settings privileges. This
invitation puts staff in **one shared ClearFlow workspace**. Public signup in the
new release provisions a separate business workspace; it does not invite the
account into ClearFlow. The SQL above leaves an existing membership unchanged.

## What the assistant knows

- Live saved inquiry totals, statuses, priorities, review/delivery states and tasks.
- Up to 16 relevant/newest inquiries and 12 relevant tasks per question. Longer
  messages are shortened; answers identify that these are selected records.
- How Inbox, Leads, AI Drafts, follow-ups, settings and delivery progress work.
- Source links back to actual workspace pages. It does not search the whole
  Gmail mailbox or browse arbitrary links in email.

The assistant is a separate, read-only Gemini request. It cannot send emails,
approve replies, edit records or change Gmail accounts. Relevant record excerpts
are sent to Google's Gemini API when an authorized user asks a question. Chat is
kept only in the current browser component's memory, not stored in Supabase or
the CRM. Google API usage is billed/limited by the existing key's project, so
the assistant and automation share that project's quota.

`scripts/setup-assistant.mjs` securely copies the existing selected Gemini
credential from the consolidated n8n workflow to the ignored private server file
`templates/leads/.data/assistant-gemini.json`. It verifies model availability and
does not execute or modify a workflow. Keep this file in private deployment
backups alongside the existing environment/data/Google photo grant. Never put it
in `public`, Git, browser code or a download. Re-run the helper after rotating
the workflow key. Server-only `GEMINI_ASSISTANT_API_KEY` / `GEMINI_ASSISTANT_MODEL`
environment values are optional deployment overrides.

Limits are 12 questions per user per minute and 100 per workspace per hour,
enforced in this server process. Hosted replicas need a shared rate limiter.

## Verify the setup

1. In a private/incognito browser, `/`, `/inbox` and `/drafts` redirect to login;
   `/api/crm`, `/api/crm/contact-photos` and `/api/assistant` reject signed-out
   access. No assistant appears on the login page.
2. Sign in as the authorized owner. Open each page and check that real records
   and sender photos still load.
3. Ask **How do I send a reply?** and **How many inquiries do we have?**. Check
   source links and compare the counts to the dashboard. Asking the assistant
   does not create a Gmail draft, mail job, task or record update.
4. An application user with no workspace-membership row must be refused access.
5. Sign out and verify the CRM APIs are blocked again.
6. Existing n8n endpoints continue to use their separate Bearer credential. Their
   scheduled polling and incoming event delivery do not require an owner session.

If sign-in succeeds in Supabase but the app says access cannot be checked, verify
that the migration ran in the same project, RLS permits users to select their own
membership, and the owner grant returned one row. If the assistant is unavailable,
check the private Gemini configuration and Google's key/model/quota status.

Maintainer references: [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client),
[password login](https://supabase.com/docs/guides/auth/passwords),
[row level security](https://supabase.com/docs/guides/database/postgres/row-level-security),
[Gemini text generation](https://ai.google.dev/gemini-api/docs/text-generation).
