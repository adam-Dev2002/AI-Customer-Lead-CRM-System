import { createHash } from "node:crypto";
import { cloudConfiguration, cloudRPC } from "../crm/cloud-store.ts";
// Local development remains self-contained; hosted instances share database quotas.
const buckets = new Map<string, { count: number; expires: number }>();
export function consumeLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  for (const [id, entry] of buckets) if (entry.expires <= now) buckets.delete(id);
  const entry = buckets.get(key) || { count: 0, expires: now + windowMs };
  if (!buckets.has(key) && buckets.size >= 5000) return false;
  if (entry.count >= limit) return false;
  entry.count++;
  buckets.set(key, entry);
  return true;
}
export async function consumeSharedLimit(key: string, limit: number, windowMs: number) {
  if (!cloudConfiguration()) return consumeLimit(key, limit, windowMs);
  try {
    return await cloudRPC("crm_consume_limit", { p_key: createHash("sha256").update(key).digest("hex"), p_limit: limit, p_window_ms: windowMs }) === true;
  } catch { return false; }
}
