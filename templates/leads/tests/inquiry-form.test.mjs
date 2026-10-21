import test from 'node:test';
import assert from 'node:assert/strict';
import { inquiryFormLink } from '../lib/crm/inquiry-form.ts';

test('form links preserve their production path and query while trimming whitespace', () => {
  assert.deepEqual(inquiryFormLink('  https://forms.example.com/form/inquiry?source=website  '), {
    url: 'https://forms.example.com/form/inquiry?source=website', access: 'public',
  });
});

test('local form addresses are distinguished from links for outside customers', () => {
  for (const host of ['localhost', '127.0.0.1', '127.1.2.3', '[::1]', 'preview.localhost'])
    assert.equal(inquiryFormLink(`http://${host}:5678/form/inquiry`).access, 'local', host);
  assert.equal(inquiryFormLink('http://2130706433/form/inquiry').access, 'local');
  assert.equal(inquiryFormLink('https://localhost.example.com/form/inquiry').access, 'public');
});

test('private-network form addresses retain a network-only explanation', () => {
  for (const host of ['10.0.0.2', '192.168.1.10', '172.16.0.2', '172.31.255.2', '169.254.1.2', '[fd00::1]', '[fe80::1]', 'forms.local', 'host.docker.internal'])
    assert.equal(inquiryFormLink(`http://${host}/form/inquiry`).access, 'network', host);
  assert.equal(inquiryFormLink('https://172.32.0.2/form/inquiry').access, 'public');
});

test('unusable URLs, embedded credentials and executable schemes never become form links', () => {
  for (const value of ['', null, undefined, {}, '//forms.example.com/form/inquiry', 'not a URL', 'javascript:alert(1)', 'data:text/html,test', 'file:///tmp/form', 'ftp://forms.example.com', 'https://owner:secret@forms.example.com/form/inquiry', 'https://' + 'x'.repeat(2048)])
    assert.equal(inquiryFormLink(value), null);
});
