# Combined workflow example

Use [customerlead-combined.example.json](customerlead-combined.example.json) with
the [illustrated setup guide](../setup-combined-workflow.md). It is an importable
**example**, derived from the specific 128-node Gemini-only export supplied on
21 October 2026. [source-review.json](source-review.json) records its fingerprint.

The example keeps all node names, code and connections, with these changes for
sharing:

- Unpublished (`active: false`), with empty pinned execution data.
- Saved credential/account bindings and instance metadata removed.
- CRM origin changed to `https://crm.example.invalid` throughout.
- Spreadsheet ID changed to `REPLACE_WITH_SPREADSHEET_ID`; cached real Sheet/tab
  references removed. The example selects the `Leads` tab by name.
- Literal email addresses replaced with `owner@example.com`.
- New demo node and form identities. The existing five-minute/hourly defaults
  are written explicitly; the other two schedules remain every minute.

It will not connect until its placeholders are replaced and your own four
connections are selected. Keep automatic emails off during practice. A workflow
with real accounts can send mail after configuration/publication, and an owner's
manual sending confirmation is separate from the automatic-email preference.

For the **existing installation**, retain the original private export, form ID,
database and credential encryption key. This public example cannot restore
working credentials and should not replace the current workflow during migration.
Do not activate the old sync/sender helpers alongside the combined workflow.

To regenerate this public example from the exact reviewed private source:

```powershell
node scripts/build-workflow-example.mjs "C:/private/your-reviewed-workflow.json"
```

The builder refuses a different source fingerprint. Review a newer export before
updating that guard. The older workflow-kit builders have their own independent
source references; they have not been repointed to this file.

Verification on 21 October 2026: the example imported successfully into a fresh,
disposable n8n 2.43.8 container with networking disabled. Its 128-node connection
graph and four schedules were compared with the source; the manual-check path
reached only the five read/check nodes. No workflow was executed or published by
that import check. Connected Gmail, Gemini generation, delivery and hosted
operation still require the controlled setup checks in the guide.
