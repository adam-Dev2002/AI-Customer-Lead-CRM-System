import { withWorkspace } from "@/lib/crm/workspace-context";
import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceAccess, sameOrigin } from "@/lib/auth/server";
import { consumeSharedLimit } from "@/lib/auth/rate-limit";
import { getSnapshot } from "@/lib/crm/storage";
import { buildAssistantContext } from "@/lib/crm/assistant-context";
import { askGemini, assistantConfiguration, AssistantServiceError, type AssistantHistory } from "@/lib/crm/assistant-gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function POST(request: NextRequest) {
  const access = await requireWorkspaceAccess();
  if (access.response) return access.response;
  return withWorkspace(access.user.workspaceId, async () => {
    if (!sameOrigin(request)) return reply({ error: "Please ask from your workspace." }, 403);
    try {
      const raw = await request.text();
      if (raw.length > 18000) return reply({ error: "Your message is too long." }, 413);
      let body;
      try { body = JSON.parse(raw); } catch { return reply({ error: "Enter a question to continue." }, 400); }
      if (typeof body?.question !== "string" || !body.question.trim() || body.question.length > 2000) return reply({ error: "Ask a question using 1 to 2,000 characters." }, 400);
      const history: AssistantHistory = Array.isArray(body.history) ? body.history.slice(-6).filter((item: unknown): item is { role: "user" | "assistant"; text: string } => !!item && typeof item === "object" && ["user", "assistant"].includes((item as {role: string}).role) && typeof (item as {text: unknown}).text === "string").map((item: { role: "user" | "assistant"; text: string }) => ({ role: item.role, text: item.text.slice(0, 1500) })) : [];
      if (!(await consumeSharedLimit(`assistant:${access.user.id}`, 12, 60_000)) || !(await consumeSharedLimit("assistant:workspace", 100, 60 * 60_000))) return reply({ error: "You’ve reached the assistant’s message limit. Please try again later." }, 429);
      const config = await assistantConfiguration();
      if (!config) return reply({ error: "The assistant is not connected yet. Please contact your workspace administrator." }, 503);
      const data = await getSnapshot();
      const { context, sources } = buildAssistantContext(data, [...history.filter(item => item.role === "user").slice(-2).map(item => item.text), body.question].join("\n"));
      const result = await askGemini(config, context, sources, body.question.trim(), history);
      return reply({ ...result, asOf: context.asOf });
    } catch (error) {
      return reply({ error: error instanceof AssistantServiceError ? error.message : "The assistant could not answer right now. Please try again." }, error instanceof AssistantServiceError ? error.status : 503);
    }
  });
}
