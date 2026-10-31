"use client";

import * as React from "react";

import { api } from "@/lib/api";
import type { Agent } from "@/lib/types";

/** Stable fingerprint so polls only re-render when the agent list actually changes. */
function agentsFingerprint(agents: Agent[]): string {
  return agents
    .map(
      (a) =>
        [
          a.key,
          a.name,
          a.description ?? "",
          a.builtin ? 1 : 0,
          a.enabled ? 1 : 0,
          a.role ?? "",
          a.mcp_count ?? 0,
          a.skill_count ?? 0,
          a.tool_count ?? 0,
        ].join("\t"),
    )
    .join("\n");
}

/**
 * Live agent catalog: initial fetch + light polling so create/update/delete
 * (UI or Auto chat tools) appear without a full page refresh.
 */
export function useLiveAgents(pollMs = 2000): {
  agents: Agent[];
  reload: () => Promise<void>;
} {
  const [agents, setAgents] = React.useState<Agent[]>([]);
  const fpRef = React.useRef("");
  const seqRef = React.useRef(0);

  const reload = React.useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const next = await api.agents();
      if (seq !== seqRef.current) return;
      const fp = agentsFingerprint(next);
      if (fp === fpRef.current) return;
      fpRef.current = fp;
      setAgents(next);
    } catch {
      // Keep the last good list on a transient failure.
    }
  }, []);

  React.useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      await reload();
      if (!disposed) timer = setTimeout(() => void poll(), pollMs);
    }
    void poll();
    return () => {
      disposed = true;
      seqRef.current++;
      clearTimeout(timer);
    };
  }, [reload, pollMs]);

  // Refresh immediately when the tab becomes visible again (e.g. after Auto
  // created an agent in another tab / focus returns).
  React.useEffect(() => {
    function onVis() {
      if (document.visibilityState === "visible") void reload();
    }
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [reload]);

  return { agents, reload };
}
