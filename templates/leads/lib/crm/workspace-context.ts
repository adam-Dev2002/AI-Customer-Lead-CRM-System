import { AsyncLocalStorage } from "node:async_hooks";

const activeWorkspace = new AsyncLocalStorage<string>();
const validWorkspace = /^(?:clearflow|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/;

/** Used by legacy maintenance adapters only. Request handlers must use workspaceId. */
export function currentWorkspaceId(): string | undefined {
  return activeWorkspace.getStore();
}

export function workspaceId(): string {
  const id = currentWorkspaceId();
  if (!id) throw new Error("An authorized workspace is required.");
  return id;
}

export async function withWorkspace<T>(id: string, work: () => Promise<T>): Promise<T> {
  if (!validWorkspace.test(id)) throw new Error("Invalid workspace identifier.");
  return activeWorkspace.run(id, work);
}
