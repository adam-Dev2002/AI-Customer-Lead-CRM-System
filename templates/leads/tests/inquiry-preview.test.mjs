import test from 'node:test';
import assert from 'node:assert/strict';
import { inquiryPreview, inquiryText } from '../lib/crm/inquiry-preview.ts';

test('short questions keep the actual customer message visible', () => {
  const row = { service: 'Leaking tap', message: 'Can someone inspect my kitchen tap tomorrow?', summary: 'Saved AI classification' };
  assert.deepEqual(inquiryPreview(row), { title: 'Leaking tap', text: row.message, isSummary: false });
});

test('long inquiries use their saved summary without changing the original message', () => {
  const row = { service: 'Water meter leak', message: 'There is a leak near the water meter. '.repeat(20), summary: 'Customer reports an ongoing leak near the meter and requests an inspection.' };
  const original = structuredClone(row);
  assert.deepEqual(inquiryPreview(row), { title: row.service, text: row.summary, isSummary: true });
  assert.deepEqual(row, original);
});

test('missing summaries fall back to the original inquiry and never claim AI generated new text', () => {
  const row = { service: 'Warranty question', message: 'Please explain the warranty coverage. '.repeat(12), summary: '' };
  assert.equal(inquiryPreview(row).text, row.message.trim());
  assert.equal(inquiryPreview(row).isSummary, false);
  assert.deepEqual(inquiryPreview({ service: '', message: '', summary: '' }), { title: 'Customer inquiry', text: '', isSummary: false });
  assert.equal(inquiryPreview({ service: 'Tap', message: '', summary: 'Customer needs a tap inspection.' }).isSummary, true);
});

test('previews decode common email entities and whitespace as plain text', () => {
  assert.equal(inquiryText('Repairs &amp; quotes &ndash; today\n  please &#x1F6BF;'), 'Repairs & quotes – today please 🚿');
  assert.equal(inquiryText('&lt;script&gt;sample&lt;/script&gt;'), '<script>sample</script>');
  assert.equal(inquiryText('Invalid: &#x110000; &#55296; &unknown;'), 'Invalid: &#x110000; &#55296; &unknown;');
});

test('previews avoid repeating a subject or labeling a copied message as an AI summary', () => {
  assert.deepEqual(inquiryPreview({ service: 'Tap inspection', message: 'Tap inspection', summary: '' }), { title: 'Tap inspection', text: '', isSummary: false });
  const message = 'Please inspect the tap. '.repeat(15).trim();
  assert.equal(inquiryPreview({ service: 'Tap', message, summary: message }).isSummary, false);
});
