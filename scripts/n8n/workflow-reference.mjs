import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Only names/types are inspected here. Never copy source credentials or node
// parameters into downloadable artifacts.
const requiredNodes = {
  'FORM — Customer Inquiry': 'formTrigger',
  'SHEETS — Append Customer Lead': 'googleSheets',
  'SHEETS — Save Initial Email Results': 'googleSheets',
  'Review AI & Route': 'code',
  'Gmail — Create Draft (NEVER SEND)': 'gmail',
  'Gmail — Label No-Draft Outcome': 'gmail',
  'Prepare Email + Safety Screen': 'code',
  'Gmail — Mark Skipped': 'gmail',
  'CHECK — Is Lead Valid?': 'if',
  'CHECK — Not Duplicate?': 'if',
  'FILTER — Pending Consented Follow-Ups': 'code',
  'SHEETS — Reserve Follow-Up': 'googleSheets',
  'SHEETS — Log Follow-Up Outcome': 'googleSheets',
  'TAG — Form Submission': 'code',
  'TAG — Scheduled Review': 'code',
  'ROUTE — Is Customer Form?': 'if',
  'CONFIG — BUSINESS, FAQ & AI MODELS': 'set',
};

export function readReviewedWorkflow() {
  const reference = JSON.parse(readFileSync(new URL('./source-reference.json', import.meta.url), 'utf8'));
  const raw = readFileSync(reference.sourcePath);
  const sha256 = createHash('sha256').update(raw).digest('hex');
  if (sha256 !== reference.sha256)
    throw new Error('The selected automation has changed since review. Compare the current file and update source-reference.json before rebuilding the integration kit.');
  const workflow = JSON.parse(raw.toString('utf8'));
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length !== reference.nodeCount)
    throw new Error('The selected workflow node count does not match its review.');
  const nodes = new Map(workflow.nodes.map(node => [node.name, node]));
  if (nodes.size !== workflow.nodes.length) throw new Error('Workflow node names must be unique.');
  for (const [name, type] of Object.entries(requiredNodes)) {
    if (nodes.get(name)?.type !== `n8n-nodes-base.${type}`)
      throw new Error(`The current workflow is missing the adapter source node: ${name} (${type}).`);
  }
  for (const [name, connections] of Object.entries(workflow.connections || {})) {
    if (!nodes.has(name)) throw new Error(`Unknown connection source: ${name}.`);
    for (const edge of (connections.main || []).flat()) {
      if (!nodes.has(edge.node)) throw new Error(`Unknown connection destination: ${edge.node}.`);
    }
  }
  const missingFallbacks = [
    ['IF — Primary Gemini?', 'AI — OpenAI Primary'],
    ['IF — Gemini Valid?', 'AI — OpenAI Backup'],
  ].filter(([from, to]) => !(workflow.connections[from]?.main?.[1] || []).some(edge => edge.node === to));
  return {
    workflow,
    publicReference: {
      fileName: reference.fileName,
      sha256,
      reviewedOn: reference.reviewedOn,
      sourceModifiedUtc: reference.sourceModifiedUtc,
      nodeCount: workflow.nodes.length,
      activeInExport: workflow.active === true,
      adapterSourcesChecked: Object.keys(requiredNodes).length,
      missingFallbacks: missingFallbacks.map(([from, to]) => ({ from, to })),
    },
  };
}
