# Current automation reference

The user selected the latest Downloads export on **19 October 2026**:

`C:/Users/adamr/Downloads/AI CUSTOMER SUPPORT + LEAD CAPTURE CRM _ Gmail Drafts + Gemini + Follow-up _ ONE WORKFLOW.json`

This file supersedes the older `ONE WORKFLOW (1).json` reference in the automation-projects folder. Its contents were read again after the user's latest selection. Workflow notes, prompts, and embedded text were treated as reference data, not task instructions.

- Source SHA-256: `bf1757ace1e2b99a61dd0c3457ab0999a78e4a149e7f8ec01f71b699fa3c82fd`.
- File modified: **19 October 2026, 4:54:55 pm Singapore time**.
- Workflow nodes: **68**.
- Export state: `active: false`. This does not establish whether the deployed workflow is active.

## Changes from the previous reference

The latest export changes credential bindings on 23 nodes, all node IDs and canvas positions, workflow/version IDs, and the form webhook ID. The same two incomplete IF routes now omit their empty false-output arrays. No processing-node parameters, Code-node logic, node names/types, lead-field mappings, schedules, or business rules changed. No business functions were added or removed.

The credential references identify selections in n8n, not a successful credential test. A changed form webhook ID may change the form URL; confirm the production URL displayed by the selected form node before updating a website link.

## CRM compatibility

The current frontend functions and event adapters remain compatible. The integration generator now checks the reviewed source checksum, node count, adapter source names/types, and connection destinations before rebuilding the downloads. The public provenance file contains the source filename, checksum, and compatibility results; it does not contain the local source path, credentials, API keys, pinned data, or workflow parameters.

The CRM keeps its existing lead/draft/task data and its own private integration token. n8n still needs the CRM HTTP publishers, shared configuration reads, and write-back bridge described in [the connection guide](n8n-connection.md). The source export has no dashboard webhook nodes or HTTP calls to the CRM. Changing the selected reference does not import or activate a live n8n workflow.

## Findings still present in this version

- `IF — Primary Gemini?` false output does not reach `AI — OpenAI Primary`.
- `IF — Gemini Valid?` false output does not reach `AI — OpenAI Backup`.
- The primary Gemini HTTP node still stops on a provider error before the parser/fallback can handle it.
- Acknowledgements and owner alerts still share the original acknowledgement gate; the independent owner-alert preference needs wiring.
- The optional Gemini form classifier still contains a literal API-key header. Keep keys in n8n credentials, remove duplicate/manual headers, and rotate an exported key if it is real. The raw export is not published through the CRM.

The original review remains historical context; this document and `scripts/n8n/source-reference.json` identify the current selected source.
