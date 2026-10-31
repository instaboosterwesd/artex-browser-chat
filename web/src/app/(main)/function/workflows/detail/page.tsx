"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  Bot,
  ClockIcon,
  Loader2Icon,
  MessageSquareIcon,
  PlayIcon,
  SaveIcon,
  ZapIcon,
} from "lucide-react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { Agent, Workflow } from "@/lib/types";
import { cn } from "@/lib/utils";

type WNodeData = {
  kind: "trigger" | "agent" | "action" | string;
  label: string;
  subtitle?: string;
};

function WorkflowNode({ data }: NodeProps) {
  const d = data as WNodeData;
  const Icon = d.kind === "trigger" ? ClockIcon : d.kind === "agent" ? Bot : ZapIcon;
  const tone =
    d.kind === "trigger"
      ? "border-amber-500/50 bg-amber-500/10"
      : d.kind === "agent"
        ? "border-sky-500/50 bg-sky-500/10"
        : "border-emerald-500/50 bg-emerald-500/10";
  return (
    <div className={cn("min-w-[160px] rounded-lg border-2 px-3 py-2 shadow-sm", tone)}>
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground" />
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0" />
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold">{d.label}</div>
          {d.subtitle && <div className="text-muted-foreground truncate text-[10px]">{d.subtitle}</div>}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground" />
    </div>
  );
}

const nodeTypes = { workflow: WorkflowNode };

function parseGraph(raw: string): { nodes: Node[]; edges: Edge[] } {
  try {
    const g = JSON.parse(raw || "{}");
    return {
      nodes: Array.isArray(g.nodes) ? g.nodes : [],
      edges: Array.isArray(g.edges) ? g.edges : [],
    };
  } catch {
    return { nodes: [], edges: [] };
  }
}

function WorkflowDetailInner() {
  const searchParams = useSearchParams();
  const id = Number(searchParams.get("id") || 0);
  const [wf, setWf] = React.useState<Workflow | null>(null);
  const [agents, setAgents] = React.useState<Agent[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  React.useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([api.getWorkflow(id), api.agents()])
      .then(([w, ag]) => {
        setWf(w);
        setAgents(ag);
        const g = parseGraph(w.graph_json);
        setNodes(g.nodes);
        setEdges(g.edges);
      })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [id, setNodes, setEdges]);

  async function save() {
    if (!wf) return;
    setSaving(true);
    try {
      const graph_json = JSON.stringify({ nodes, edges, name: wf.name });
      const next = await api.updateWorkflow(wf.id, {
        name: wf.name,
        description: wf.description,
        agent_key: wf.agent_key,
        enabled: wf.enabled,
        schedule_kind: wf.schedule_kind,
        interval_sec: wf.interval_sec,
        daily_hour: wf.daily_hour,
        daily_minute: wf.daily_minute,
        prompt: wf.prompt,
        graph_json,
      });
      setWf(next);
      toast.success("Saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    if (!wf) return;
    try {
      await api.runWorkflow(wf.id);
      toast.success("Workflow started — open Chat to watch the agent run");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function askAuto() {
    if (!wf) return;
    const msg = encodeURIComponent(
      `Update workflow id=${wf.id} named "${wf.name}": `,
    );
    window.location.href = `/chat?c=&workflow=${wf.id}#draft=${msg}`;
    // Fallback: copy instruction for Auto
    void navigator.clipboard?.writeText(
      `Please update workflow id=${wf.id} ("${wf.name}"). Current prompt:\n${wf.prompt}\n\nChange: `,
    );
    toast.message("Instruction copied — paste in Auto chat to edit this workflow");
  }

  if (!id) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Missing workflow id. <Link href="/function/workflows" className="underline">Back</Link>
      </div>
    );
  }

  if (loading || !wf) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm">
        <Loader2Icon className="size-4 animate-spin" /> Loading workflow…
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100svh-3rem)] min-h-0 flex-col gap-3 md:h-[calc(100svh-4rem)]">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="icon-sm">
          <Link href="/function/workflows">
            <ArrowLeftIcon className="size-4" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <Input
            value={wf.name}
            onChange={(e) => setWf({ ...wf, name: e.target.value })}
            className="h-8 max-w-md font-semibold"
          />
        </div>
        <Badge variant="outline" className="font-mono text-[10px]">
          #{wf.id}
        </Badge>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">Enabled</span>
          <Switch checked={wf.enabled} onCheckedChange={(v) => setWf({ ...wf, enabled: v })} />
        </div>
        <Button size="sm" variant="outline" onClick={askAuto}>
          <MessageSquareIcon data-icon="inline-start" />
          Edit via Auto
        </Button>
        <Button size="sm" variant="outline" onClick={() => void runNow()}>
          <PlayIcon data-icon="inline-start" />
          Run now
        </Button>
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2Icon className="animate-spin" /> : <SaveIcon data-icon="inline-start" />}
          Save
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="bg-card flex min-h-0 flex-col gap-3 overflow-auto rounded-lg border p-3">
          <div className="grid gap-1.5">
            <Label>Description</Label>
            <Input
              value={wf.description}
              onChange={(e) => setWf({ ...wf, description: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Agent</Label>
            <Select value={wf.agent_key} onValueChange={(v) => setWf({ ...wf, agent_key: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.key} value={a.key}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Schedule</Label>
            <Select
              value={wf.schedule_kind}
              onValueChange={(v) => setWf({ ...wf, schedule_kind: v as Workflow["schedule_kind"] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="interval">Interval</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {wf.schedule_kind === "daily" && (
            <div className="flex gap-2">
              <div className="grid flex-1 gap-1.5">
                <Label>Hour</Label>
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={wf.daily_hour}
                  onChange={(e) => setWf({ ...wf, daily_hour: Number(e.target.value) })}
                />
              </div>
              <div className="grid flex-1 gap-1.5">
                <Label>Minute</Label>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={wf.daily_minute}
                  onChange={(e) => setWf({ ...wf, daily_minute: Number(e.target.value) })}
                />
              </div>
            </div>
          )}
          {wf.schedule_kind === "interval" && (
            <div className="grid gap-1.5">
              <Label>Interval (seconds)</Label>
              <Input
                type="number"
                min={60}
                value={wf.interval_sec}
                onChange={(e) => setWf({ ...wf, interval_sec: Number(e.target.value) })}
              />
            </div>
          )}
          <div className="grid min-h-0 flex-1 gap-1.5">
            <Label>Prompt (what the agent does)</Label>
            <Textarea
              className="min-h-40 flex-1"
              value={wf.prompt}
              onChange={(e) => setWf({ ...wf, prompt: e.target.value })}
            />
          </div>
          <p className="text-muted-foreground text-[11px]">
            Tip: connect Telegram under <Link href="/function/connections" className="underline">Connections</Link>, then
            tell the agent to send the message there.
          </p>
        </div>

        <div className="bg-muted/30 relative min-h-[24rem] overflow-hidden rounded-lg border">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={18} size={1} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}

export default function WorkflowDetailPage() {
  return (
    <React.Suspense
      fallback={
        <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">Loading…</div>
      }
    >
      <WorkflowDetailInner />
    </React.Suspense>
  );
}
