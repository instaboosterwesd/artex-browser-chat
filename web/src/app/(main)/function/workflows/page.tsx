"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ClockIcon,
  Loader2Icon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
  WorkflowIcon,
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { Agent, Workflow } from "@/lib/types";

function scheduleLabel(w: Workflow): string {
  if (w.schedule_kind === "daily") {
    return `Daily ${String(w.daily_hour).padStart(2, "0")}:${String(w.daily_minute).padStart(2, "0")}`;
  }
  if (w.schedule_kind === "interval") {
    if (w.interval_sec >= 3600) return `Every ${Math.round(w.interval_sec / 3600)}h`;
    if (w.interval_sec >= 60) return `Every ${Math.round(w.interval_sec / 60)}m`;
    return `Every ${w.interval_sec}s`;
  }
  return "Manual";
}

function CreateWorkflowDialog({
  agents,
  onCreated,
}: {
  agents: Agent[];
  onCreated: (w: Workflow) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [agentKey, setAgentKey] = React.useState("auto");
  const [scheduleKind, setScheduleKind] = React.useState<"manual" | "interval" | "daily">("daily");
  const [hour, setHour] = React.useState(8);
  const [minute, setMinute] = React.useState(0);
  const [intervalMin, setIntervalMin] = React.useState(60);
  const [prompt, setPrompt] = React.useState(
    "Summarize what happened today on the platform and send me a short Telegram message.",
  );

  React.useEffect(() => {
    if (agents.some((a) => a.key === "auto")) setAgentKey("auto");
    else if (agents[0]) setAgentKey(agents[0].key);
  }, [agents]);

  async function create() {
    if (!name.trim() || !prompt.trim()) return;
    setBusy(true);
    try {
      const w = await api.createWorkflow({
        name: name.trim(),
        description: description.trim(),
        agent_key: agentKey,
        schedule_kind: scheduleKind,
        daily_hour: hour,
        daily_minute: minute,
        interval_sec: Math.max(60, intervalMin * 60),
        prompt: prompt.trim(),
        enabled: true,
      });
      toast.success(`Workflow "${w.name}" created`);
      setOpen(false);
      setName("");
      onCreated(w);
    } catch (e) {
      toast.error("Create failed: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon /> Create workflow
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create workflow</DialogTitle>
          <DialogDescription>
            Like n8n: schedule a trigger, pick an agent, describe the work. You can edit the canvas after create.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-1">
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Morning Telegram digest" />
          </div>
          <div className="grid gap-1.5">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
          </div>
          <div className="grid gap-1.5">
            <Label>Agent</Label>
            <Select value={agentKey} onValueChange={setAgentKey}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {agents.map((a) => (
                    <SelectItem key={a.key} value={a.key}>
                      {a.name} ({a.key})
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Schedule</Label>
            <Select value={scheduleKind} onValueChange={(v) => setScheduleKind(v as typeof scheduleKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily (local time)</SelectItem>
                <SelectItem value="interval">Every N minutes</SelectItem>
                <SelectItem value="manual">Manual only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {scheduleKind === "daily" && (
            <div className="flex gap-2">
              <div className="grid flex-1 gap-1.5">
                <Label>Hour</Label>
                <Input type="number" min={0} max={23} value={hour} onChange={(e) => setHour(Number(e.target.value))} />
              </div>
              <div className="grid flex-1 gap-1.5">
                <Label>Minute</Label>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={minute}
                  onChange={(e) => setMinute(Number(e.target.value))}
                />
              </div>
            </div>
          )}
          {scheduleKind === "interval" && (
            <div className="grid gap-1.5">
              <Label>Every N minutes</Label>
              <Input
                type="number"
                min={1}
                value={intervalMin}
                onChange={(e) => setIntervalMin(Number(e.target.value))}
              />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label>What should the agent do?</Label>
            <Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={create} disabled={busy || !name.trim() || !prompt.trim()}>
            {busy && <Loader2Icon className="animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function WorkflowsPage() {
  const [items, setItems] = React.useState<Workflow[]>([]);
  const [agents, setAgents] = React.useState<Agent[]>([]);
  const [loading, setLoading] = React.useState(true);

  const reload = React.useCallback(() => {
    setLoading(true);
    Promise.all([api.workflows(), api.agents()])
      .then(([ws, ag]) => {
        setItems(ws);
        setAgents(ag);
      })
      .catch(() => toast.error("Failed to load workflows"))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    reload();
  }, [reload]);

  async function toggle(w: Workflow, enabled: boolean) {
    try {
      const next = await api.updateWorkflow(w.id, { enabled });
      setItems((list) => list.map((x) => (x.id === w.id ? next : x)));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function runNow(w: Workflow) {
    try {
      await api.runWorkflow(w.id);
      toast.success(`Started "${w.name}" — check Chat history for agent "${w.agent_key}"`);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function remove(w: Workflow) {
    if (!window.confirm(`Delete workflow "${w.name}"?`)) return;
    try {
      await api.deleteWorkflow(w.id);
      toast.success("Deleted");
      setItems((list) => list.filter((x) => x.id !== w.id));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4 md:gap-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Workflow</h1>
          <p className="text-muted-foreground text-sm">
            n8n-style automations — schedule an agent to run work (Telegram digests, checks, …). Edit in the canvas or ask Auto in Chat.
          </p>
        </div>
        <CreateWorkflowDialog
          agents={agents.filter((a) => !a.builtin || a.role === "assistant" || a.key === "auto")}
          onCreated={(w) => {
            setItems((list) => [w, ...list]);
            window.location.href = `/function/workflows/detail?id=${w.id}`;
          }}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <WorkflowIcon className="size-4" /> Workflows
          </CardTitle>
          <CardDescription>{loading ? "Loading…" : `${items.length} total`}</CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 && !loading ? (
            <p className="text-muted-foreground py-10 text-center text-sm">
              No workflows yet. Create one — e.g. daily 08:00 Telegram summary via Auto.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((w) => (
                <div key={w.id} className="hover:border-primary/40 flex flex-col gap-3 rounded-lg border p-4 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/function/workflows/detail?id=${w.id}`} className="min-w-0 flex-1 hover:underline">
                      <div className="truncate text-sm font-medium">{w.name}</div>
                      <div className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                        {w.description || w.prompt || "(no description)"}
                      </div>
                    </Link>
                    <Switch checked={w.enabled} onCheckedChange={(v) => void toggle(w, v)} />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary" className="gap-1 text-[10px]">
                      <ClockIcon className="size-3" />
                      {scheduleLabel(w)}
                    </Badge>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {w.agent_key}
                    </Badge>
                    {!w.enabled && (
                      <Badge variant="outline" className="text-destructive text-[10px]">
                        Off
                      </Badge>
                    )}
                  </div>
                  <div className="text-muted-foreground text-[10px]">
                    {w.last_fire ? `Last run ${new Date(w.last_fire).toLocaleString()}` : "Never run"}
                  </div>
                  <div className="mt-auto flex gap-1">
                    <Button size="sm" variant="outline" className="flex-1" asChild>
                      <Link href={`/function/workflows/detail?id=${w.id}`}>Open</Link>
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void runNow(w)} title="Run now">
                      <PlayIcon className="size-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void remove(w)} title="Delete">
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
