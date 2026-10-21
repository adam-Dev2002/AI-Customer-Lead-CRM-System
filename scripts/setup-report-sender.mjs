import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const root = fileURLToPath(new URL("../", import.meta.url)), container = process.env.CUSTOMERLEAD_N8N_CONTAINER || "n8n";
const stage = "/tmp/customerlead-report-" + randomUUID().replaceAll("-", ""); let staged = false;
const call = args => execFileSync("docker", args, { encoding: "utf8", stdio: "pipe", windowsHide: true, maxBuffer: 8e6 });
try {
  call(["exec", container, "mkdir", "-m", "700", stage]); staged = true;
  for (const filename of ["report-sender.mjs", "mail-code.mjs"]) call(["cp", path.join(root, "scripts/n8n", filename), `${container}:${stage}/${filename}`]);
  const plan = JSON.parse(call(["exec", container, "node", "--no-warnings", stage + "/report-sender.mjs"]));
  if (plan.error) throw Error();
  if (process.argv.includes("--apply") && !plan.installed) {
    const data = JSON.parse(fs.readFileSync(path.join(root, "templates/leads/.data/crm.json"), "utf8"));
    if (data.mailJobs.some(job => ["Queued", "Sending"].includes(job.status)) || plan.activeExecutions) { console.log(JSON.stringify({ applied: false, waitForIdle: true })); process.exitCode = 2; }
    else {
      const result = JSON.parse(call(["exec", container, "node", "--no-warnings", stage + "/report-sender.mjs", "--apply"]));
      if (result.error) throw Error();
      if (result.restartRequired) {
        const latest = JSON.parse(fs.readFileSync(path.join(root, "templates/leads/.data/crm.json"), "utf8"));
        if (latest.mailJobs.some(job => job.status === "Sending")) throw Error("Wait for delivery before the engine reload.");
        call(["restart", "--timeout", "60", container]); result.engineReloaded = true;
      }
      console.log(JSON.stringify(result, null, 2));
    }
  } else console.log(JSON.stringify(plan, null, 2));
} catch { console.error("Report sender setup did not finish. Private workflow/CLI output withheld. Review the prepared helper and wait for idle executions before applying."); process.exitCode = 1; }
finally { if (staged) try { call(["exec", container, "node", "--no-warnings", stage + "/report-sender.mjs", "--cleanup"]); } catch {} }
