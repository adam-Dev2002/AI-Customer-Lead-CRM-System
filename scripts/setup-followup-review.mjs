import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const container = process.env.CUSTOMERLEAD_N8N_CONTAINER || "n8n";
const stage = "/tmp/customerlead-followup-" + randomUUID().replaceAll("-", "");
const call = args => execFileSync("docker", args, { encoding: "utf8", stdio: "pipe", windowsHide: true, maxBuffer: 8e6 });
const idle = () => {
  const data = JSON.parse(fs.readFileSync(path.join(root, "templates/leads/.data/crm.json"), "utf8"));
  if (data.mailJobs.some(job => ["Queued", "Sending"].includes(job.status)) || data.leads.some(lead => lead.followUpState === "Reserved"))
    throw Error("Wait for existing deliveries before updating the sender.");
};
let staged = false;
try {
  call(["exec", container, "mkdir", "-m", "700", stage]); staged = true;
  for (const filename of ["install-followup-review.mjs", "followup-review.mjs"])
    call(["cp", path.join(root, "scripts/n8n", filename), `${container}:${stage}/${filename}`]);
  const plan = JSON.parse(call(["exec", container, "node", "--no-warnings", stage + "/install-followup-review.mjs"]));
  if (plan.error) throw Error();
  if (!process.argv.includes("--apply") || plan.installed) console.log(JSON.stringify(plan, null, 2));
  else {
    idle(); if (plan.running) throw Error("Wait for running executions.");
    // Only inspect authenticated health; never claim a real customer email.
    const env = fs.readFileSync(path.join(root, "templates/leads/.env.local"), "utf8");
    const secret = env.match(/^N8N_WEBHOOK_SECRET\s*=\s*(.+)$/m)?.[1].trim().replace(/^['"]|['"]$/g, "");
    if (!secret) throw Error();
    const health = await fetch("http://127.0.0.1:3001/api/n8n/health", { headers: { Authorization: "Bearer " + secret }, signal: AbortSignal.timeout(15000) });
    if (!health.ok || !(await health.json()).capabilities?.approvedFollowUps) throw Error("Start the updated CRM before installing follow-up review.");
    const result = JSON.parse(call(["exec", container, "node", "--no-warnings", stage + "/install-followup-review.mjs", "--apply"]));
    if (result.error) throw Error();
    if (result.restartRequired) { idle(); call(["restart", "--timeout", "60", container]); result.engineReloaded = true; }
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(error.message?.startsWith("Wait for") || error.message?.startsWith("Start the updated") ? error.message : "Follow-up sender setup did not finish. Private CLI output withheld. Check Docker and the prepared helper.");
  process.exitCode = 1;
} finally {
  if (staged) try { call(["exec", container, "node", "--no-warnings", stage + "/install-followup-review.mjs", "--cleanup"]); } catch {}
}
