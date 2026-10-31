"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  Loader2Icon,
  PlugIcon,
  PlusIcon,
  RefreshCwIcon,
  Settings2Icon,
  UnplugIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import type { MCPServer } from "@/lib/types";

const OPEN_CONNECTOR_MCP_NAME = "open-connector";
const OPEN_CONNECTOR_MCP_URL = "http://127.0.0.1:3000/mcp";
const OPEN_CONNECTOR_CONSOLE = "/open-connector/";
const OPEN_CONNECTOR_HEALTH = "/open-connector/health";
const OPEN_CONNECTOR_PROVIDERS = "/open-connector/v1/providers";

type Preset = {
  id: string;
  name: string;
  title: string;
  description: string;
  category: string;
  command: string;
  args: string[];
  envKeys: { key: string; label: string; placeholder?: string; secret?: boolean }[];
};

/** Direct MCP fallbacks (when you want a single app without OpenConnector). */
const DIRECT_PRESETS: Preset[] = [
  {
    id: "browser",
    name: "browser",
    title: "Playwright Browser",
    description: "Built-in headed Chrome via CDP (already used by Live Browser / chat).",
    category: "Direct MCP",
    command: "npx",
    args: ["-y", "@playwright/mcp", "--cdp-endpoint", "http://127.0.0.1:9222", "--caps", "vision"],
    envKeys: [],
  },
  {
    id: "filesystem",
    name: "filesystem",
    title: "Filesystem",
    description: "Read/write files under the workspace directory.",
    category: "Direct MCP",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/hgdfsjgfjf/ARTEX"],
    envKeys: [],
  },
];

function ConnectDialog({
  preset,
  existing,
  onClose,
  onDone,
}: {
  preset: Preset | null;
  existing?: MCPServer;
  onClose: () => void;
  onDone: () => void;
}) {
  const [env, setEnv] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!preset) return;
    const init: Record<string, string> = {};
    for (const k of preset.envKeys) init[k.key] = existing?.env?.[k.key] ?? "";
    setEnv(init);
  }, [preset, existing]);

  if (!preset) return null;

  async function connect() {
    if (!preset) return;
    const p = preset;
    setBusy(true);
    try {
      await api.saveMcpServer({
        id: existing?.id,
        name: p.name,
        transport: "stdio",
        command: p.command,
        args: p.args,
        env,
        enabled: true,
      });
      toast.success(`${p.title} connected`);
      onDone();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!preset} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {existing ? "Update" : "Connect"} {preset.title}
          </DialogTitle>
          <DialogDescription>{preset.description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-1">
          {preset.envKeys.length === 0 ? (
            <p className="text-muted-foreground text-sm">No secrets required — click Connect to add this MCP.</p>
          ) : (
            preset.envKeys.map((k) => (
              <div key={k.key} className="grid gap-1.5">
                <Label htmlFor={k.key}>{k.label}</Label>
                <Input
                  id={k.key}
                  type={k.secret ? "password" : "text"}
                  placeholder={k.placeholder}
                  value={env[k.key] ?? ""}
                  onChange={(e) => setEnv((m) => ({ ...m, [k.key]: e.target.value }))}
                />
              </div>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void connect()} disabled={busy}>
            {busy && <Loader2Icon className="animate-spin" />}
            {existing ? "Save" : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ConnectionsPage() {
  const [servers, setServers] = React.useState<MCPServer[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [connectorUp, setConnectorUp] = React.useState<boolean | null>(null);
  const [providerCount, setProviderCount] = React.useState<number | null>(null);
  const [actionCount, setActionCount] = React.useState<number | null>(null);
  const [attaching, setAttaching] = React.useState(false);
  const [runtimeToken, setRuntimeToken] = React.useState("");
  const [active, setActive] = React.useState<Preset | null>(null);

  const reload = React.useCallback(() => {
    setLoading(true);
    api
      .mcpServers()
      .then(setServers)
      .catch(() => toast.error("Failed to load MCP connections"))
      .finally(() => setLoading(false));
  }, []);

  const pingConnector = React.useCallback(async () => {
    try {
      const health = await fetch(OPEN_CONNECTOR_HEALTH, { cache: "no-store" });
      if (!health.ok) throw new Error(String(health.status));
      setConnectorUp(true);
      try {
        const res = await fetch(OPEN_CONNECTOR_PROVIDERS, { cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as { data?: unknown[] };
          const list = Array.isArray(body.data) ? body.data : [];
          setProviderCount(list.length);
          setActionCount(null);
        } else {
          setProviderCount(null);
          setActionCount(null);
        }
      } catch {
        setProviderCount(null);
        setActionCount(null);
      }
    } catch {
      setConnectorUp(false);
      setProviderCount(null);
      setActionCount(null);
    }
  }, []);

  React.useEffect(() => {
    reload();
    void pingConnector();
  }, [reload, pingConnector]);

  const byName = React.useMemo(() => {
    const m = new Map<string, MCPServer>();
    for (const s of servers) m.set(s.name, s);
    return m;
  }, [servers]);

  const openConnectorMcp = byName.get(OPEN_CONNECTOR_MCP_NAME);

  async function attachOpenConnector() {
    setAttaching(true);
    try {
      const env: Record<string, string> = {};
      if (runtimeToken.trim()) {
        env.Authorization = `Bearer ${runtimeToken.trim()}`;
      }
      await api.saveMcpServer({
        id: openConnectorMcp?.id,
        name: OPEN_CONNECTOR_MCP_NAME,
        transport: "http",
        url: OPEN_CONNECTOR_MCP_URL,
        command: "",
        args: [],
        env,
        enabled: true,
      });
      toast.success("Open Connector attached as MCP — agents can search_actions / execute_action");
      reload();
      try {
        const id = openConnectorMcp?.id;
        if (id) await api.refreshMcpServer(id);
      } catch {
        /* refresh optional until first use */
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAttaching(false);
    }
  }

  async function detachOpenConnector() {
    if (!openConnectorMcp) return;
    if (!window.confirm("Detach Open Connector MCP from ARTEX?")) return;
    try {
      await api.deleteMcpServer(openConnectorMcp.id);
      toast.success("Detached");
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4 md:gap-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Connections</h1>
          <p className="text-muted-foreground text-sm">
            Powered by{" "}
            <a
              href="https://github.com/oomol-lab/open-connector"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Open Connector
            </a>{" "}
            (open source) — connect Telegram, Gmail, Slack, GitHub and 1,000+ apps once, then use them from Workflows and Auto via MCP.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            reload();
            void pingConnector();
          }}
          disabled={loading}
        >
          <RefreshCwIcon className={loading ? "animate-spin" : undefined} />
          Refresh
        </Button>
      </div>

      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <PlugIcon className="size-4" /> Open Connector
            {connectorUp === true && (
              <Badge variant="secondary" className="gap-1 text-[10px]">
                <CheckCircle2Icon className="size-3 text-emerald-600" /> Online
              </Badge>
            )}
            {connectorUp === false && (
              <Badge variant="outline" className="text-destructive text-[10px]">
                Offline
              </Badge>
            )}
            {connectorUp === null && (
              <Badge variant="outline" className="text-[10px]">
                Checking…
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Self-hosted gateway from{" "}
            <span className="font-mono text-[11px]">oomol-lab/open-connector</span>
            {providerCount != null && actionCount != null
              ? ` · ${providerCount} providers · ${actionCount} actions`
              : ""}
            . Open the console to OAuth / API-key apps, then attach MCP so agents can call them.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {connectorUp === false && (
            <p className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
              Runtime not reachable on <span className="font-mono">:3000</span>. Start it:
              <code className="bg-muted mt-2 block rounded px-2 py-1 font-mono text-xs">
                bash scripts/start-open-connector.sh
              </code>
            </p>
          )}

          <div className="grid gap-1.5 sm:max-w-md">
            <Label htmlFor="runtime-token">Runtime token (optional)</Label>
            <Input
              id="runtime-token"
              type="password"
              placeholder="Paste OOMOL_CONNECT_RUNTIME_TOKEN if auth is enabled"
              value={runtimeToken}
              onChange={(e) => setRuntimeToken(e.target.value)}
            />
            <p className="text-muted-foreground text-[11px]">
              Stored as MCP <span className="font-mono">Authorization</span> header. Leave empty for open local runtimes.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm" disabled={connectorUp === false}>
              <a href={OPEN_CONNECTOR_CONSOLE} target="_blank" rel="noreferrer">
                <ExternalLinkIcon data-icon="inline-start" />
                Open console
              </a>
            </Button>
            <Button size="sm" onClick={() => void attachOpenConnector()} disabled={attaching || connectorUp === false}>
              {attaching ? <Loader2Icon className="animate-spin" /> : <PlusIcon data-icon="inline-start" />}
              {openConnectorMcp ? "Re-attach MCP" : "Attach as MCP"}
            </Button>
            {openConnectorMcp && (
              <Button size="sm" variant="ghost" onClick={() => void detachOpenConnector()}>
                <UnplugIcon data-icon="inline-start" />
                Detach
              </Button>
            )}
            <Button asChild size="sm" variant="ghost">
              <Link href="/system/mcp">Advanced MCP list</Link>
            </Button>
          </div>

          {openConnectorMcp && (
            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2Icon className="size-3" /> MCP linked
              </Badge>
              <span className="font-mono">
                {openConnectorMcp.transport} · {openConnectorMcp.url || OPEN_CONNECTOR_MCP_URL}
              </span>
              <span>Ask Auto: search_actions / execute_action (e.g. Telegram, Gmail)</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active MCP servers</CardTitle>
          <CardDescription>
            {servers.length === 0 ? "None yet" : `${servers.length} server(s) visible to agents`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {servers.length === 0 ? (
            <p className="text-muted-foreground text-sm">Attach Open Connector or a direct MCP below.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {servers.map((s) => (
                <Badge key={s.id} variant={s.enabled ? "secondary" : "outline"} className="gap-1">
                  {s.enabled ? <CheckCircle2Icon className="size-3 text-emerald-600" /> : null}
                  {s.name}
                  <span className="text-muted-foreground font-mono text-[9px]">{s.transport}</span>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">Direct MCP (optional)</h2>
        <p className="text-muted-foreground text-xs">
          Prefer Open Connector for SaaS apps. Use these only for local/browser extras.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {DIRECT_PRESETS.map((p) => {
            const existing = byName.get(p.name);
            return (
              <div key={p.id} className="flex flex-col gap-3 rounded-lg border p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">{p.title}</div>
                    <p className="text-muted-foreground mt-1 text-xs">{p.description}</p>
                  </div>
                  {existing ? (
                    <Badge variant="secondary" className="shrink-0 gap-1 text-[10px]">
                      <CheckCircle2Icon className="size-3" /> On
                    </Badge>
                  ) : null}
                </div>
                <Button size="sm" className="mt-auto" onClick={() => setActive(p)}>
                  {existing ? (
                    <>
                      <Settings2Icon data-icon="inline-start" /> Configure
                    </>
                  ) : (
                    <>
                      <PlusIcon data-icon="inline-start" /> Connect
                    </>
                  )}
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      <ConnectDialog
        preset={active}
        existing={active ? byName.get(active.name) : undefined}
        onClose={() => setActive(null)}
        onDone={reload}
      />
    </div>
  );
}
