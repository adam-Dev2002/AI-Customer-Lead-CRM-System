import { readFile } from "node:fs/promises";
import path from "node:path";
import { readPrivateFile } from "./private-files.ts";
import { currentWorkspaceId } from "./workspace-context.ts";
import { assistantInstruction, validatedAssistantAnswer, type AssistantSource } from "./assistant-context.ts";

type Config = { apiKey: string; model: string };
export async function assistantConfiguration(): Promise<Config | null> {
  try {
    const legacy = !currentWorkspaceId() || currentWorkspaceId() === "clearflow";
    let stored: Partial<Config> = {};
    if (!legacy || !process.env.GEMINI_ASSISTANT_API_KEY) {
      const directory = process.env.CRM_DATA_DIR || path.join(process.cwd(), ".data");
      const filename = process.env.GEMINI_ASSISTANT_CONFIG_FILE || path.join(/* turbopackIgnore: true */ directory, "assistant-gemini.json");
      stored = JSON.parse(legacy && process.env.GEMINI_ASSISTANT_CONFIG_FILE ? await readFile(/* turbopackIgnore: true */ filename, "utf8") : (await readPrivateFile("config/assistant-gemini.json")).toString("utf8"));
    }
    const apiKey = (legacy && process.env.GEMINI_ASSISTANT_API_KEY) || stored.apiKey;
    const model = (legacy && process.env.GEMINI_ASSISTANT_MODEL) || stored.model;
    if (!apiKey || !model || !/^[a-z0-9.-]+$/.test(model)) return null;
    return { apiKey, model };
  } catch { return null; }
}

export type AssistantHistory = { role: "user" | "assistant"; text: string }[];
export class AssistantServiceError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export async function askGemini(config: Config, context: unknown, sources: AssistantSource[], question: string, history: AssistantHistory, request: typeof fetch = fetch) {
  let response: Response;
  try {
    response = await request(`https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(30000),
      headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: assistantInstruction }] },
        contents: [{ role: "user", parts: [{ text: JSON.stringify({ workspaceSnapshot: context, availableSources: sources, conversation: history, question }) }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048, responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { answer: { type: "STRING" }, sourceIds: { type: "ARRAY", items: { type: "STRING" } } }, required: ["answer", "sourceIds"] } },
      }),
    });
  } catch { throw new AssistantServiceError("The assistant took too long to respond. Please try again.", 504); }
  if (!response.ok) throw new AssistantServiceError(response.status === 429 ? "The assistant is busy or has reached its usage limit. Please try again later." : "The assistant is temporarily unavailable. Please try again later.", response.status === 429 ? 429 : 503);
  try {
    const result = await response.json();
    const candidate = result.candidates?.[0];
    if (candidate?.finishReason && candidate.finishReason !== "STOP") throw new Error("Incomplete answer");
    const output = candidate?.content?.parts?.filter((part: { thought?: boolean }) => !part.thought).map((part: { text?: string }) => part.text || "").join("");
    return validatedAssistantAnswer(JSON.parse(output || ""), sources);
  } catch { throw new AssistantServiceError("The assistant couldn’t produce a complete answer. Try a shorter or more specific question.", 502); }
}
