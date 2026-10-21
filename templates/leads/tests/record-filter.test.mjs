import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesSelection, readSingleSelection } from '../lib/crm/record-filter.ts';

test('single-choice filters match one exact value and intersect separate groups', () => {
  const rows = [
    { id: 1, status: 'New', priority: 'High' },
    { id: 2, status: 'Pending', priority: 'High' },
    { id: 3, status: 'New', priority: 'Urgent' },
    { id: 4, status: 'Closed', priority: 'High' },
  ];
  const selected = rows.filter(row => matchesSelection('New', row.status) && matchesSelection('High', row.priority));
  assert.deepEqual(selected.map(row => row.id), [1]);
  assert.equal(matchesSelection('High', 'Urgent'), false);
});

test('All restores unrestricted results and source/owner text remains literal', () => {
  assert.equal(matchesSelection('all', 'New'), true);
  assert.equal(matchesSelection('all', ''), true);
  assert.equal(matchesSelection('Partner, website', 'Partner, website'), true);
  assert.equal(matchesSelection('Owner A | B', 'Owner A | B'), true);
  assert.equal(matchesSelection('Partner, website', 'website'), false);
});

test('older multi-value links resolve to one visible valid selection', () => {
  const params = new URLSearchParams('status=New&status=Pending&priority=High&priority=Urgent');
  assert.equal(readSingleSelection(params.getAll('status'), ['New', 'Pending']), 'New');
  assert.equal(readSingleSelection(params.getAll('priority'), ['Low', 'Normal', 'High', 'Urgent']), 'High');
  assert.equal(readSingleSelection(['unknown', 'Pending', 'Sent'], ['Pending', 'Sent']), 'Pending');
  assert.equal(readSingleSelection(['all', 'Pending'], ['Pending']), 'all');
  assert.equal(readSingleSelection(['invalid'], ['New', 'Pending']), 'all');
});
