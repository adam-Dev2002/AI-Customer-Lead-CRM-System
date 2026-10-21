// These snippets run in n8n Code nodes. Keep them free of credentials.
export const mergeLead = String.raw`
const change = $('Loop changes').item.json;
const rows = $input.all().map(i => i.json);
const failure = rows.find(r => r.error);
if (failure) return [{json:{_syncError:'Could not read the existing Sheets record.'}}];
const matches = rows.filter(r => r.Lead_ID);
if (matches.length > 1) return [{json:{_syncError:'Duplicate Lead_ID rows found. Resolve them in Sheets before retrying.'}}];
const old = matches[0];
const p = change.payload;
const fields = change.fields || Object.keys(p);
const locked = old && ['Reserved','Sent'].includes(old.Follow_Up_State);
if (locked && String(change.intent).startsWith('followup.'))
  return [{json:{_syncError:'The follow-up is already reserved or sent. Check its execution before changing its schedule.'}}];
const row = old ? {...old} : {...p};
for (const field of fields) if (Object.hasOwn(p, field)) row[field] = p[field];
row.Lead_ID = p.Lead_ID;
// n8n owns delivery outcomes; an owner edit must not undo a reservation/send.
if (locked) row.Follow_Up_State = old.Follow_Up_State;
delete row.row_number;
return [{json:row}];
`;

export const prepareGmail = String.raw`
const change = $('Loop changes').item.json, p = change.payload, current = $json;
const fail = detail => ({json:{_syncError:detail}});
if (current.error) return fail('Could not read the Gmail draft. It may have been sent or deleted, or belong to another account. Check Gmail before retrying.');
if (String(current.id || '') !== String(p.Gmail_Draft_ID)) return fail('Gmail returned a different draft. Review the linked draft in Gmail.');
const headers = current.message?.payload?.headers || [];
const header = name => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
const to = header('To').trim();
const addresses = [...to.matchAll(/[A-Z0-9.!#$%&'*+/=?^_{}|~-]+@[A-Z0-9.-]+/gi)].map(m => m[0].toLowerCase());
if (to && (addresses.length !== 1 || addresses[0] !== String(p.Email).toLowerCase())) return fail('Draft recipient differs from this inquiry. Review it in Gmail.');
if (header('Cc') || header('Bcc')) return fail('This draft has copied recipients. Edit it in Gmail to preserve them.');
const attachment = part => !!part && (!!part.filename || !!part.body?.attachmentId || (part.parts || []).some(attachment));
if (attachment(current.message?.payload)) return fail('This draft has attachments. Edit it in Gmail to preserve them.');
if (p.Gmail_Thread_ID && current.message?.threadId !== p.Gmail_Thread_ID) return fail('Draft thread does not match this inquiry. Review it in Gmail.');
const subject = Buffer.from(String(p.Subject).replace(/[\r\n]/g,' '),'utf8').toString('base64');
const message = ['To: ' + p.Email, 'Subject: =?UTF-8?B?' + subject + '?=', 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(String(p.Body),'utf8').toString('base64').match(/.{1,76}/g).join('\r\n')].join('\r\n');
const result = {id:p.Gmail_Draft_ID, message:{raw:Buffer.from(message,'utf8').toString('base64url')}};
if (current.message?.threadId) result.message.threadId = current.message.threadId;
return {json:{gmailBody:result}};
`;

export const formCaptured = String.raw`
const p = {...$json};
if (!p.Lead_ID) throw new Error('Connect this adapter after SHEETS — Append Customer Lead.');
const classification = String(p.Notes || '').match(/^AI category:\s*(Sales|Quote|Booking|General)\.\s*(.+)$/s);
if (classification) { p.Category ||= classification[1]; p.AI_Summary ||= classification[2]; }
return {json:{eventId:$execution.id + ':form:' + p.Lead_ID,type:'lead.upsert',data:{...p,Create_Only:true}}};
`;

export const initialResults = String.raw`
const base = $('SHEETS — Append Customer Lead').item.json;
const p = {...base,...$json,Lead_ID:base.Lead_ID};
const classification = String(p.Notes || '').match(/^AI category:\s*(Sales|Quote|Booking|General)\.\s*(.+)$/s);
if (classification) { p.Category ||= classification[1]; p.AI_Summary ||= classification[2]; }
return {json:{eventId:$execution.id + ':initial-results:' + base.Lead_ID,type:'lead.delivery',data:p}};
`;

export const emailProcessed = String.raw`
const p = $('Review AI & Route').item.json, result = $json;
const leadId = 'GMAIL-' + p.message_id;
const name = String(p.from || '').replace(/^from:\s*/i,'').replace(/<[^>]*>/g,'').replace(/"/g,'').trim() || String(p.sender).split('@')[0] || 'Email customer';
const data = {Lead_ID:leadId,Name:name.length > 1 ? name : 'Email customer',Email:p.sender,Phone:'',Service:String(p.subject || 'Customer email inquiry').slice(0,120),Message:p.body,Source:'Gmail',Consent:'No',Status:'New',Priority:p.priority || 'Normal',Category:p.category || 'General',AI_Summary:p.summary || '',Notes:p.reason || '',Created_At_UTC:new Date().toISOString(),Follow_Up_State:'Skipped',Follow_Up_Due_UTC:'',Gmail_Thread_ID:p.thread_id,Title:'Email support processed',Detail:p.reason || p.ai_error || '',Stage:'support',Execution_ID:$execution.id,Workflow:$workflow.name};
if (p.create_draft && result.id && !result.error) Object.assign(data,{Draft_ID:'GMAIL-DRAFT-' + result.id,Gmail_Draft_ID:result.id,Subject:/^re:/i.test(p.subject || '') ? p.subject : 'Re: ' + (p.subject || 'Your inquiry'),Body:p.reply_body,Provider:p.ai_provider || 'Gemini',Review_Reason:p.reason || 'Owner review required'});
data.Status = 'New';
data.Run_Status = result.error || !p.valid ? 'failed' : p.outcome === 'skipped' ? 'skipped' : 'success';
return {json:{eventId:$execution.id + ':support:' + p.message_id,type:'support.processed',data}};
`;

export const followupReserved = String.raw`
const p = $('FILTER — Pending Consented Follow-Ups').item.json;
if ($json.error) throw new Error('Reservation failed; do not report it as reserved.');
return {json:{eventId:$execution.id + ':reserved:' + p.Lead_ID,type:'followup.updated',data:{Lead_ID:p.Lead_ID,Follow_Up_State:'Reserved',Run_Status:'running',Stage:'follow-up reservation',Execution_ID:$execution.id,Title:'Follow-up reserved'}}};
`;

export const followupOutcome = String.raw`
const p = $json;
if (!p.Lead_ID || !p.Follow_Up_State) throw new Error('Connect after SHEETS — Log Follow-Up Outcome and retain its saved fields.');
return {json:{eventId:$execution.id + ':followup:' + p.Lead_ID,type:'followup.updated',data:{...p,Run_Status:p.Follow_Up_State === 'Needs Review' ? 'failed' : 'success',Execution_ID:$execution.id,Stage:'follow-up result',Title:'Follow-up ' + p.Follow_Up_State}}};
`;

export const screeningResult = String.raw`
const p = $('Prepare Email + Safety Screen').item.json;
return {json:{eventId:$execution.id + ':screened:' + p.message_id,type:'automation.run',data:{Title:'Email screened out',Detail:JSON.stringify(p.eligibility_debug || {}),Status:'skipped',Stage:'email screening',Execution_ID:$execution.id,Workflow:$workflow.name}}};
`;

export const rejectedForm = String.raw`
return {json:{eventId:$execution.id + ':form-rejected',type:'automation.run',data:{Title:'Form inquiry not captured',Detail:String($json.error || 'Duplicate inquiry suppressed within 15 minutes.'),Status:'skipped',Stage:'validation / deduplication',Execution_ID:$execution.id,Workflow:$workflow.name}}};
`;

export const executionFailed = String.raw`
const e=$json.execution || {}, w=$json.workflow || {};
return {json:{eventId:'error:' + String(e.id || $execution.id),type:'automation.run',data:{Title:'Automation execution failed',Detail:String(e.error?.message || 'Inspect the failed execution in n8n.').slice(0,1000),Status:'failed',Stage:String(e.lastNodeExecuted || ''),Execution_ID:String(e.id || ''),Workflow:String(w.name || '')}}};
`;
