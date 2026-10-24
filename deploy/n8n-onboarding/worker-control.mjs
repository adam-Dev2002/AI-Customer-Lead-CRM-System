// Operator-only lifecycle control. Matches the exact installed runner/config;
// never stops n8n, removes a journal, or kills a process mid-operation.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function isWorkerCommand(args, directory) {
  return args.length === 5 && ['node', 'nodejs'].includes(path.posix.basename(args[0])) && args[1] === directory + '/run-pull-worker.mjs' && args[2] === '--config' && args[3] === directory + '/worker.json' && args[4] === '--run';
}
async function workerPids(directory) {
  const found = [];
  for (const item of await readdir('/proc')) {
    if (!/^\d+$/.test(item) || Number(item) <= 1 || Number(item) === process.pid) continue;
    try {
      const args = (await readFile('/proc/' + item + '/cmdline', 'utf8')).split('\0').filter(Boolean);
      if (isWorkerCommand(args, directory)) found.push(Number(item));
    } catch { /* Process may have exited between listing and reading. */ }
  }
  return found;
}
async function main() {
  const directory = process.argv[2], action = process.argv[3];
  if (directory !== '/home/node/.n8n/customerlead-onboarding-worker' || !['status', 'stop'].includes(action)) throw new Error('Choose the installed onboarding worker and a supported action.');
  let pids = await workerPids(directory);
  if (action === 'stop') {
    for (const pid of pids) { try { process.kill(pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    // SIGTERM lets the existing job/callback finish. Refuse a forced stop.
    for (let i = 0; pids.length && i < 100; i++) {
      await new Promise(resolve => setTimeout(resolve, 250)); pids = await workerPids(directory);
    }
    if (pids.length) throw new Error('Worker is still finishing its current operation. Its files and journal must be retained. Retry after it finishes.');
  }
  console.log(JSON.stringify({ running: pids.length > 0, processes: pids.length }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('The onboarding worker could not be safely controlled. No forced stop or journal reset was performed.'); process.exitCode = 1; });
}
