export default function LoadingWorkspacePage() {
  return (
    <div role="status" aria-label="Loading page" className="space-y-6 motion-safe:animate-pulse">
      <span className="sr-only">Loading page…</span>
      <div className="h-7 w-48 rounded bg-muted" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {[0, 1, 2].map(item => <div key={item} className="h-28 rounded-xl border bg-card" />)}
      </div>
      <div className="space-y-5 rounded-xl border bg-card p-5">
        {[0, 1, 2, 3, 4].map(item => <div key={item} className="h-10 rounded bg-muted/60" />)}
      </div>
    </div>
  );
}
