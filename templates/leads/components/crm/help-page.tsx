"use client";
import { ActionIcon } from "./action-icon";
import Link from "next/link";
import { Inbox, Sparkles, Clock3, CheckCircle2 } from "lucide-react";
import { PageHeading, Panel } from "./shared";
import { UsageFaq } from "./usage-faq";
import { inboxHref } from "@/lib/crm/inbox-navigation";

export function HelpPage() {
  const steps = [
    { title: "A customer gets in touch", detail: "A form or email inquiry becomes a lead. Open it to see the customer's details, request and priority.", icon: Inbox, href: "/inbox" },
    { title: "You review the suggested reply", detail: "Open the AI replies tab in Inbox for suggested and manually written replies. Read the original message, edit the reply and approve it. Then confirm sending when you are ready.", icon: Sparkles, href: inboxHref("replies") },
    { title: "You keep the lead up to date", detail: "Assign an owner, add notes and update the status as the inquiry moves forward. Create tasks when you need a reminder.", icon: CheckCircle2, href: "/leads" },
    { title: "Review and approve a follow-up", detail: "Open Follow-ups to record permission, choose a time, edit the email and approve it. Cancel or withdraw approval before sending begins.", icon: Clock3, href: "/follow-ups" },
  ];
  return <div className="mx-auto max-w-4xl space-y-6">
    <PageHeading title="Your dashboard, explained" description="Manage customer inquiries and replies without handling the technical setup." />
    <Panel title="The customer journey" icon={Inbox} tone="blue">
      <div className="divide-y">{steps.map((step, index) => <Link key={step.title} href={step.href} className="crm-interactive flex items-start gap-4 p-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background"><step.icon className="size-4 text-[#6e3ff3]" /></span>
        <div><h3 className="text-sm font-semibold">{index + 1}. {step.title}</h3><p className="mt-2 text-sm leading-7 text-muted-foreground">{step.detail}</p></div>
        <ActionIcon action="view" className="ml-auto mt-1 text-muted-foreground" />
      </Link>)}</div>
    </Panel>
    <section id="local" className="scroll-mt-5"><Panel title="Your everyday controls">
      <div className="space-y-4 p-5 text-sm leading-7 text-muted-foreground">
        <p>Use Leads to manage customer details and Inbox to switch between incoming inquiries, AI replies and outgoing emails. Use Tasks and Calendar to organise your work.</p>
        <p>Your changes save in the dashboard first. How it works shows whether each change is still updating, saved, or needs attention. Retrying a saved change does not resend an email.</p>
        <Link href="/automation#coverage" className="inline-flex items-center gap-2 font-medium text-primary hover:underline">Explore your dashboard tools<ActionIcon action="view" /></Link>
      </div>
    </Panel></section>
    <Panel title="Why some emails have no suggested reply">
      <div className="space-y-4 p-5 text-sm leading-7 text-muted-foreground">
        <p>Automatic notifications, unrelated messages, excluded senders and messages without readable text may be skipped. Activity explains why. A draft is prepared only when a reply is needed and a suitable response is available.</p>
        <p>You can write a reply yourself: open the inquiry in Inbox and choose Create reply draft. Approving a reply records your review; sending always needs a separate confirmation.</p>
        <p>After you confirm sending, the progress display shows Queued, Synced, Sending and Sent. Sent appears when Gmail confirms the send. If delivery is uncertain, check Gmail Sent before trying again.</p>
      </div>
    </Panel>
    <section id="automation" className="scroll-mt-5"><Panel title="Follow-ups and business preferences">
      <div className="space-y-4 p-5 text-sm leading-7 text-muted-foreground">
        <p>Follow-ups need the customer's permission, an open inquiry and a due time that has been reached. They also depend on your automatic email preferences. Inquiries marked Contacted or Closed stop qualifying for a pending follow-up.</p>
        <p>A follow-up being prepared is already in progress. Wait for its result before trying again. If its result needs review, check whether the email was sent first.</p>
        <p>In Settings, keep your business facts accurate, choose the reply style and signature, and decide which automatic confirmations, alerts and follow-ups you want.</p>
        <Link href="/settings" className="inline-flex items-center gap-2 font-medium text-foreground"><ActionIcon action="settings" />Open business preferences</Link>
      </div>
    </Panel></section>
    <UsageFaq />
  </div>;
}
