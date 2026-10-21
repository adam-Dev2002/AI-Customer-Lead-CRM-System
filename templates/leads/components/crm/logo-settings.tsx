"use client";
import { ActionIcon } from "./action-icon";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import Image from "next/image";
import { ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { businessLogo, logoContentTypes, maximumLogoBytes } from "@/lib/crm/business-logo";
import { useCRM } from "./provider";
import { BrandLogo } from "./brand-logo";
import { Panel } from "./shared";

export function LogoSettings({ canManage }: { canManage: boolean }) {
  const { data, refresh, notify } = useCRM();
  const input = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState<{ file: File; preview: string } | null>(null);
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const custom = businessLogo(data.settings.businessLogo);
  useEffect(() => () => { if (selection) URL.revokeObjectURL(selection.preview); }, [selection]);
  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; setError("");
    if (!file) return;
    if (!logoContentTypes.some(type => type === file.type)) { setError("Choose a PNG, JPG or WebP image."); return; }
    if (file.size > maximumLogoBytes) { setError("Choose an image smaller than 2 MB."); return; }
    setSelection({ file, preview: URL.createObjectURL(file) });
  }
  async function save(restore = false) {
    if (!restore && !selection) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/crm/logo", restore ? { method: "DELETE" } : { method: "POST", headers: { "Content-Type": selection!.file.type }, body: selection!.file });
      if (response.status === 401) { window.location.replace("/login"); return; }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save your logo.");
      setSelection(null);
      await refresh();
      notify(restore ? "Default logo restored." : "Your business logo was saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save your logo."); }
    finally { setSaving(false); }
  }
  return <Panel title="Business logo" icon={ImageIcon} tone="violet">
    <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start">
      <div data-logo-preview className="flex size-24 shrink-0 items-center justify-center rounded-2xl border bg-white p-3 shadow-sm">
        {selection ? <Image src={selection.preview} alt="Selected business logo preview" width={72} height={72} unoptimized className="size-full object-contain" /> : <BrandLogo logo={custom} className="size-full rounded-none ring-0" />}
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div><h2 className="text-sm font-medium">Make this workspace yours</h2><p className="mt-1 text-xs leading-6 text-muted-foreground">Your logo appears in navigation, on the sign-in page and in the browser tab. PNG, JPG or WebP, up to 2 MB. A square image works best.</p></div>
        {canManage ? <>
          <input ref={input} type="file" accept={logoContentTypes.join(",")} aria-label="Upload business logo" className="sr-only" onChange={choose} disabled={saving} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={saving} onClick={() => input.current?.click()}><ActionIcon action="import" />{custom || selection ? "Change image" : "Choose image"}</Button>
            {selection ? <><Button type="button" disabled={saving} onClick={() => void save()}>{saving ? <ActionIcon action="loading" /> : <ActionIcon action="save" />}{saving ? "Saving logo…" : "Save logo"}</Button><Button type="button" variant="ghost" disabled={saving} onClick={() => { setSelection(null); setError(""); }}><ActionIcon action="cancel" />Cancel</Button></> : custom ? <Button type="button" variant="ghost" disabled={saving} onClick={() => void save(true)}>{saving ? <ActionIcon action="loading" /> : <ActionIcon action="reset" />}{saving ? "Restoring…" : "Restore default"}</Button> : null}
          </div>
          {selection && <p className="break-all text-xs text-muted-foreground">{selection.file.name} · Preview only until you choose Save logo.</p>}
        </> : <p className="text-xs text-muted-foreground">Ask a workspace owner to change the business logo.</p>}
        {error && <p role="alert" className="text-xs leading-6 text-destructive">{error}</p>}
      </div>
    </div>
  </Panel>;
}
