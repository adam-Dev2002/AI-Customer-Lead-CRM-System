# Test the filters yourself

Follow-up filters use saved schedules, human approvals and delivery results. AI
does not assign these follow-up states. AI can suggest the inquiry's category,
priority, summary and initial reply; those are separate from follow-up delivery.
Selecting a filter only changes the view. It never changes an inquiry, approves
an email or sends a message.

## 1. Check your existing follow-up records without changing anything

1. Open Follow-ups and select **All follow-ups**.
2. Clear Search follow-ups. Note **All records**, the matching-record count and
   the number of pages. Use Next page to include the whole list.
3. Select each option below. Compare the matching-record count with the rows and
   the relevant summary card. A zero-result view is correct when no saved record
   meets that rule.

| Filter | What should appear |
|---|---|
| All follow-ups | Every inquiry, including unscheduled records |
| Due now | Pending follow-ups whose scheduled time has arrived |
| Awaiting approval | Pending follow-ups without approval for the current saved email, recipient and time |
| Needs attention | Reserved and Needs Review records together |
| Pending | All follow-ups waiting for their time or sending requirements, approved or unapproved |
| Reserved | Follow-ups claimed by the sending automation |
| Sent | Follow-ups with a confirmed delivery result |
| Skipped | Records not currently pending, including cancelled and unscheduled inquiries |
| Needs Review | Follow-ups with an uncertain delivery result |

4. Select Awaiting approval, then refresh. The dropdown should still say
   Awaiting approval and show the same eligible records.
5. Search for a displayed customer's name, email or service. Only matches within
   the selected state should remain. Search ignores case and surrounding spaces.
6. Enter an impossible search such as `no-such-customer-123`. Expect zero results.
   Click **Show all follow-ups** to clear both the search and selected state.
7. Click a summary card, such as Sent. It should choose the corresponding
   dropdown option and show the same count. Counts cover all pages. With an
   active search, cards describe that search across all states; the matching
   count describes the selected state.

At the initial read-only check on 21 October 2026 (Singapore), the workspace had
24 records: Pending 1, Sent 1 and Skipped 22. Awaiting approval was 1; Due now,
Reserved, Needs Review and Needs attention were 0. These numbers can change as
new inquiries arrive or you manage their schedules.

These views overlap. An unapproved overdue email appears in Pending, Due now and
Awaiting approval. Do not add those three shortcut counts to get the total. The
five delivery states Pending / Reserved / Sent / Skipped / Needs Review form the
separate state groups.

## 2. Optionally check approval and scheduling changes

Use a test inquiry whose recipient inbox you control. Do not change a real
customer's permission or schedule just to test a filter.

1. Note your current **Automatic confirmations & follow-ups** setting in Settings.
   Turn it off and save. This temporarily pauses automatic outgoing confirmations,
   alerts and follow-ups while you inspect the test changes.
2. In Follow-ups, open the controlled test inquiry with View. The inquiry must be
   New or Pending. Record permission only if the recipient agreed to the test.
3. Choose a time a few minutes ahead and click Save schedule. Save an email
   subject/body, but leave it unapproved.
4. Close details. Search for that test inquiry. Expect Pending = 1 and Awaiting
   approval = 1. Due now is zero while its time is in the future.
5. Open View, review the saved recipient, time and email, check the confirmation
   box and choose Approve follow-up. With automatic sending still paused, expect
   Pending = 1 and Awaiting approval = 0. It must not become Sent merely because
   you approved it.
6. Choose Withdraw approval. Expect Awaiting approval = 1 again. Saving an edited
   email or rescheduling also requires fresh approval.
7. Keep it unapproved and wait until the scheduled time passes. Within 15 seconds
   the Due now count should become 1. It is also Pending and Awaiting approval.
   Due means its time arrived, not that sending is authorized.
8. Choose Cancel follow-up. It should move to Skipped and leave Pending, Due now
   and Awaiting approval.
9. Keep that test follow-up cancelled, then restore the business preference to its
   original value if you changed it. Unpause an approved due follow-up only when
   you intend it to send.

Reserved and Sent come from actual sending work; choosing those filters cannot
create the state. Reserved may be brief. Do not break a connection or force an
uncertain send to create Needs Review. All these states are covered by the
isolated browser checks below.

## 3. Check Leads status and priority filters

1. Open Leads and click Clear filters.
2. Choose each status in turn: New, Pending, Contacted, Qualified, Won, Lost and
   Closed. Every displayed row's Status must match the chosen value.
3. Clear filters. Choose Low, Normal, High and Urgent separately. Every row's
   Priority must match exactly. High does not include Urgent. The separate
   **High or urgent (open)** summary card explicitly counts both open groups.
4. Combine a status and priority. For example, Qualified + High must show only
   rows meeting both conditions. An empty combination is a valid result.
5. Add Source and Owner. Every result must meet all selected conditions together.
6. Test Today, Last 7 days, Last 30 days and This month. These use the inquiry's
   **Created** timestamp, not its follow-up due time. Today/This month use the
   business timezone; Last 7/30 days use a rolling period ending now. Future
   creation timestamps are excluded from these date ranges.
7. Search within the selected filters. Check Next/Previous page and change the
   number of rows per page. Filtering should return to page 1.
8. Click Clear filters. Every dropdown and search should reset and the full list
   should return. None of these filter selections changes the underlying records.

## Maintainer: repeat the isolated checks

From the project directory in PowerShell:

```powershell
& '.local-tools/node-v22.23.3-win-x64/node.exe' scripts/check-followups.mjs
```

The checker starts a separate server on port 3002 with isolated data and mock
sign-in. It tests the follow-up editor, all nine filters, exact row identities,
counts across pagination, searches, refresh, approval updates, time progression,
every lead stage/priority, combinations, source/owner/date, Singapore boundaries,
invalid URLs and mobile dark layout. Simulated states exist only inside that
browser. It verifies filters make no writes and sends no real email. The test
server and browser close when it finishes; port 3001 and real CRM data are not
used for these checks.
