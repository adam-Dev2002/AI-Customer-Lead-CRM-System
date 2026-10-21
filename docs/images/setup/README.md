# About these pictures

These seven PNGs show the application using **isolated fictional data**:
ClearFlow Demo Plumbing, sample customers and `example.com` email addresses.
The signed-in QA Owner is a mock account. Counts and delivery labels are sample
states, not evidence of real email delivery or the live workspace's contents.

The form-link picture uses `https://forms.example.com/form/demo-inquiry` as an
illustration. That address is not a working customer form.

No screenshot was taken from the real CRM database, Gmail, Google Cloud,
Supabase project dashboard, `.env.local`, or a credential editor.

To recreate them after installing the application dependencies and a Playwright
Chromium browser (or Chrome on Windows), run from the repository root:

```powershell
node --experimental-strip-types scripts/capture-setup-docs.mjs
```

The script creates an ignored `.local-preview/docs-…` directory, starts a local
practice app with mock authentication on port 3002, captures the pages, and stops
that app. It does not connect to the live Supabase workspace or n8n. Keep port
3002 free while it runs. The real application on port 3001 can keep running.
