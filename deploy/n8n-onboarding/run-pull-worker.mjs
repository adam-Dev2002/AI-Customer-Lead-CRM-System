// Run inside the existing n8n container. --check performs no job or import.
import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { validateWorkerConfig, workerClients, localWorkerReady, checkWorkerConnections, runWorkerOnce } from './pull-worker.mjs';

const filename = process.argv[process.argv.indexOf('--config') + 1];
if (!process.argv.includes('--config') || !filename) throw new Error('Choose the private worker configuration file.');
const config = validateWorkerConfig(JSON.parse(await readFile(filename, 'utf8')));
config.receiptDirectory = path.join(path.dirname(filename), 'receipts');
const clients = workerClients(config);
if (process.argv.includes('--check-public')) {
  const result = await checkWorkerConnections(clients, config);
  console.log(JSON.stringify({ ...result, workerId: config.workerId, mode: 'outbound-only' }));
  process.exit(result.localN8nReady && result.publicCrmReady ? 0 : 1);
}
if (process.argv.includes('--check')) {
  const localReady = await localWorkerReady(clients, config);
  console.log(JSON.stringify({ localN8nReady: localReady, workerId: config.workerId, mode: 'outbound-only', jobsExecuted: 0 }));
  process.exit(localReady ? 0 : 1);
}
if (!process.argv.includes('--run')) throw new Error('Use --check, --check-public or --run.');
// An OS-owned loopback socket prevents duplicate processes and releases on
// crashes. It serves no data and is never published outside the container.
const guard = net.createServer(socket => socket.destroy());
await new Promise((resolve, reject) => { guard.once('error', reject); guard.listen(47687, '127.0.0.1', resolve); });
const journalFile = path.join(path.dirname(filename), 'journal.enc');
const encryptionKey = createHash('sha256').update(config.workerKey + ':local-journal').digest();
const aad = Buffer.from(config.workerId);
const journal = {
  async read() {
    let raw; try { raw = await readFile(journalFile, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const [iv, tag, bytes] = raw.split('.'), decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(iv, 'base64url'));
    decipher.setAAD(aad); decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(bytes, 'base64url')), decipher.final()]).toString());
  },
  async write(value) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey, iv); cipher.setAAD(aad);
    const bytes = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    await writeFile(journalFile + '.tmp', [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), bytes.toString('base64url')].join('.'), { mode: 0o600 });
    await rename(journalFile + '.tmp', journalFile);
  },
  async clear() { await rm(journalFile, { force: true }); },
};
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopping = true; });
while (!stopping) {
  try {
    const ready = await localWorkerReady(clients, config);
    await clients.post({ action: 'heartbeat', ready });
    if (ready) {
      const result = await runWorkerOnce(config, clients, journal);
      if (result !== 'idle') console.log(JSON.stringify({ at: new Date().toISOString(), result }));
    }
  } catch { console.error('Local onboarding worker is waiting for a confirmed connection. No unconfirmed operation was retried.'); }
  if (!stopping) await new Promise(resolve => setTimeout(resolve, 5000));
}
guard.close();
