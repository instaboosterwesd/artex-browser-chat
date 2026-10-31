"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  CheckCircle2Icon,
  Loader2Icon,
  PlugIcon,
  PlusIcon,
  RefreshCwIcon,
  Settings2Icon,
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

type Preset = {
  id: string;
  name: string;
  title: string;
  description: string;
  category: string;
  command: string;
  args: string[];
  envKeys: { key: string; label: string; placeholder?: string; secret?: boolean }[];
  docs?: string;
};

/** One-click MCP connection catalog (stdio via npx). */
const PRESETS: Preset[] = [
  {
    id: "telegram",
    name: "telegram",
    title: "Telegram",
    description: "Send and read Telegram bot messages — perfect for daily workflow digests.",
    category: "Messaging",
    command: "npx",
    args: ["-y", "@chigwell/telegram-mcp"],
    envKeys: [
      { key: "TELEGRAM_API_ID", label: "API ID", placeholder: "from my.telegram.org" },
      { key: "TELEGRAM_API_HASH", label: "API Hash", secret: true },
      { key: "TELEGRAM_SESSION_STRING", label: "Session string", secret: true },
    ],
  },
  {
    id: "slack",
    name: "slack",
    title: "Slack",
    description: "Post messages and read channels via Slack MCP.",
    category: "Messaging",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    envKeys: [
      { key: "SLACK_BOT_TOKEN", label: "Bot token", placeholder: "xoxb-…", secret: true },
      { key: "SLACK_TEAM_ID", label: "Team ID", placeholder: "T0…" },
    ],
  },
  {
    id: "discord",
    name: "discord",
    title: "Discord",
    description: "Interact with Discord servers and channels.",
    category: "Messaging",
    command: "npx",
    args: ["-y", "@hanweg/mcp-discord"],
    envKeys: [{ key: "DISCORD_TOKEN", label: "Bot token", secret: true }],
  },
  {
    id: "github",
    name: "github",
    title: "GitHub",
    description: "Repos, issues, PRs, and repository operations.",
    category: "Dev",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    envKeys: [{ key: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "Personal access token", secret: true }],
  },
  {
    id: "brave-search",
    name: "brave-search",
    title: "Brave Search",
    description: "Web search for research workflows.",
    category: "Search",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    envKeys: [{ key: "BRAVE_API_KEY", label: "Brave API key", secret: true }],
  },
  {
    id: "memory",
    name: "memory",
    title: "Memory",
    description: "Persistent knowledge graph memory across chats.",
    category: "Data",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    envKeys: [],
  },
  {
    id: "filesystem",
    name: "filesystem",
    title: "Filesystem",
    description: "Read/write files under an allowed directory.",
    category: "Data",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/hgdfsjgfjf/ARTEX"],
    envKeys: [],
  },
  {
    id: "postgres",
    name: "postgres",
    title: "PostgreSQL",
    description: "Query your database (read carefully — grant least privilege).",
    category: "Data",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    envKeys: [{ key: "POSTGRES_CONNECTION_STRING", label: "Connection string", secret: true }],
  },
  {
    id: "fetch",
    name: "fetch",
    title: "Fetch",
    description: "HTTP fetch for APIs and web pages.",
    category: "Web",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
    envKeys: [],
  },
  {
    id: "puppeteer",
    name: "puppeteer",
    title: "Puppeteer",
    description: "Browser automation (alternate to the built-in Playwright browser MCP).",
    category: "Web",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    envKeys: [],
  },
  {
    id: "notion",
    name: "notion",
    title: "Notion",
    description: "Read and write Notion pages/databases.",
    category: "Productivity",
    command: "npx",
    args: ["-y", "@suekou/mcp-notion-server"],
    envKeys: [{ key: "NOTION_API_TOKEN", label: "Notion integration token", secret: true }],
  },
  {
    id: "gmail",
    name: "gmail",
    title: "Gmail",
    description: "Read and send Gmail (OAuth credentials required).",
    category: "Messaging",
    command: "npx",
    args: ["-y", "@gongrzhe/server-gmail-autoauth-mcp"],
    envKeys: [],
  },
  {
    id: "google-calendar",
    name: "google-calendar",
    title: "Google Calendar",
    description: "List and create calendar events.",
    category: "Productivity",
    command: "npx",
    args: ["-y", "@cocal/google-calendar-mcp"],
    envKeys: [{ key: "GOOGLE_OAUTH_CREDENTIALS", label: "OAuth credentials path / JSON", secret: true }],
  },
  {
    id: "linear",
    name: "linear",
    title: "Linear",
    description: "Issues and projects in Linear.",
    category: "Dev",
    command: "npx",
    args: ["-y", "@tacticlaunch/mcp-linear"],
    envKeys: [{ key: "LINEAR_API_KEY", label: "Linear API key", secret: true }],
  },
  {
    id: "jira",
    name: "jira",
    title: "Jira",
    description: "Jira Cloud issues and projects.",
    category: "Dev",
    command: "npx",
    args: ["-y", "@nexus2520/jira-mcp-server"],
    envKeys: [
      { key: "JIRA_URL", label: "Jira URL", placeholder: "https://xxx.atlassian.net" },
      { key: "JIRA_EMAIL", label: "Email" },
      { key: "JIRA_API_TOKEN", label: "API token", secret: true },
    ],
  },
  {
    id: "sqlite",
    name: "sqlite",
    title: "SQLite",
    description: "Query a local SQLite database file.",
    category: "Data",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sqlite", "--db-path", "/tmp/data.db"],
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
          <DialogTitle>{existing ? "Update" : "Connect"} {preset.title}</DialogTitle>
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
          <p className="text-muted-foreground font-mono text-[10px]">
            {preset.command} {preset.args.join(" ")}
          </p>
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
  const [active, setActive] = React.useState<Preset | null>(null);

  const reload = React.useCallback(() => {
    setLoading(true);
    api
      .mcpServers()
      .then(setServers)
      .catch(() => toast.error("Failed to load MCP connections"))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    reload();
  }, [reload]);

  const byName = React.useMemo(() => {
    const m = new Map<string, MCPServer>();
    for (const s of servers) m.set(s.name, s);
    return m;
  }, [servers]);

  const categories = React.useMemo(() => {
    const set = new Set(PRESETS.map((p) => p.category));
    return [...set];
  }, []);

  return (
    <div className="flex flex-1 flex-col gap-4 md:gap-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Connections</h1>
          <p className="text-muted-foreground text-sm">
            Connect MCP apps (Telegram, Slack, GitHub, …) so Workflows and Auto can use them. Advanced config also lives under{" "}
            <Link href="/system/mcp" className="underline">
              System → MCP
            </Link>
            .
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={reload} disabled={loading}>
          <RefreshCwIcon className={loading ? "animate-spin" : undefined} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlugIcon className="size-4" /> Active connections
          </CardTitle>
          <CardDescription>
            {servers.length === 0 ? "None yet" : `${servers.length} MCP server(s)`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {servers.length === 0 ? (
            <p className="text-muted-foreground text-sm">Pick a service below to connect.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {servers.map((s) => (
                <Badge key={s.id} variant={s.enabled ? "secondary" : "outline"} className="gap-1">
                  {s.enabled ? <CheckCircle2Icon className="size-3 text-emerald-600" /> : null}
                  {s.name}
                  <span className="text-muted-foreground font-mono text-[9px]">#{s.id}</span>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {categories.map((cat) => (
        <div key={cat} className="space-y-3">
          <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{cat}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {PRESETS.filter((p) => p.category === cat).map((p) => {
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
                        <CheckCircle2Icon className="size-3" /> Connected
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-auto flex gap-2">
                    <Button size="sm" className="flex-1" onClick={() => setActive(p)}>
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
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <ConnectDialog
        preset={active}
        existing={active ? byName.get(active.name) : undefined}
        onClose={() => setActive(null)}
        onDone={reload}
      />
    </div>
  );
}
