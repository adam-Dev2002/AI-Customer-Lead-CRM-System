import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import type { CRMData, CRMSnapshot, Mutation, MailJob } from "./types";
import { createSeed, defaultSettings } from "./seed.ts";
import { applyMutation, applyAutomationEvent } from "./domain.ts";
import { ValidationError, text } from "./domain.ts";
import { pendingSyncChanges, queueEmailMirrors, workflowConfiguration } from "./integration.ts";
import { claimMail, prepareMail, finishMail } from "./mail.ts";
import { claimFollowUp } from "./followups.ts";
import { businessLogo } from "./business-logo.ts";
import { queueReportDelivery, type ReportDeliveryInput } from "./report-mail.ts";
import type { ReportMeta } from "./report-model";
import { cloudConfiguration, cloudWorkspace, stageCloudWorkspace, cloudTransaction } from "./cloud-store.ts";

const directory = process.env.CRM_DATA_DIR || path.join(process.cwd(), ".data");
// Workspace records are runtime data, never application build assets.
const filename = path.join(/* turbopackIgnore: true */ directory, "crm.json");
const runtime = globalThis as typeof globalThis & {
  __crmQueue?: Promise<unknown>;
};
async function load(): Promise<CRMData> {
  try {
    const parsed = cloudConfiguration() ? cloudWorkspace() : JSON.parse(await readFile(filename, "utf8"));
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.leads) ||
      !Array.isArray(parsed.activities)
    )
      throw new Error("Unsupported CRM data format.");
    // Migrate local workspaces without resetting their saved records.
    const data: CRMData = {
      ...parsed,
      settings: {
        ...defaultSettings, ...parsed.settings,
        gmailQuery: !parsed.settings?.gmailQuery || parsed.settings.gmailQuery === "in:inbox -label:AI_Processed -label:AI_Processing -from:me"
          ? defaultSettings.gmailQuery : parsed.settings.gmailQuery,
      },
      syncChanges: parsed.syncChanges || [],
      archivedLeadIds: parsed.archivedLeadIds || [],
      lastSyncPollAt: parsed.lastSyncPollAt || "",
      lastConfigReadAt: parsed.lastConfigReadAt || "",
      mailJobs: parsed.mailJobs || [],
      lastMailPollAt: parsed.lastMailPollAt || "",
      mailSenderEmail: parsed.mailSenderEmail || "",
    };
    if ((data.emailMirrorVersion || 0) < 1) {
      for (const lead of data.leads.filter(l => !l.isSample && l.source === "Gmail")) {
        const draft = data.drafts.find(d => d.leadId === lead.id);
        queueEmailMirrors(data, lead, draft, new Date().toISOString(), randomUUID);
      }
      data.emailMirrorVersion = 1;
      await save(data);
    }
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const seed = createSeed();
    await save(seed);
    return seed;
  }
}
async function save(data: CRMData) {
  if (cloudConfiguration()) { stageCloudWorkspace(data); return; }
  await mkdir(directory, { recursive: true });
  const temporary = path.join(
    /* turbopackIgnore: true */ directory,
    `crm-${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
    await rename(temporary, filename);
  } finally {
    await rm(temporary, { force: true });
  }
}
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const run = () => cloudTransaction(work);
  const pending = (runtime.__crmQueue || Promise.resolve()).then(run, run);
  runtime.__crmQueue = pending.catch(() => undefined);
  return pending;
}
function snapshot(data: CRMData): CRMSnapshot {
  return {
    ...data,
    connection: {
      mode: cloudConfiguration() ? "supabase" : "local",
      webhookReady: !!process.env.N8N_WEBHOOK_SECRET,
      lastEventAt: data.lastAutomationEventAt,
      lastPollAt: data.lastSyncPollAt,
      lastConfigReadAt: data.lastConfigReadAt,
      pendingChanges: data.syncChanges.filter(c => c.status === "Pending").length,
      failedChanges: data.syncChanges.filter(c => c.status === "Failed").length,
      lastMailPollAt: data.lastMailPollAt,
      mailSenderEmail: data.mailSenderEmail,
    },
  };
}
export const getSnapshot = () => serialized(async () => snapshot(await load()));
export const saveBusinessLogo = (value: string) => serialized(async () => {
  if (value && businessLogo(value) !== value) throw new ValidationError("Choose a valid business logo.");
  const data = await load();
  data.settings.businessLogo = value;
  data.activities.unshift({ id: randomUUID(), type: "settings", title: value ? "Business logo updated" : "Default business logo restored", detail: "Workspace branding saved.", createdAt: new Date().toISOString() });
  data.activities = data.activities.slice(0, 3000);
  await save(data);
});
export const mutate = (mutation: Mutation) =>
  serialized(async () => {
    const data = await load();
    applyMutation(data, mutation, new Date().toISOString(), randomUUID);
    await save(data);
    return snapshot(data);
  });
export const receiveEvent = (event: Record<string, unknown>) =>
  serialized(async () => {
    const data = await load(),
      result = applyAutomationEvent(
        data,
        event,
        new Date().toISOString(),
        randomUUID,
      );
    if (!result.duplicate) await save(data);
    return result;
  });

export const pollChanges = () => serialized(async () => {
  const data = await load();
  data.lastSyncPollAt = new Date().toISOString();
  await save(data);
  return { version: 1, changes: pendingSyncChanges(data) };
});

export const readConfiguration = () => serialized(async () => {
  const data = await load();
  data.lastConfigReadAt = new Date().toISOString();
  await save(data);
  return { version: 1, config: workflowConfiguration(data) };
});

export const handleMail = (input: Record<string, unknown>) => serialized(async () => {
  const data = await load(), now = new Date().toISOString();
  let result: { job: (MailJob & { reportRaw?: string }) | null } | { accepted: boolean; gmailDraftId?: string; duplicate?: boolean };
  if (input.action === "claim") {
    result = claimMail(data, input, now);
    if (result.job?.kind === "lead-report") {
      const claimed = result.job;
      try {
        const { readReportMime } = await import("./report-files.ts");
        const raw = await readReportMime(result.job.reportId!, result.job.reportDigest);
        if (createHash("sha256").update(raw).digest("hex") !== result.job.reportDigest) throw new Error("Report changed");
        result = { job: { ...result.job, reportRaw: raw } };
      } catch {
        const job = data.mailJobs.find(job => job.id === claimed.id)!;
        job.status = "Needs Review"; job.detail = "The saved report could not be opened. No send was attempted.";
        result = { job: null };
      }
    }
  }
  else if (input.action === "prepared") result = prepareMail(data, input, now);
  else if (input.action === "result") result = finishMail(data, input, now, randomUUID);
  else throw new ValidationError("Provide claim, prepared, or result action.");
  await save(data);
  return result;
});
export const queueReport = (report: ReportMeta, input: ReportDeliveryInput, raw: string) => serialized(async () => {
  const data = await load();
  const digest = createHash("sha256").update(raw).digest("hex");
  const job = queueReportDelivery(data, report, { ...input, digest }, new Date().toISOString());
  const { saveReportMime } = await import("./report-files.ts");
  await saveReportMime(report.id, raw);
  await save(data);
  return { jobId: job.id };
});

export const handleFollowUp = (input: Record<string, unknown>) => serialized(async () => {
  const data = await load();
  const result = claimFollowUp(data, input, new Date().toISOString());
  if (result.claimed) await save(data);
  return result;
});

export const acknowledgeChange = (input: Record<string, unknown>) => serialized(async () => {
  const data = await load();
  const change = data.syncChanges.find(c => c.id === input.changeId);
  if (!change) throw new ValidationError("Update not found.", 404);
  if (!["Applied", "Failed"].includes(String(input.status))) throw new ValidationError("Provide Applied or Failed status.");
  if (change.status === "Applied") return { accepted: true, duplicate: true };
  const earlier = data.syncChanges.slice(0, data.syncChanges.indexOf(change));
  if (earlier.some(c => c.entityId === change.entityId && c.status !== "Applied"))
    throw new ValidationError("Apply the earlier update for this record first.", 409);
  const now = new Date().toISOString();
  change.status = input.status as "Applied" | "Failed";
  change.detail = text(input.detail, 1000);
  change.updatedAt = now;
  const draftId = text(input.gmailDraftId, 200);
  if (change.status === "Applied" && change.kind === "draft.review" && draftId) {
    const draft = data.drafts.find(d => d.id === change.payload.Draft_ID);
    if (draft) draft.gmailDraftId = draftId;
    for (const pending of data.syncChanges) {
      if (pending.entityId === change.entityId && pending.status !== "Applied") pending.payload.Gmail_Draft_ID = draftId;
    }
  }
  data.activities.unshift({ id: randomUUID(), type: "automation", title: `n8n update ${change.status.toLowerCase()}`,
    detail: `${change.label}${change.detail ? `: ${change.detail}` : ""}`, leadId: change.leadId,
    createdAt: now, status: change.status === "Applied" ? "success" : "failed", executionId: text(input.executionId, 100) || undefined });
  data.activities = data.activities.slice(0, 3000);
  await save(data);
  return { accepted: true, duplicate: false };
});
