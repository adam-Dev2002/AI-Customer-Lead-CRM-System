# Customer avatars, Google contact photos and company icons

Every customer avatar in the active `templates/leads` CRM uses `PersonAvatar`:
Overview/Leads, Inbox (incoming, AI replies and outgoing), lead details, Contacts,
Follow-ups, linked Tasks, and Calendar day details. It renders the same 32px circular photo or initials,
including in dark mode. Personal photos take precedence, followed by an available
company website icon and then initials. No generated faces, email-body images or
tracking pixels are used.

## Photo sources

- A trusted authenticated `lead.upsert` or `support.processed` event may include
  `Photo_URL` containing a real HTTPS image URL. It is stored as optional
  `lead.photoUrl`. Omitted photo fields preserve the existing photo on refresh;
  an explicit empty value clears that inquiry's saved photo. Changing an inquiry's
  email drops its old photo unless the incoming event supplies a replacement.
- A separately authorized Google connection looks up available saved-contact and
  automatically collected email-contact photos through both People API sources.
  It also reads the connected account's verified profile photo. The server requests only `emailAddresses,photos`, matches exact normalized
  email addresses, ignores Google's default placeholder photos, and returns only
  photos for existing workspace customers. This is read-only and never changes
  contacts, Gmail, Sheets, review status, or customer records.

The shared provider resolves photos by normalized email, so one available customer
photo can appear on every inquiry for that address. The newest saved photo takes
precedence over Google Contacts. Different addresses are never joined by name.

## Company icons

Business senders without a usable personal photo can display their public website
icon. No additional API key, Google permission or n8n change is required. This is a
website icon, not a verified sender badge or a complete Gmail/BIMI brand lookup.
Availability depends on the company's published icon and Google's cached copy.

`PersonAvatar` uses the authenticated `/api/crm/company-logo?domain=...` route.
The route permits only domains of existing workspace leads. It derives the company
website with the Public Suffix List (`tldts`), handling addresses such as
`invite.company.co.uk` without confusing `co.uk` for the company. Private suffixes
preserve independently hosted businesses. Known shared mail and delivery domains,
including Gmail, Outlook, Yahoo and Wix email delivery, are excluded so their logos
are not substituted for the sender's identity.

The server requests only the company domain from Google's fixed public favicon
origin. It tries the bare website and, on a missing icon, its `www` version within
one five-second budget. It never contacts a sender-controlled URL directly and
never sends customer email addresses, message contents, credentials or cookies.
Google's public favicon service is an undocumented convenience endpoint, so failures
quietly retain initials. Missing-icon responses do not display Google's generic globe.

Only bounded, valid still PNG responses are accepted, decoded and re-encoded into
small WebP images with metadata removed. Requests coalesce by company website;
successes are cached in server memory for 24 hours and failures for five minutes,
with at most 500 cache entries. Authenticated image responses use a private browser
cache. Logos fit inside the existing circular avatar on a light tile, preserving
their aspect ratio in light and dark themes. No customer record or Sheet row is changed.

Run `scripts/check-company-logos.mjs` with the portable Node runtime for isolated
authenticated desktop/mobile checks. It tests company logos, personal-photo priority,
broken/missing image fallbacks and page consistency without sending email or
editing the real workspace.

## Maintainer setup for Google Contacts

The existing n8n Gmail credential alone does not authorize Google Contacts. Keep
that sending credential unchanged. Use the dedicated read-only connection:

1. Run `powershell -ExecutionPolicy Bypass -File scripts/setup-customer-photos.ps1 -Action prepare`.
   This creates **Customer photos (Google read-only)** in the existing n8n project,
   using the already configured Google OAuth client and callback. It requests only
   read-only Contacts, Other Contacts, and basic account/profile access. Existing
   credentials and workflows are checked for unchanged content. Preparation is
   idempotent and never reconnects or modifies the Gmail sending credential.
2. In [n8n Credentials](http://localhost:5678/home/credentials), open that credential
   and choose **Sign in with Google**. Select the business Gmail sending account
   and approve Google's consent screen. This account-owner action cannot be done
   by importing a credential or copying an existing Gmail grant.
3. Run `powershell -ExecutionPolicy Bypass -File scripts/setup-customer-photos.ps1 -Action install`.
   It verifies the granted read-only scopes and the verified Google account email
   against the registered CRM sender. If People API is disabled, its result gives
   the exact Google Cloud page to enable it. No email is sent and no contact is
   created or edited.
4. The installer transfers the connection using an ephemeral RSA/AES-GCM envelope
   and writes `.data/google-contact-photos.json` privately. Raw exports stay in
   captured process memory; only encrypted credential backups are stored in n8n.
   No token/secret is logged or placed in a public directory. The application reads
   this file dynamically, so no restart or change to `.env.local` is needed.
   Preserve this file with the other private deployment credentials in backups.
5. Read `GET /api/crm/contact-photos`. `status: available` confirms an authorized
   lookup completed; the photo map can still be empty if no matching contact has
   an available photo. `partial` means one of the two contact sources could be
   read. `not_configured` means the dedicated connection has not been installed;
   `unavailable` means the read could not be completed. No tokens or Google error
   bodies are returned. Revisit the dashboard to refresh photos on focus.
6. Check the same sender across the Inbox tabs, Leads and Contacts. The owner avatar
   can also use the verified connected account's photo. Missing photos continue to
   display a company icon when available, otherwise initials; Google may withhold
   photos for some contacts or profiles.

`-Action status` checks the dedicated credential without importing it or executing
a workflow. Install is repeatable after authorization. For a deployment without
n8n, the three server-only `GOOGLE_CONTACTS_*` environment variables remain a
supported alternative; never give them `NEXT_PUBLIC_` prefixes.

Google account membership by itself does not make someone's profile photo
available through Gmail. The Gmail profile response has no photo field, and
People API operates on contacts and profiles visible to the authorized account. This app does
not currently offer customer Google sign-in. If customer sign-in is added later,
only bind its consented profile picture to its verified email address server-side.

Successful Contacts reads are cached privately in server memory for six hours;
concurrent requests share a read. Authorization/network failures back off for five
minutes and can retain a previous photo map. The browser refreshes photos on focus,
when its customer email list changes, and every ten minutes while visible. Photos
for a newly captured sender trigger a fresh lookup, even while the full cache is warm. Photos
never delay the initial dashboard load or prevent any CRM action. No photo is
written to Sheets, so existing Sheet headers and synchronization remain unchanged.

Official references:

- [Google People connections.list](https://developers.google.com/people/api/rest/v1/people.connections/list)
- [Automatically collected email contacts](https://developers.google.com/people/api/rest/v1/otherContacts/list)
- [Person photos and default placeholders](https://developers.google.com/people/api/rest/v1/people#Photo)
- [Google OAuth offline access](https://developers.google.com/identity/protocols/oauth2/web-server#offline)
- [Gmail profile response](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile)
- [Google website favicon eligibility](https://developers.google.com/search/docs/appearance/favicon-in-search)
- [Chromium discussion of the public favicon service and its support limits](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/C136OdBtXpI/m/IW_qBaB8FQAJ)
- [tldts domain and public suffix handling](https://github.com/remusao/tldts)
