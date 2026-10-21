// The sender consumes only replies explicitly approved and confirmed in the CRM.
export const prepareMailDraft = String.raw`
const job = $('Claim approved reply').first().json.job;
const current = $json;
const fail = detail => ({json:{_mailError:detail}});
if (current.error) return fail('Could not read the Gmail reply context. Check the Gmail account and linked draft/thread. No send was attempted.');
const profile = $('Read sending Gmail account').first().json;
if (!profile.emailAddress || profile.emailAddress.toLowerCase() !== job.senderEmail.toLowerCase()) return fail('The sending Gmail account changed. No send was attempted.');
if (job.kind === 'lead-report') {
  if (job.gmailDraftId || job.gmailThreadId || typeof job.reportRaw !== 'string' || job.reportRaw.length > 20000000 || !/^[A-Za-z0-9_-]+$/.test(job.reportRaw)) return fail('The report attachments are unavailable. No send was attempted.');
  const raw = Buffer.from(job.reportRaw, 'base64url').toString('utf8');
  const envelope = raw.split('\r\n\r\n')[0];
  const field = name => envelope.split('\r\n').find(line => line.toLowerCase().startsWith(name.toLowerCase() + ':'))?.slice(name.length + 1).trim() || '';
  if (field('From').toLowerCase() !== profile.emailAddress.toLowerCase() || field('To').toLowerCase() !== job.to.toLowerCase() || field('Cc') || field('Bcc') || !field('Content-Type').startsWith('multipart/mixed;')) return fail('The report recipient or attachments changed. No send was attempted.');
  return {json:{gmailBody:{message:{raw:job.reportRaw}}}};
}
let headers = [], threadId = '', replyTo = '', references = '';
const header = name => headers.find(h => String(h.name).toLowerCase() === name.toLowerCase())?.value || '';
if (job.gmailDraftId) {
  if (String(current.id) !== job.gmailDraftId) return fail('Gmail returned a different draft. No send was attempted.');
  headers = current.message?.payload?.headers || [];
  const addresses = [...header('To').matchAll(/[A-Z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[A-Z0-9.-]+/gi)].map(m => m[0].toLowerCase());
  if (header('To').trim() && (addresses.length !== 1 || addresses[0] !== job.to.toLowerCase())) return fail('The Gmail draft recipient differs from the confirmed recipient. No send was attempted.');
  if (header('Cc') || header('Bcc')) return fail('This Gmail draft has copied recipients. Review it in Gmail. No send was attempted.');
  const attachment = part => !!part && (!!part.filename || !!part.body?.attachmentId || (part.parts || []).some(attachment));
  if (attachment(current.message?.payload)) return fail('This Gmail draft has attachments. Review it in Gmail. No send was attempted.');
  if (job.gmailThreadId && current.message?.threadId !== job.gmailThreadId) return fail('The Gmail draft belongs to a different thread. No send was attempted.');
  threadId = current.message?.threadId || '';
  replyTo = header('In-Reply-To'); references = header('References');
} else if (job.gmailThreadId) {
  if (current.id !== job.gmailThreadId || !current.messages?.length) return fail('Could not verify the customer email thread. No send was attempted.');
  headers = current.messages[current.messages.length - 1].payload?.headers || [];
  const participants = header('From') + ' ' + header('To');
  const addresses = [...participants.matchAll(/[A-Z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[A-Z0-9.-]+/gi)].map(m => m[0].toLowerCase());
  if (!addresses.includes(job.to.toLowerCase())) return fail('The recipient is not present in the linked thread. No send was attempted.');
  threadId = current.id; replyTo = header('Message-ID'); references = (header('References') + ' ' + replyTo).trim();
}
const subjectKey = s => String(s).replace(/^(re:\s*)+/i,'').trim().toLowerCase();
if (threadId && subjectKey(header('Subject')) !== subjectKey(job.subject)) return fail('Keep the original email subject when replying in its Gmail thread. No send was attempted.');
const safeIds = value => (String(value).match(/<[^<>\s\r\n]+>/g) || []).slice(-12).join(' ');
// RFC 2047 encoded words stay below 75 characters, including multibyte subjects.
const words = []; let word = '';
for (const character of job.subject) {
  if (word && Buffer.byteLength(word + character, 'utf8') > 42) { words.push(word); word = ''; }
  word += character;
}
if (word) words.push(word);
const encodedSubject = words.map(part => '=?UTF-8?B?' + Buffer.from(part, 'utf8').toString('base64') + '?=').join('\r\n ');
const lines = [
  'From: ' + profile.emailAddress,
  'To: ' + job.to,
  'Subject: ' + encodedSubject,
  'Date: ' + new Date(job.createdAt).toUTCString(),
  'Message-ID: <customerlead.' + job.id.replace(/[^a-zA-Z0-9-]/g,'') + '@customerlead.local>',
  'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64'
];
if (safeIds(replyTo)) lines.push('In-Reply-To: ' + safeIds(replyTo));
if (safeIds(references)) lines.push('References: ' + safeIds(references));
lines.push('', Buffer.from(job.body,'utf8').toString('base64').match(/.{1,76}/g).join('\r\n'));
const message = {raw:Buffer.from(lines.join('\r\n'),'utf8').toString('base64url')};
if (threadId) message.threadId = threadId;
return {json:{gmailBody:{...(job.gmailDraftId ? {id:job.gmailDraftId} : {}),message}}};
`;

export const mailResult = String.raw`
const job = $('Claim approved reply').first().json.job;
const sent = !$json.error && !!$json.id;
return {json:{action:'result',jobId:job.id,executionId:$execution.id,status:sent ? 'Sent' : 'Needs Review',gmailMessageId:sent ? $json.id : '',gmailThreadId:sent ? ($json.threadId || '') : '',detail:sent ? '' : 'Gmail delivery could not be confirmed. Check Sent and Drafts in Gmail before sending again.'}};
`;

export const mailPreparationFailed = String.raw`
const job = $('Claim approved reply').first().json.job;
return {json:{action:'result',jobId:job.id,executionId:$execution.id,status:'Needs Review',detail:$json._mailError || 'Could not prepare the Gmail draft. No send was attempted. Check the Gmail credential and draft.'}};
`;
