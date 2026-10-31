"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Link2Icon, Loader2Icon, PlusIcon, SearchIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";

const OC_PUBLIC = "https://sheer-intl-van-floors.trycloudflare.com";
const OC_API = "/oc-api";
const OC_MCP_NAME = "open-connector";
const OC_MCP_URL = "http://127.0.0.1:3000/mcp";

const POPULAR = [
  "github",
  "gmail",
  "slack",
  "notion",
  "telegram",
  "discord",
  "openai",
  "stripe",
  "hubspot",
  "jira",
  "shopify",
  "google_sheets",
  "airtable",
  "asana",
  "dropbox",
  "linkedin",
  "whatsapp",
  "twitter",
  "figma",
  "linear",
  "gitlab",
  "bitbucket",
  "zoom",
  "calendar",
  "drive",
  "sheets",
  "docs",
  "trello",
  "intercom",
  "zendesk",
  "salesforce",
  "pipedrive",
  "clickup",
];

type OcProvider = {
  service: string;
  displayName: string;
  categories?: unknown;
  authTypes?: string[];
  homepageUrl?: string | null;
  iconUrl?: string | null;
};

type OcConnection = {
  service: string;
  configured?: boolean;
  authType?: string;
  connectionName?: string;
};

function hostFromUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function providerIcon(p: OcProvider): string {
  if (p.iconUrl) return p.iconUrl;
  const host = hostFromUrl(p.homepageUrl) || `${p.service.replace(/_/g, "")}.com`;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
}

function providerSubtitle(p: OcProvider): string {
  const host = hostFromUrl(p.homepageUrl);
  if (host) return host;
  return `${p.service}.open-connector`;
}

async function ocGet<T>(path: string): Promise<T> {
  const res = await fetch(`${OC_API}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

async function ocPut(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${OC_API}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.text()) || `${path} → ${res.status}`);
}

function PluginIcon({ provider, className }: { provider: OcProvider; className?: string }) {
  const [broken, setBroken] = React.useState(false);
  const letter = (provider.displayName || provider.service || "?").charAt(0).toUpperCase();
  if (broken) {
    return (
      <div
        className={cn(
          "bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold",
          className,
        )}
      >
        {letter}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={providerIcon(provider)}
      alt=""
      className={cn("bg-background size-10 shrink-0 rounded-xl border object-contain p-1.5", className)}
      onError={() => setBroken(true)}
    />
  );
}

function ConnectKeyDialog({
  provider,
  onClose,
  onDone,
}: {
  provider: OcProvider | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [key, setKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  if (!provider) return null;

  async function save() {
    const p = provider;
    if (!p) return;
    setBusy(true);
    try {
      await ocPut(`/api/connections/${encodeURIComponent(p.service)}`, {
        authType: "api_key",
        values: { apiKey: key.trim() },
      });
      toast.success(`${p.displayName} connected`);
      onDone();
      onClose();
      setKey("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!provider} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <PluginIcon provider={provider} />
            Connect {provider.displayName}
          </DialogTitle>
          <DialogDescription>
            Paste an API key / token. For OAuth, use the provider console page instead.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="oc-key">API key / token</Label>
          <Input
            id="oc-key"
            type="password"
            placeholder="paste key…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !key.trim()}>
            {busy && <Loader2Icon className="animate-spin" />}
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ConnectionsPage() {
  const [servers, setServers] = React.useState<MCPServer[]>([]);
  const [ocUp, setOcUp] = React.useState<boolean | null>(null);
  const [providers, setProviders] = React.useState<OcProvider[]>([]);
  const [connections, setConnections] = React.useState<OcConnection[]>([]);
  const [q, setQ] = React.useState("");
  const [tab, setTab] = React.useState<"popular" | "all">("popular");
  const [busyMcp, setBusyMcp] = React.useState(false);
  const [keyProvider, setKeyProvider] = React.useState<OcProvider | null>(null);
  const [loading, setLoading] = React.useState(true);

  const reload = React.useCallback(async () => {
    setLoading(true);
    try {
      const mcpPromise = api.mcpServers().catch(() => [] as MCPServer[]);
      try {
        await ocGet("/health");
        setOcUp(true);
        const [plist, clist] = await Promise.all([
          ocGet<OcProvider[]>("/api/providers"),
          ocGet<OcConnection[]>("/api/connections"),
        ]);
        setProviders(Array.isArray(plist) ? plist : []);
        setConnections(Array.isArray(clist) ? clist : []);
      } catch {
        setOcUp(false);
        setProviders([]);
        setConnections([]);
      }
      setServers(await mcpPromise);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const connectedMap = React.useMemo(() => {
    const m = new Map<string, OcConnection>();
    for (const c of connections) {
      if (c.configured === false) continue;
      m.set(c.service, c);
    }
    return m;
  }, [connections]);

  const byService = React.useMemo(() => {
    const m = new Map<string, OcProvider>();
    for (const p of providers) m.set(p.service, p);
    return m;
  }, [providers]);

  const yourConnections = React.useMemo(() => {
    const out: OcProvider[] = [];
    for (const service of connectedMap.keys()) {
      const p = byService.get(service);
      if (p) out.push(p);
      else out.push({ service, displayName: service, authTypes: [] });
    }
    return out;
  }, [connectedMap, byService]);

  const popularProviders = React.useMemo(() => {
    const list: OcProvider[] = [];
    for (const id of POPULAR) {
      const p = byService.get(id);
      if (p) list.push(p);
    }
    // fill if some missing names differ
    if (list.length < 12) {
      for (const p of providers) {
        if (list.some((x) => x.service === p.service)) continue;
        list.push(p);
        if (list.length >= 33) break;
      }
    }
    return list;
  }, [byService, providers]);

  const visible = React.useMemo(() => {
    const query = q.trim().toLowerCase();
    let base = tab === "popular" ? popularProviders : providers;
    if (query) {
      base = providers.filter(
        (p) =>
          p.service.toLowerCase().includes(query) ||
          p.displayName.toLowerCase().includes(query),
      );
    }
    return base.slice(0, tab === "all" && !query ? 121 : query ? 80 : 36);
  }, [q, tab, popularProviders, providers]);

  const ocMcp = servers.find((s) => s.name === OC_MCP_NAME);

  async function ensureMcp() {
    if (ocMcp?.enabled) return;
    setBusyMcp(true);
    try {
      await api.saveMcpServer({
        id: ocMcp?.id,
        name: OC_MCP_NAME,
        transport: "http",
        url: OC_MCP_URL,
        command: "",
        args: [],
        env: {},
        enabled: true,
      });
      toast.success("Open Connector MCP ready for agents");
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyMcp(false);
    }
  }

  function connectProvider(p: OcProvider) {
    void ensureMcp();
    if ((p.authTypes || []).includes("api_key")) {
      setKeyProvider(p);
      return;
    }
    window.open(`${OC_PUBLIC}/providers/${encodeURIComponent(p.service)}`, "_blank", "noreferrer");
  }

  return (
    <div className="bg-background flex flex-1 flex-col gap-6 p-1 md:p-2">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <p className="text-muted-foreground text-sm">Connect the tools your agents can use on your behalf.</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <SearchIcon className="text-muted-foreground absolute top-2.5 left-3 size-4" />
          <Input
            className="bg-background h-10 rounded-xl border pl-9 shadow-none"
            placeholder="Search connections..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button asChild className="h-10 rounded-xl" variant="outline">
          <Link href="/system/mcp">
            <PlusIcon data-icon="inline-start" />
            Add custom server
          </Link>
        </Button>
      </div>

      <section className="bg-card rounded-2xl border p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">Your connections</h2>
        {yourConnections.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing connected yet. Pick a tool below — it takes under a minute.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {yourConnections.map((p) => (
              <div key={p.service} className="bg-background flex items-center gap-3 rounded-xl border p-3">
                <PluginIcon provider={p} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{p.displayName}</div>
                  <div className="text-muted-foreground truncate text-xs">{providerSubtitle(p)}</div>
                </div>
                <Badge variant="secondary" className="text-[10px]">
                  Connected
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-lg"
                  onClick={() =>
                    window.open(
                      `${OC_PUBLIC}/providers/${encodeURIComponent(p.service)}`,
                      "_blank",
                      "noreferrer",
                    )
                  }
                >
                  <Link2Icon className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Add a connection</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Curated Open Connector integrations — or bring your own MCP-compatible server.
            {ocUp === false ? " (runtime offline)" : ""}
            {loading ? " Loading…" : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setTab("popular")}
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors",
              tab === "popular" ? "bg-violet-100 text-violet-900" : "text-muted-foreground hover:bg-muted",
            )}
          >
            Popular
            <span className="bg-background/80 rounded-full px-1.5 text-[11px] font-medium">
              {Math.min(popularProviders.length, 33)}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setTab("all")}
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors",
              tab === "all" ? "bg-violet-100 text-violet-900" : "text-muted-foreground hover:bg-muted",
            )}
          >
            All
            <span className="bg-background/80 rounded-full px-1.5 text-[11px] font-medium">
              {providers.length || "—"}
            </span>
          </button>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="rounded-lg"
              disabled={busyMcp || ocUp === false}
              onClick={() => void ensureMcp()}
            >
              {busyMcp ? <Loader2Icon className="animate-spin" /> : null}
              {ocMcp?.enabled ? "MCP on" : "Enable MCP"}
            </Button>
            <Button asChild size="sm" variant="ghost" className="rounded-lg">
              <a href={OC_PUBLIC} target="_blank" rel="noreferrer">
                Full console
              </a>
            </Button>
          </div>
        </div>

        {ocUp === false ? (
          <div className="bg-card text-muted-foreground rounded-2xl border border-dashed p-6 text-sm">
            Open Connector is offline. Run{" "}
            <code className="font-mono text-xs">bash scripts/start-open-connector.sh</code>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((p) => {
              const connected = connectedMap.has(p.service);
              return (
                <div
                  key={p.service}
                  className="bg-card flex min-h-[96px] items-center gap-3 rounded-2xl border p-4 shadow-sm"
                >
                  <PluginIcon provider={p} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{p.displayName}</div>
                    <div className="text-muted-foreground truncate text-xs">{providerSubtitle(p)}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 rounded-xl"
                    onClick={() => connectProvider(p)}
                  >
                    <Link2Icon data-icon="inline-start" />
                    {connected ? "Manage" : "Connect"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <ConnectKeyDialog
        provider={keyProvider}
        onClose={() => setKeyProvider(null)}
        onDone={() => void reload()}
      />
    </div>
  );
}
