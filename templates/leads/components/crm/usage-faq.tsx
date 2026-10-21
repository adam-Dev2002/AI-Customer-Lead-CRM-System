"use client";
import Link from "next/link";
import { ChevronDown, CircleHelp } from "lucide-react";
import { useCRM } from "./provider";
import { Panel } from "./shared";
import { inboxHref } from "@/lib/crm/inbox-navigation";

export function UsageFaq() {
  const { data } = useCRM();
  const questions = [
    { question: "Where do new customer messages appear?", answer: <>Open <Link href="/inbox">Inbox</Link> to read incoming emails and form inquiries. Each inquiry also appears in Leads. Email checks run regularly, so a new message can take a few minutes to appear.</> },
    { question: "How do I review and send a reply?", answer: <>Open <Link href={inboxHref("replies")}>Inbox → AI replies</Link>, read the original inquiry, and edit the suggested reply. Save your edits, choose Approve reply, then choose Send via Gmail and confirm the recipient and message. Approving a reply records your review; it does not send the email.</> },
    { question: "Why does a reply say Queued?", answer: <>Your reply is waiting for saved changes to finish and the sending service to pick it up. Follow the progress in Inbox → Outgoing emails. Sent appears only after Gmail confirms the send. If the result needs review, check Gmail Sent before trying again.</> },
    { question: "Why do some inquiries have no AI reply?", answer: <>Some messages do not need a reply, are unrelated to your business, or do not contain enough readable information. AI suggestions can also be turned off in Settings. You can still open the inquiry in Inbox and choose Create reply draft to write your own response.</> },
    { question: "When does a customer receive a follow-up?", answer: <>A customer can receive one follow-up after you save and approve its email, record their permission and choose a schedule. The inquiry must still qualify and your email preferences must allow sending. Your default delay is {data.settings.followUpHours} hours. Preview, edit and manage everything in <Link href="/follow-ups">Follow-ups</Link>.</> },
    { question: "How do I change my business details or reply style?", answer: <>Open <Link href="/settings">Settings</Link> to update business details, approved facts, reply tone, signature and automatic actions. Choose Save settings to keep your changes. Changing business details does not change the connected Gmail sending account.</> },
  ];
  return (
    <section id="faq" className="scroll-mt-5">
      <Panel title="Common questions" icon={CircleHelp} tone="blue">
        <div className="space-y-2.5 p-4 sm:p-5">
          {questions.map(item => (
            <details key={item.question} className="crm-faq overflow-hidden rounded-lg border bg-card">
              <summary className="flex items-center justify-between gap-4 px-4 py-4 text-sm font-medium">
                {item.question}
                <ChevronDown className="crm-faq-chevron size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </summary>
              <div className="px-4 pb-4 pt-1 text-sm leading-7 text-muted-foreground [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4">{item.answer}</div>
            </details>
          ))}
        </div>
      </Panel>
    </section>
  );
}
