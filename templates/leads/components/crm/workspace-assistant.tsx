"use client";
import { ActionIcon } from "./action-icon";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Loader2, Sparkles } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { AssistantSource } from "@/lib/crm/assistant-context";

type Message = { role: "user" | "assistant"; text: string; sources?: AssistantSource[]; asOf?: string };
const suggestions = ["Which inquiries need attention?", "How do I send a reply?", "Why is my email queued?", "What’s on my task list?"];

export function WorkspaceAssistant() {
  const [open, setOpen] = useState(false), [question, setQuestion] = useState(""), [messages, setMessages] = useState<Message[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null), bottom = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "instant", block: "nearest" }); }, [messages, busy, error]);
  useEffect(() => () => controller.current?.abort(), []);
  async function ask(value: string) {
    if (!value.trim() || busy) return;
    setError(""); setQuestion(""); setBusy(true);
    const history = messages.slice(-6).map(item => ({ role: item.role, text: item.text }));
    setMessages(current => [...current, { role: "user", text: value.trim() }]);
    controller.current = new AbortController();
    try {
      const response = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: value.trim(), history }), signal: controller.current.signal });
      if (response.status === 401 || response.status === 403) { window.location.replace("/login"); return; }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not get an answer.");
      setMessages(current => [...current, { role: "assistant", text: result.answer, sources: result.sources, asOf: result.asOf }]);
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === "AbortError")) { setError(cause instanceof Error ? cause.message : "Could not get an answer."); setQuestion(value); }
    } finally { setBusy(false); input.current?.focus(); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void ask(question); }
  return <Sheet open={open} onOpenChange={setOpen}>
    <SheetTrigger asChild><Button className="fixed bottom-5 right-5 z-40 h-12 gap-2 rounded-full border border-white/15 bg-gradient-to-r from-[#6e3ff3] to-[#4258d9] px-5 text-white shadow-lg shadow-primary/20 transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/25 motion-reduce:transform-none"><ActionIcon action="assistant" />Ask assistant</Button></SheetTrigger>
    <SheetContent className="w-full gap-0 sm:w-[440px] sm:max-w-[440px]" aria-label="Workspace assistant">
      <SheetHeader className="border-b bg-gradient-to-r from-primary/10 to-blue-500/5 p-5 pr-12"><SheetTitle className="flex items-center gap-2"><span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Sparkles className="size-4" /></span>Ask assistant</SheetTitle><SheetDescription className="pt-1 text-xs leading-5">Questions about your records or how to use your workspace.</SheetDescription></SheetHeader>
      <div className="flex items-center justify-between border-b px-5 py-2.5"><span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="size-1.5 rounded-full bg-emerald-500" />Powered by Gemini</span><button type="button" disabled={busy || !messages.length} onClick={() => { controller.current?.abort(); setMessages([]); setError(""); setQuestion(""); input.current?.focus(); }} className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-primary disabled:opacity-40"><ActionIcon action="reset" />New chat</button></div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {!messages.length && <div className="pt-7"><h2 className="text-lg font-semibold tracking-tight">How can I help?</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Get a quick overview, find an inquiry, or ask what to do next.</p><div className="mt-6 grid gap-2.5">{suggestions.map(item => <button key={item} onClick={() => void ask(item)} className="crm-interactive flex items-center justify-between gap-4 rounded-xl border bg-card p-3.5 text-left text-sm">{item}<ActionIcon action="send" className="text-primary" /></button>)}</div></div>}
        <div role="log" aria-label="Assistant conversation" aria-live="polite" aria-relevant="additions" className="space-y-5">{messages.map((item, index) => <div key={index} className={item.role === "user" ? "ml-8 rounded-2xl rounded-br-sm bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground" : "mr-2 text-sm leading-6"}><span className="sr-only">{item.role === "user" ? "You: " : "Assistant: "}</span><p className="whitespace-pre-wrap break-words">{item.text}</p>{item.sources?.length ? <div className="mt-3 flex flex-wrap gap-1.5">{item.sources.map(source => <Link key={source.id} href={source.href} onClick={() => setOpen(false)} className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-[11px] leading-4 text-primary hover:bg-primary/10"><span className="truncate">{source.title}</span><ActionIcon action="view" /></Link>)}</div> : null}{item.asOf && <p className="mt-2 text-[10px] text-muted-foreground">Records checked {new Date(item.asOf).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>}</div>)}</div>
        {busy && <p role="status" className="mt-5 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Checking your workspace…</p>}
        {error && <p role="alert" className="mt-4 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}<div ref={bottom} />
      </div>
      <div className="border-t bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><form onSubmit={submit} className="flex items-end gap-2 rounded-xl border bg-background p-2 focus-within:ring-2 focus-within:ring-ring/30"><label htmlFor="assistant-question" className="sr-only">Ask a question</label><textarea ref={input} id="assistant-question" value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(question); } }} placeholder="Ask about your workspace…" maxLength={2000} rows={2} disabled={busy} className="max-h-32 min-h-12 w-full resize-none bg-transparent px-2 py-1 text-sm leading-6 outline-none placeholder:text-muted-foreground" /><Button type="submit" aria-label="Send question" size="icon" disabled={busy || !question.trim()} className="size-9 shrink-0 rounded-lg">{busy ? <ActionIcon action="loading" /> : <ActionIcon action="send" />}</Button></form><p className="mt-2.5 px-1 text-center text-[10px] leading-4 text-muted-foreground">Relevant records are shared with Gemini to answer. Check important details. This chat cannot send or change anything.</p></div>
    </SheetContent>
  </Sheet>;
}
