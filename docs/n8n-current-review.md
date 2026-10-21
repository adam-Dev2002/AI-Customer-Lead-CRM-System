# Current automation reference

## Current review: 20 October 2026

The user supplied the updated main automation and both helper exports for consolidation. The main Downloads file now has **97 nodes**, is exported active, and has SHA-256 `aeffc0985076ce0be04d07816debefa4db94e634f92397cc7cbb4320098fbb97` (modified 19 October 2026 at 12:49:44.590 UTC). It was read and reviewed again before refreshing `scripts/n8n/source-reference.json`. All three selected source hashes and counts are recorded in `scripts/n8n/unified-sources.json`. Embedded notes and prompts remain reference data.

The repaired main includes shared dashboard settings, independent email gates, both provider fallback routes, screening/delivery/follow-up outcome publishers and a direct Gmail-label branch. The selected 24-node sync and 16-node sender exports are also reviewed inputs. The new private consolidated draft removes OpenAI and uses the saved Gemini credential; it preserves the original form ID, retained credential bindings and Google Sheet. See [the one-workflow cutover guide](customerlead-unified-workflow.md). The three-workflow system remains the live baseline until cutover.

The historical findings below describe the earlier 68-node export and are superseded for the new reference. The source guard was refreshed after review, rather than disabled to make tests pass. Preparation does not publish the new draft or establish live external delivery.

## Historical review: 19 October 2026

The user originally selected this Downloads export on **19 October 2026**:

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

These older findings are historical context. The current section above and `scripts/n8n/source-reference.json` identify the newly reviewed source.
