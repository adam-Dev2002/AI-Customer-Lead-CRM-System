import { cache } from "react";
import { getSnapshot } from "./storage";

// React's cache is scoped to one server render; edits are never cached across requests.
export const workspaceSnapshot = cache(getSnapshot);
