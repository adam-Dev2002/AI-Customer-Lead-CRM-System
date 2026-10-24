"use client";
import { ActionIcon } from "./action-icon";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import type { CRMSnapshot } from "@/lib/crm/types";
import { Button } from "@/components/ui/button";
import { savedContactPhotos } from "@/lib/crm/contact-photos";

type Context = {
  data: CRMSnapshot;
  contactPhotos: Record<string, string>;
  busy: boolean;
  run: (
    action: string,
    payload?: Record<string, unknown>,
    success?: string,
  ) => Promise<boolean>;
  refresh: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
};
const CRMContext = createContext<Context | null>(null);
export function CRMProvider({ children, initialData = null }: { children: ReactNode; initialData?: CRMSnapshot | null }) {
  const [data, setData] = useState<CRMSnapshot | null>(initialData),
    [busy, setBusy] = useState(false);
  const refreshPending = useRef<Promise<void> | null>(null);
  const readVersion = useRef(0), writesPending = useRef(0);
  const [loadError, setLoadError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [googlePhotos, setGooglePhotos] = useState<Record<string, string>>({});
  const contactKey = useMemo(() => [...new Set([...(data?.leads.map(lead => lead.email.trim().toLowerCase()) || []), data?.settings.ownerEmail || ""])].sort().join("\n"), [data?.leads, data?.settings.ownerEmail]);
  const contactPhotos = useMemo(() => ({ ...googlePhotos, ...savedContactPhotos(data?.leads || []) }), [data?.leads, googlePhotos]);
  useEffect(() => {
    if (!contactKey) return;
    const controller = new AbortController();
    let pending = false, loadedAt = -Infinity;
    const loadPhotos = async () => {
      if (pending || Date.now() - loadedAt < 600000) return;
      pending = true;
      try {
        const response = await fetch("/api/crm/contact-photos", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const result = await response.json();
        if (!controller.signal.aborted && result.photos && typeof result.photos === "object" && !Array.isArray(result.photos)) {
          setGooglePhotos(result.photos);
          loadedAt = Date.now();
        }
      } catch { /* Photos never prevent the inbox from loading. */ }
      finally { pending = false; }
    };
    void loadPhotos();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void loadPhotos(); }, 600000);
    window.addEventListener("focus", loadPhotos);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener("focus", loadPhotos); };
  }, [contactKey]);
  const [notice, setNotice] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const activeDelivery = data?.mailJobs.some(
    (job) => job.status === "Queued" || job.status === "Sending",
  ) ?? false;
  const activeInbox = data?.inboxScan?.phase === 'checking' || data?.inboxScan?.phase === 'processing';
  const notify = useCallback(
    (message: string, error = false) => setNotice({ message, error }),
    [],
  );
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), notice.error ? 9000 : 4500);
    return () => clearTimeout(t);
  }, [notice]);
  const refresh = useCallback(async () => {
    if (writesPending.current) return;
    if (refreshPending.current) return refreshPending.current;
    const version = readVersion.current;
    const pending = (async () => { try {
      const response = await fetch("/api/crm", { cache: "no-store" });
      if (version !== readVersion.current) return;
      if (response.status === 401 || response.status === 403) {
        setData(null); setGooglePhotos({});
        window.location.replace("/login"); return;
      }
      const body = await response.json();
      if (version !== readVersion.current) return;
      if (!response.ok)
        throw new Error(body.error || "Could not load workspace.");
      setData(body);
      setLoadError("");
    } catch (error) {
      if (version === readVersion.current) setLoadError((error as Error).message);
    } })();
    refreshPending.current = pending;
    try { await pending; }
    finally { if (refreshPending.current === pending) refreshPending.current = null; }
  }, []);
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, activeDelivery || activeInbox ? 3000 : 15000);
    return () => clearInterval(interval);
  }, [refresh, activeDelivery, activeInbox]);
  const run = useCallback(
    async (
      action: string,
      payload: Record<string, unknown> = {},
      success = "Changes saved.",
    ) => {
      readVersion.current++;
      writesPending.current++;
      setBusy(true);
      try {
        const response = await fetch("/api/crm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, payload }),
        });
        const body = await response.json();
        if (response.status === 401 || response.status === 403) {
          setData(null); setGooglePhotos({});
          window.location.replace("/login"); return false;
        }
        if (!response.ok)
          throw new Error(body.error || "Could not save changes.");
        setData(body);
        notify(success);
        return true;
      } catch (error) {
        notify((error as Error).message, true);
        return false;
      } finally {
        writesPending.current--;
        setBusy(writesPending.current > 0);
      }
    },
    [notify],
  );
  if (!data)
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        {loadError ? (
          <>
            <AlertCircle className="size-8 text-destructive" />
            <h1 className="font-semibold">Unable to open your workspace</h1>
            <p className="max-w-md text-sm text-muted-foreground">
              {loadError}
            </p>
            <Button onClick={() => void refresh()}><ActionIcon action="retry" />Try again</Button>
          </>
        ) : (
          <>
            <Loader2 className="size-7 animate-spin text-[#6e3ff3]" />
            <p className="text-sm text-muted-foreground">
              Opening your workspace…
            </p>
          </>
        )}
      </div>
    );
  return (
    <CRMContext.Provider value={{ data, contactPhotos, busy, run, refresh, notify }}>
      {loadError && (
        <div
          role="alert"
          className="bg-destructive p-2 text-center text-sm text-white"
        >
          {loadError}{" "}
          <button className="inline-flex items-center gap-1.5 underline" onClick={() => void refresh()}>
            <ActionIcon action="retry" />
            Retry
          </button>
        </div>
      )}
      {/* Show server-rendered content immediately; enable controls once their
          handlers are attached so early typing cannot be lost during hydration. */}
      <div className="contents" inert={!hydrated} aria-busy={!hydrated} data-crm-ready={hydrated}>
        {children}
      </div>
      {notice && (
        <div
          role={notice.error ? "alert" : "status"}
          className="fixed bottom-24 right-5 z-[100] flex max-w-[calc(100vw-2.5rem)] items-start gap-3 rounded-lg border bg-card px-4 py-3 shadow-lg sm:max-w-md"
        >
          {notice.error ? (
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          ) : (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          )}
          <p className="text-sm">{notice.message}</p>
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice(null)}
          >
            <ActionIcon action="cancel" className="text-muted-foreground" />
          </button>
        </div>
      )}
    </CRMContext.Provider>
  );
}
export function useCRM() {
  const context = useContext(CRMContext);
  if (!context) throw new Error("CRMProvider is required.");
  return context;
}
