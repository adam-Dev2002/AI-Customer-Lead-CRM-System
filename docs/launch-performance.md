# Launch performance

The active application is `templates/leads`. The development server compiles
pages while browsing; assess release speed with a production build.

## Improvements

- Follow-up cards explain Pending, Due, approval and confirmed sending. When
  nothing is due, the next scheduled time appears in the workspace timezone.
  Counts still follow the search and include all result pages.
- Authorized pages receive their first snapshot with the server-rendered page.
  Visual branding and the workspace share one request-scoped read. Records are
  never cached between requests or sent before workspace access is verified.
  Controls become interactive after hydration, with normal background refresh.
- Inquiry growth counts each inquiry once. Date formatters are reused with a
  bounded cache containing locale options, rather than customer data.
- Simultaneous focus/poll requests share one read. An older read cannot undo a
  newer edit. Contact-photo refreshes share a request and use the existing
  ten-minute refresh period.
- Inbox initially displays 50 inquiries. Load more adds 50; search still covers
  every inquiry. Other tabs load on first use and then preserve unsaved edits.
- A route loading skeleton gives feedback while navigating.

Follow-up eligibility, approval, confirmed delivery and the active n8n workflow
are unchanged. No customer records or actual email preferences are edited by
these improvements or their tests.

## Observed laboratory results (21 October 2026)

One comparable local production pass with 500 synthetic inquiries and 4x CPU
slowdown produced these desktop timings:

| Page | Content before | Content after | Controls ready after |
| --- | ---: | ---: | ---: |
| Dashboard | 31.43 s | 1.32 s | 2.37 s |
| Leads | 1.90 s | 1.15 s | 1.69 s |
| Follow-ups | 1.64 s | 1.29 s | 2.34 s |
| Inbox | 3.26 s | 1.58 s | 2.07 s |

The 390px mobile viewport on the local network showed content in 1.12–1.27 s
and enabled controls in 1.57–2.11 s. A separate mobile pass configured with
1.6 Mbps download / 100 ms latency showed content in 1.17–1.47 s and enabled
controls in 2.72–3.85 s. Measured layout shift was zero on these pages. Local
API p95 was 75 ms in the comparable run and 63 ms in the mobile-network run.
These timings include mock authentication, not the real hosted auth service.

Verification passed: 136 automated checks, TypeScript, production builds,
isolated CRM and follow-up desktop/mobile regressions, sign-in/access/assistant
checks, and both production benchmark modes. The launcher syntax and occupied-
port guard were checked. The existing ESLint dependency limitation is separate;
no lint pass is claimed.

## Repeat the measurements

Run sequentially from the repository root with the portable Node.js runtime:

```powershell
& '.local-tools/node-v22.23.3-win-x64/node.exe' --no-warnings --experimental-strip-types scripts/check-performance.mjs --label current
& '.local-tools/node-v22.23.3-win-x64/node.exe' --no-warnings --experimental-strip-types scripts/check-performance.mjs --label mobile-network --slow-network
```

Each command builds and starts production on isolated port 3002 with 500
synthetic inquiries, mock authentication and separate CRM storage. It checks
Dashboard, Leads, Follow-ups and Inbox, desktop/mobile layouts, initial rendering,
access protection, load-more/search, the next schedule, duplicate reads and
protection against an older response overwriting an edit. Test edits are browser
responses only. Real CRM storage, credentials, Gmail and n8n are not used.

The browser CPU is slowed by 4. The optional mobile network run adds 100 ms
latency, 1.6 Mbps download and 750 Kbps upload. API latency uses 20 authenticated
local reads. Reports and screenshots are in ignored `.local-preview/performance`.
These are laboratory measurements with local mock authentication, not hosted
Core Web Vitals, real-user INP or a guarantee of internet performance. Recheck the
actual deployed origin and real authentication service before public launch.

## Start production mode

After stopping the existing preview, from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-local.ps1 -Template leads -Production
```

The launcher builds successfully before starting `next start` on loopback port
3001. It refuses an occupied port before building. Without `-Production`, the
existing development command behaves as before. Do not run benchmarks while a
different isolated QA process is using port 3002 or `.next-qa`.

The existing setup remains one shared workspace with a private JSON data file.
Hosting requires persistent private storage, a single CRM writer process, HTTPS,
the production Supabase redirect URLs and a reachable CRM URL for Docker n8n.
Multiple application replicas require shared transactional storage. Keep
`.env.local`, saved records and credentials out of public artifacts.

Settings > Customer inquiry form provides a read-only link with Copy link and
Open form. The maintainer can set `CRM_CUSTOMER_FORM_URL` or store
`{"version":1,"url":"https://forms.yourbusiness.com/form/your-form-id"}` in the
private `CRM_DATA_DIR/customer-form.json`. The environment value takes precedence.
This config controls the displayed link; it does not publish or reconfigure n8n.
Use the active form's production `/form/...` address, with the existing webhook
ID, rather than `/form-test/...`. Localhost and private-network addresses are
labelled accordingly. Customers outside the network need a reachable public form
address before adding the link to their website or external application.
