# Public CustomerLead pages

The active `templates/leads` app now provides three informational routes outside
the authenticated workspace:

| Purpose | Route | Production URL after deployment |
| --- | --- | --- |
| Product homepage | `/about` | `https://ai-customer-lead-crm-system-oyh1.vercel.app/about` |
| Privacy policy | `/privacy` | `https://ai-customer-lead-crm-system-oyh1.vercel.app/privacy` |
| Terms of service | `/terms` | `https://ai-customer-lead-crm-system-oyh1.vercel.app/terms` |

`/` remains the existing authenticated dashboard. Use the `/about` address for
the Google Auth Platform homepage field; it is a real product page, not a login
redirect. These routes are not live on Vercel until this change is deployed.

## Shared template

`components/public/public-shell.tsx` owns the generic CustomerLead brand, header,
theme switch, navigation and footer. `policy-page.tsx` supplies the matching policy
headings, section navigation and content card. These use the existing Geist font,
purple primary colour, light/dark tokens, BrandLogo and Button. No tenant logo,
workspace snapshot, account email or private configuration supplies public copy.
Login, Settings and the Google connection screen link to these public pages.

Public metadata is independent of authentication. Existing workspace/login
branding is resolved within those routes. The proxy allows only the three exact
informational paths; all private pages and API access retain their checks.

## Public identity remains unconfirmed

The user authorized building these pages but has not supplied the operator name
or a public contact email. Do not infer a legal entity, publish a private mailbox
as support, invent an address/jurisdiction, or claim Google approval.

Explicit public configuration, once supplied:

```dotenv
CRM_PUBLIC_OPERATOR_NAME=
CRM_PUBLIC_SUPPORT_EMAIL=
```

Both are intentionally blank by default. Until supplied, pages display a preview
notice, policy headings indicate a draft, and metadata requests no indexing.
Do not submit these drafts as finalized Google-verification documents. Supplying
contacts does not establish compliance: the policy content still needs the
operator's review against actual practices before commercial publication.

The text documents actual Gmail/Drive scopes, Supabase/Vercel storage, local n8n
processing, Gmail/Sheet copies, Gemini input, authentication/display storage,
manual versus automatic email controls, and manual deletion requests. It does
not invent a deletion deadline, automated account erasure, hosting SLA, billing
terms, jurisdiction, Google verification, or a no-training promise.

## Confirm AI provider handling before public launch

Source review on 25 October 2026 found a material issue to verify, not a runtime
change made by this UI work:

- Google's Workspace API policy prohibits transferring API-derived user data to
  train/improve general AI models beyond the permitted personalized use case.
- Gemini's unpaid-service terms permit product/model improvement and human
  review, with regional exceptions. Paid-service terms treat inputs differently.
- We have **not** verified the approved Gemini credential's billing account,
  regional applicability or processing configuration. Do not assert that the
  current service prevents training or is suitable for public Gmail processing.

Confirm the actual service settings and compatible data terms before replacing
the draft disclosures with a finalized Limited Use commitment. Do not enable
billing, change the live model/credential, disable existing customer processing,
or send real inquiry data as part of checking these pages.

Authoritative references:

- [Google branding requirements](https://support.google.com/cloud/answer/15549049)
- [Google Workspace user data and developer policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)
- [Gemini API terms](https://ai.google.dev/gemini-api/terms)
- [Google restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)

Domain ownership, OAuth branding/scope verification and any required security
assessment remain separate. No Search Console token or DNS record was supplied
or installed by this change.

## Verification

Run `scripts/check-public-pages.mjs` with the portable Node runtime. It uses an
isolated Supabase/Auth service and separate Next build/data directories. It checks
anonymous and signed-in access, public metadata without private workspace reads,
private-page/API protection, shared links, mobile width, policy section navigation
and theme persistence. Screenshots are ignored under `.local-preview/public-pages`.
