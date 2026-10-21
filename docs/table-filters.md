# Check filters and sorting

Every record list starts with Search and an **Advanced filters** button. Extra
filters, Sort by and the direction button stay inside that control until needed.
Applied filters remain visible as small removable labels when it is closed.
Clear filters appears when searching, filtering, changing the order, or opening
Advanced filters. Tables retain clickable headings with sorting arrows.
Sorting applies to every matching record before pagination.

Every filter, date range and Sort by control is an ordinary single-selection
dropdown. Choosing a value updates the results and closes the dropdown. There
are no checkbox menus, Done buttons or per-menu Clear selection buttons. Choose
the All option to reset one category, remove its applied label, or use Clear
filters to reset the whole list. Separate filter categories combine with **AND**:
Status = New and Priority = High shows new, high-priority inquiries. Older links
containing multiple values for one category use the first valid value only,
matching the single value displayed in the dropdown.

1. Open **Leads**. Confirm only Search and Advanced filters appear above the
   everyday columns: Lead name, Inquiry, Status, Priority and Date. Open
   **Advanced filters**, then choose **High** under Priority and **New** under
   Status. Every row must match both. Choose **Urgent**: it replaces High and the
   list contains only new, urgent inquiries. Search
   for a customer within those results. **Clear filters** restores
   the full list and newest-first order.
2. Click **Lead name** twice: names change from A–Z to Z–A. Click **Priority**:
   Urgent comes before High, Normal, and Low. Click again for the reverse order.
   Go to the next page, then change a filter or sort: the list returns to page 1.
3. Open **Follow-ups**, then **Advanced filters**. Combine Follow-up state, Priority, Lead status, Consent,
   and Search. Check each row against all selections. Sort **Due time** in each
   direction; unscheduled records stay last. View a record, close its details,
   and confirm your table controls remain selected. Summary cards follow your
   search; the extra table filters narrow the table without changing those cards.
   Choose **Pending**, then **Sent**: Sent replaces Pending. Refresh and confirm
   Sent remains selected. A summary card selects its view; All records restores
   All follow-ups. Sorting always uses the one displayed column.
4. Open **Contacts**, then **Advanced filters**. Try **Has open inquiries** and **No open inquiries**.
   Each choice replaces the previous one; All contacts includes both sets.
   Click **Inquiries**: counts sort numerically (12 comes before 2 in descending
   order). Search and export use the matching contacts.
5. Open each **Inbox** tab. Open Advanced filters and combine its status/channel controls with Search,
   then choose Customer or Created under Sort by. Reverse the order with the
   direction button. Switch tabs and back; each tab retains its own controls.
6. On **Tasks**, open Advanced filters and combine Status and Search, then sort by Due date, Task title,
   or Completion. On **Activity**, combine Activity type and Result, then sort
   by Time or Activity. Clear filters restores all results.
   Completed replaces Open tasks; All tasks includes every task. Overdue shows
   only incomplete tasks whose due time has passed.
7. On **How it works**, use the controls above **Saved changes**. On **Calendar**,
   choose Tasks or Follow-ups and search; the calendar and selected-day agenda
   should both match. All events shows both types. Sorting changes the
   agenda's order. On **Overview**, the
   inquiry table shows the first five matching records from its selected period;
   View all opens the full Leads page.
8. Close Advanced filters after selecting a priority. Its applied label must
   remain visible. Remove that label: the rows update and Search remains intact.
   Sort using a table heading while Advanced filters is closed; an Order label
   appears, and removing it restores the default order.
   Remove a priority from a linked Leads page, refresh, and confirm it remains
   cleared while the selected status and search remain. For keyboard use, Tab to
   a dropdown, use the arrow keys to choose a value, and Enter to confirm. Escape
   closes an open dropdown.
9. Find a long inquiry. Its subject should wrap rather than disappear into a
   single truncated line. A saved AI summary is used for long messages when
   available and labeled AI summary; otherwise the original message is previewed.
   **Read inquiry** opens the full message and secondary details (source, assigned
   owner, contact details and creation date). Search also finds message and summary
   text. This display does not generate new AI content or change saved records.
10. Try a search with no matches. Clear filters must still be available. Repeat
   at a narrow browser width: filters should wrap, and wide tables should scroll
   inside their card. Open and close Advanced filters using the keyboard; Tab to
   a sortable heading and press Enter to sort.

These controls only change the displayed results. They do not update customer
records, approve messages, change schedules, or send email.

Automated verification: run `scripts/check-table-filters.mjs` with the portable
Node runtime. It starts port 3002 with isolated storage and a mock login, and
intercepts browser data requests with synthetic records. It blocks record
writes and verifies desktop/mobile layouts, both sort directions, combinations,
pagination, empty results, reset, and tab retention. Run `scripts/check-followups.mjs`
separately for the full follow-up state and approval regression checks; both use
the same QA port and must not run together.
