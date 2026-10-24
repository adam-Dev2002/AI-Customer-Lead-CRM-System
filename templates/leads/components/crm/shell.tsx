"use client";
import { ActionIcon } from "./action-icon";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGrid, ChartArea, Mail, CalendarDays, ListTodo, Users, History, Settings, HelpCircle, ChevronRight, Bell, Search, Command, Loader2, BookOpen, Plug } from "lucide-react";
import {
  Sidebar,
  SidebarProvider,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/theme-toggle";
import { useCRM } from "./provider";
import { PersonAvatar } from "./shared";
import { activityAppearance } from "@/lib/crm/activity-appearance";
import { ActivityMark, activityColors } from "./activity-mark";
import { BrandLogo } from "./brand-logo";
import { WorkspaceAssistant } from "./workspace-assistant";
import { WorkspaceBranding } from "./workspace-branding";
import { inboxScanView } from '@/lib/crm/inbox-scan';
type SignedInUser = { id: string; email: string; name: string; role: string };
const menu = [
  { title: "Dashboard", href: "/", icon: LayoutGrid, tone: "violet" },
  { title: "Leads", href: "/leads", icon: ChartArea, tone: "blue" },
  { title: "Inbox", href: "/inbox", icon: Mail, tone: "blue" },
  { title: "Follow-ups", href: "/follow-ups", icon: History, tone: "amber" },
  { title: "Calendar", href: "/calendar", icon: CalendarDays, tone: "violet" },
  { title: "Tasks", href: "/tasks", icon: ListTodo, tone: "emerald" },
  { title: "Contacts", href: "/contacts", icon: Users, tone: "blue" },
  { title: "Activity", href: "/activity", icon: History, tone: "neutral" },
  { title: "Connections", href: "/connections", icon: Plug, tone: "blue" },
  { title: "How it works", href: "/automation", icon: BookOpen, tone: "violet" },
];
function Navigation({ signedInUser }: { signedInUser: SignedInUser }) {
  const { data } = useCRM(),
    path = usePathname(),
    { setOpenMobile } = useSidebar();
  const pending = data.drafts.filter(
    (d) => d.status === "Pending review",
  ).length;
  const inbox = inboxScanView(data.inboxScan);
  return (
    <Sidebar collapsible="offcanvas" className="lg:border-r-0!">
      <SidebarHeader className="p-4 pb-3 lg:p-5 lg:pb-4">
        <Link
          href="/settings"
          aria-label={`Workspace settings for ${data.settings.businessName}`}
          onClick={() => setOpenMobile(false)}
          className="group flex min-w-0 items-center gap-3 rounded-lg p-2 transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BrandLogo logo={data.settings.businessLogo} generic={data.settings.brandPreset === "generic"} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">
              {data.settings.businessName}
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
              Support & leads
            </span>
          </span>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60 group-hover:text-muted-foreground" />
        </Link>
      </SidebarHeader>
      <SidebarContent className="px-4 lg:px-5">
        <SidebarMenu>
          {menu.map((item) => {
            const active =
              path === item.href ||
              (item.href !== "/" && path.startsWith(item.href + "/"));
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  className="crm-nav-link h-[38px]"
                  data-tone={item.tone}
                >
                  <Link
                    href={item.href}
                    onClick={() => setOpenMobile(false)}
                    aria-current={active ? "page" : undefined}
                  >
                    <item.icon className="crm-nav-icon text-muted-foreground" />
                    <span>{item.title}</span>
                    {item.href === "/inbox" && pending > 0 && (
                      <span title="Replies awaiting review" className="ml-auto rounded bg-violet-100 px-1.5 text-[10px] text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                        {pending}
                      </span>
                    )}
                    {active && (
                      <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />
                    )}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter className="gap-3 px-4 pb-4 lg:px-5 lg:pb-5">
        <SidebarMenu>
          {[
            { title: "Help & FAQs", href: "/help", icon: HelpCircle },
            { title: "Settings", href: "/settings", icon: Settings },
          ].map((i) => (
            <SidebarMenuItem key={i.href}>
              <SidebarMenuButton asChild isActive={path === i.href} className="crm-nav-link">
                <Link href={i.href} aria-current={path === i.href ? "page" : undefined} onClick={() => setOpenMobile(false)}>
                  <i.icon className="text-muted-foreground" />
                  <span>{i.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
        <Link
          href="/inbox"
          onClick={() => setOpenMobile(false)}
          className="crm-interactive rounded-lg border bg-background p-3"
        >
          <span className="flex items-center gap-2 text-xs font-medium">
            <span className={`size-1.5 rounded-full ${inbox.state === 'complete' ? 'bg-emerald-500' : inbox.state === 'running' ? 'bg-primary' : 'bg-amber-500'}`} />
            Workspace status
            <ChevronRight className="ml-auto size-3" />
          </span>
          <span className="mt-1.5 block text-[11px] text-muted-foreground">
            {inbox.title}
          </span>
        </Link>
        <div className="flex items-center gap-3 px-1">
          <PersonAvatar name={signedInUser.name} email={signedInUser.email} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">
              {signedInUser.name}
            </span>
            <span className="block truncate text-[10px] text-muted-foreground">
              {signedInUser.email}
            </span>
          </span>
          <SignOut />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
function Header() {
  const { data, run } = useCRM(),
    path = usePathname(),
    router = useRouter();
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const unread = data.activities.filter(
    (a) => a.createdAt > data.notificationsReadAt,
  ).length;
  const current =
    menu.find((m) => m.href !== "/" && path.startsWith(m.href)) ||
    (path === "/"
      ? menu[0]
      : {
          title: path === "/settings" ? "Settings" : "Help & FAQs",
          icon: path === "/settings" ? Settings : HelpCircle,
        });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return (
    <header className="sticky top-0 z-20 flex min-h-[69px] shrink-0 items-center gap-3 border-b bg-card px-3 py-3 sm:px-6 sm:py-4">
      <SidebarTrigger className="-ml-1" />
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <current.icon className="hidden size-5 text-primary sm:block" />
        <span className="truncate text-base font-semibold">
          {current.title}
        </span>
      </div>
      <form
        className="relative hidden md:block"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/leads?q=${encodeURIComponent(query)}`);
        }}
      >
        <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Input
          ref={search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search leads…"
          aria-label="Search leads"
          className="h-9 w-[190px] bg-card pl-9 pr-12 lg:w-[220px]"
        />
        <kbd className="pointer-events-none absolute right-2 top-2 flex items-center rounded bg-muted px-1 text-[10px] text-muted-foreground">
          <Command className="size-3" />K
        </kbd>
      </form>
      <Button
        asChild
        variant="outline"
        className="hidden gap-2 text-xs lg:flex"
      >
        <Link href="/settings#integrations">
          <ActionIcon action="settings" />
          <span className="size-1.5 rounded-full bg-amber-500" />
          Workspace status
        </Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="relative"
            aria-label="Notifications"
          >
            <Bell className="size-4" />
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 rounded-full bg-rose-500 px-1 text-[9px] leading-4 text-white">
                {Math.min(99, unread)}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[min(90vw,360px)]">
          <DropdownMenuLabel className="flex items-center justify-between">
            Recent activity
            <button
              className="inline-flex items-center gap-1.5 text-xs font-normal text-muted-foreground underline"
              onClick={() =>
                void run("activity.read", {}, "Notifications marked as read.")
              }
            >
              <ActionIcon action="approve" />
              Mark as read
            </button>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {data.activities.slice(0, 5).map(a => ({ ...a, ...activityAppearance(a) })).map((a) => (
            <DropdownMenuItem key={a.id} asChild>
              <Link
                href={a.leadId ? `/leads/${a.leadId}` : "/activity"}
                data-activity-tone={a.tone}
                className="flex! items-start gap-2.5 py-3"
              >
                <ActivityMark type={a.type} tone={a.tone} className="size-7 [&>svg]:size-3.5" />
                <span className="min-w-0 flex-1">
                  <span className={`block text-xs font-medium ${activityColors[a.tone].text}`}>{a.title}</span>
                  <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                    {a.detail || new Date(a.createdAt).toLocaleDateString()}
                  </span>
                </span>
              </Link>
            </DropdownMenuItem>
          ))}
          {!data.activities.length && (
            <p className="p-4 text-xs text-muted-foreground">
              You&apos;re all caught up.
            </p>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/activity" className="justify-center text-xs">
              <ActionIcon action="view" />
              View all activity
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ThemeToggle />
    </header>
  );
}
function SignOut() {
  const [busy, setBusy] = useState(false);
  const { notify } = useCRM();
  return <Button variant="ghost" size="icon" aria-label="Sign out" title="Sign out" disabled={busy} onClick={async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout" }) });
      if (!response.ok) throw new Error("Could not sign out. Please try again.");
      const channel = new BroadcastChannel("crm-session"); channel.postMessage("signed-out"); channel.close();
      window.location.replace("/login");
    } catch { notify("Could not sign out. Please try again.", true); setBusy(false); }
  }}>{busy ? <ActionIcon action="loading" /> : <ActionIcon action="signOut" className="text-muted-foreground" />}</Button>;
}
export function CRMShell({ children, signedInUser }: { children: ReactNode; signedInUser: SignedInUser }) {
  useEffect(() => {
    const channel = new BroadcastChannel("crm-session");
    channel.onmessage = event => { if (event.data === "signed-out") window.location.replace("/login"); };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener("pageshow", restore);
    return () => { channel.close(); window.removeEventListener("pageshow", restore); };
  }, []);
  return (
    <SidebarProvider className="bg-sidebar">
      <WorkspaceBranding />
      <Navigation signedInUser={signedInUser} />
      <div className="h-svh min-w-0 flex-1 overflow-hidden lg:p-2">
        <div className="flex h-full w-full flex-col overflow-hidden bg-background lg:rounded-md lg:border">
          <Header />
          <main
            id="main-content"
            className="crm-main min-h-0 flex-1 overflow-auto p-4 pb-24 sm:p-6 sm:pb-24"
          >
            <Suspense
              fallback={
                <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading page…
                </div>
              }
            >
              {children}
            </Suspense>
          </main>
        </div>
      </div>
      <WorkspaceAssistant key={signedInUser.id} />
    </SidebarProvider>
  );
}
