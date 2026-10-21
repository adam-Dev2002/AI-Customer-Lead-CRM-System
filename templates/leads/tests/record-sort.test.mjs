import test from 'node:test';
import assert from 'node:assert/strict';
import { sortRecords, leadSortOptions, followUpSortOptions, dateSortValue } from '../lib/crm/record-sort.ts';

test('customer names sort naturally, ignore case and retain equal-value order without changing records', () => {
  const rows = [{ id: 1, name: 'Customer 10' }, { id: 2, name: 'customer 2' }, { id: 3, name: 'CUSTOMER 2' }];
  const before = structuredClone(rows);
  assert.deepEqual(sortRecords(rows, { key: 'name', direction: 'asc' }, leadSortOptions).map(l => l.id), [2, 3, 1]);
  assert.deepEqual(sortRecords(rows, { key: 'name', direction: 'desc' }, leadSortOptions).map(l => l.id), [1, 2, 3]);
  assert.deepEqual(rows, before);
});

test('priority uses business urgency rather than alphabetical order in both tables and directions', () => {
  const rows = ['Normal', 'Urgent', 'Low', 'High'].map(priority => ({ priority }));
  for (const options of [leadSortOptions, followUpSortOptions]) {
    assert.deepEqual(sortRecords(rows, { key: 'priority', direction: 'asc' }, options).map(l => l.priority), ['Low', 'Normal', 'High', 'Urgent']);
    assert.deepEqual(sortRecords(rows, { key: 'priority', direction: 'desc' }, options).map(l => l.priority), ['Urgent', 'High', 'Normal', 'Low']);
  }
});

test('due dates compare actual instants across offsets and missing or invalid dates always stay last', () => {
  const rows = [
    { id: 'unscheduled', followUpDue: '' },
    { id: 'late', followUpDue: '2026-10-21T04:00:00Z' },
    { id: 'invalid', followUpDue: 'invalid' },
    { id: 'early', followUpDue: '2026-10-21T10:00:00+08:00' },
  ];
  assert.deepEqual(sortRecords(rows, { key: 'due', direction: 'asc' }, followUpSortOptions).map(l => l.id), ['early', 'late', 'unscheduled', 'invalid']);
  assert.deepEqual(sortRecords(rows, { key: 'due', direction: 'desc' }, followUpSortOptions).map(l => l.id), ['late', 'early', 'unscheduled', 'invalid']);
  assert.equal(dateSortValue(undefined), null);
});

test('sort the complete filtered data before pagination, including records outside the original first page', () => {
  const rows = Array.from({ length: 27 }, (_, index) => ({ id: index, name: `Customer ${27 - index}`, priority: index % 2 ? 'Urgent' : 'Low' }));
  const filtered = rows.filter(row => row.priority === 'Low');
  const sorted = sortRecords(filtered, { key: 'name', direction: 'asc' }, leadSortOptions);
  assert.deepEqual(sorted.slice(0, 10).map(l => l.name), Array.from({ length: 10 }, (_, i) => `Customer ${i * 2 + 1}`));
  assert.equal(sorted[0].id, 26);
  assert.equal(sorted.slice(10).length, 4);
});

test('numeric counts and permission booleans sort as numbers, and empty values remain last', () => {
  const rows = [{ count: 10 }, { count: 2 }, { count: 0 }, { count: null }];
  const options = [{ key: 'count', value: c => c.count }];
  assert.deepEqual(sortRecords(rows, { key: 'count', direction: 'asc' }, options).map(c => c.count), [0, 2, 10, null]);
  assert.deepEqual(sortRecords(rows, { key: 'count', direction: 'desc' }, options).map(c => c.count), [10, 2, 0, null]);
  assert.deepEqual(sortRecords([{ consent: false }, { consent: true }], { key: 'consent', direction: 'desc' }, followUpSortOptions).map(l => l.consent), [true, false]);
});

test('unknown sort keys and empty results return a safe copy', () => {
  const rows = [{ name: 'B' }, { name: 'A' }];
  assert.deepEqual(sortRecords(rows, { key: 'unknown', direction: 'asc' }, leadSortOptions), rows);
  assert.notEqual(sortRecords(rows, { key: 'unknown', direction: 'asc' }, leadSortOptions), rows);
  assert.deepEqual(sortRecords([], { key: 'due', direction: 'asc' }, followUpSortOptions), []);
});
