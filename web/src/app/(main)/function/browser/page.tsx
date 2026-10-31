"use client";

import * as React from "react";
import { MonitorPlay, RefreshCw, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";

const LIVE_SRC = "/live-browser/vnc.html?autoconnect=1&resize=scale&reconnect=true&show_dot=true";

export default function BrowserLivePage() {
  const [src, setSrc] = React.useState(LIVE_SRC);

  return (
    <div className="flex h-[calc(100vh-var(--dashboard-header-height,3rem))] min-h-[480px] flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <MonitorPlay className="size-5" />
            Live Browser
          </h1>
          <p className="text-muted-foreground text-sm">
            Real-time view of the headed browser the chat agent controls. Ask in Chat: “open browser and …”.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSrc(`${LIVE_SRC}&t=${Date.now()}`)}
          >
            <RefreshCw className="mr-1.5 size-3.5" />
            Reload
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={LIVE_SRC} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1.5 size-3.5" />
              Open fullscreen
            </a>
          </Button>
        </div>
      </div>
      <div className="border-border bg-black relative min-h-0 flex-1 overflow-hidden rounded-lg border">
        <iframe title="Live browser preview" src={src} className="absolute inset-0 size-full border-0" />
      </div>
    </div>
  );
}
