import test from 'node:test';
import assert from 'node:assert/strict';
import { inquiryGrowth } from '../lib/crm/inquiry-growth.ts';

test('daily inquiry counts preserve Singapore midnight and month boundaries', () => {
  const rows = [
    '2026-09-30T15:59:59.999Z', // 30 Sep
    '2026-09-30T16:00:00.000Z', // 1 Oct
    '2026-10-01T15:59:59.999Z', // 1 Oct
    '2026-10-01T16:00:00.000Z', // 2 Oct
    '2026-10-03T01:00:00.000Z', // outside the displayed days
    'invalid',
  ].map(createdAt => ({ createdAt }));
  assert.deepEqual(inquiryGrowth(rows, 3, 'Asia/Singapore', Date.parse('2026-10-02T04:00:00Z')), [
    { day: 'Sep 30', leads: 1 }, { day: 'Oct 1', leads: 2 }, { day: 'Oct 2', leads: 1 },
  ]);
});

test('chart grouping respects the selected timezone without altering records', () => {
  const rows = [{ createdAt: '2026-09-30T16:30:00Z' }], original = structuredClone(rows);
  const now = Date.parse('2026-10-01T04:00:00Z');
  assert.deepEqual(inquiryGrowth(rows, 2, 'UTC', now).map(day => day.leads), [1, 0]);
  assert.deepEqual(inquiryGrowth(rows, 2, 'Asia/Singapore', now).map(day => day.leads), [0, 1]);
  assert.deepEqual(rows, original);
});

test('a large set of inquiries is counted exactly once and missing days remain zero', () => {
  const now = Date.parse('2026-10-21T04:00:00Z');
  const rows = Array.from({ length: 10000 }, (_, i) => ({ createdAt: new Date(now - (i % 5) * 86400000).toISOString() }));
  const week = inquiryGrowth(rows, 7, 'Asia/Singapore', now);
  assert.deepEqual(week.map(day => day.leads), [0, 0, 2000, 2000, 2000, 2000, 2000]);
  assert.equal(week.reduce((sum, day) => sum + day.leads, 0), rows.length);
});
