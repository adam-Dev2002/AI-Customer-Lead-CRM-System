import { createHash } from 'node:crypto';

export const canonicalJSON = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

// n8n resolves credential names from its database on workflow reads. A bound
// credential's ID is its identity; its display name is not executable configuration.
// Ignore ONLY that label when an explicit ID is present. All node parameters,
// credential IDs/types/other fields and connections remain in the fingerprint.
export function workflowDigest(workflow) {
  const nodes = structuredClone(workflow.nodes);
  if (Array.isArray(nodes)) for (const node of nodes) {
    if (!node.credentials || typeof node.credentials !== 'object') continue;
    for (const binding of Object.values(node.credentials)) {
      if (binding && typeof binding === 'object' && typeof binding.id === 'string' && binding.id) delete binding.name;
    }
  }
  return createHash('sha256').update(canonicalJSON({ nodes, connections: workflow.connections })).digest('hex');
}

export const workerFailureCodes = ['verification-failed', 'connection-changed', 'connection-active', 'connection-missing'];
