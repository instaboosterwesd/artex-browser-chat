"use client";

import * as React from "react";
import { Globe, Loader2Icon, Plus, RefreshCw, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type BrowserTab = {
  id: string;
  index: number;
  title: string;
  url: string;
  chatId?: string | null;
  active?: boolean;
};

const BRIDGE = "/browser-bridge";

async function bridgeGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BRIDGE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

async function bridgePost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BRIDGE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

/** Open Browser control + tab strip + clickable live page view under the chat composer. */
export function ChatBrowserDock({ chatId }: { chatId?: string | number | null }) {
  const [open, setOpen] = React.useState(false);
  const [tabs, setTabs] = React.useState<BrowserTab[]>([]);
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [shotKey, setShotKey] = React.useState(0);
  const [vp, setVp] = React.useState({ w: 1280, h: 800 });
  const imgRef = React.useRef<HTMLImageElement>(null);
  const userPickedTab = React.useRef(false);
  const chatKey = chatId == null || chatId === "" ? null : String(chatId);

  const refresh = React.useCallback(async () => {
    try {
      const data = await bridgeGet<{ tabs: BrowserTab[]; activeIndex?: number }>("/tabs");
      setTabs(data.tabs || []);
      if (!userPickedTab.current && typeof data.activeIndex === "number") {
        setActiveIndex(data.activeIndex);
      } else if (activeIndex != null) {
        // keep selection; clamp if tabs closed
        const max = Math.max(0, (data.tabs || []).length - 1);
        setActiveIndex((i) => (i == null ? data.activeIndex ?? 0 : Math.min(i, max)));
      } else if ((data.tabs || []).length) {
        const active = data.tabs.find((t) => t.active);
        setActiveIndex(active ? active.index : data.tabs[data.tabs.length - 1].index);
      }
      setError(null);
      setShotKey((k) => k + 1);
    } catch (e) {
      setError((e as Error).message || "Browser bridge unavailable");
    }
  }, [activeIndex]);

  React.useEffect(() => {
    if (!open) return;
    void refresh();
    const t = setInterval(() => {
      setShotKey((k) => k + 1);
      void bridgeGet<{ tabs: BrowserTab[]; activeIndex?: number }>("/tabs")
        .then((data) => {
          setTabs(data.tabs || []);
          setError(null);
        })
        .catch(() => {});
    }, 1200);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function openBrowser() {
    setBusy(true);
    setError(null);
    userPickedTab.current = false;
    try {
      const r = await bridgePost<{ index: number }>("/tabs/open", { chatId: chatKey || `draft-${Date.now()}` });
      setActiveIndex(r.index);
      setOpen(true);
      await refresh();
    } catch (e) {
      setError((e as Error).message || "Failed to open browser");
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }

  async function activateTab(index: number) {
    userPickedTab.current = true;
    setActiveIndex(index);
    setBusy(true);
    try {
      await bridgePost("/tabs/activate", { index });
      setShotKey((k) => k + 1);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function closeTab(index: number, ev: React.MouseEvent) {
    ev.stopPropagation();
    setBusy(true);
    try {
      const r = await bridgePost<{ activeIndex: number }>("/tabs/close", { index });
      userPickedTab.current = true;
      setActiveIndex(r.activeIndex);
      setShotKey((k) => k + 1);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function newTab() {
    setBusy(true);
    try {
      const r = await bridgePost<{ index: number }>("/tabs/open", {
        chatId: `${chatKey || "tab"}-${Date.now()}`,
      });
      userPickedTab.current = true;
      setActiveIndex(r.index);
      setShotKey((k) => k + 1);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function mapClickToPage(clientX: number, clientY: number) {
    const img = imgRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    const naturalW = img.naturalWidth || vp.w;
    const naturalH = img.naturalHeight || vp.h;
    // object-contain: compute displayed image box inside the element
    const scale = Math.min(rect.width / naturalW, rect.height / naturalH);
    const dispW = naturalW * scale;
    const dispH = naturalH * scale;
    const offsetX = rect.left + (rect.width - dispW) / 2;
    const offsetY = rect.top; // object-top
    const x = (clientX - offsetX) / scale;
    const y = (clientY - offsetY) / scale;
    if (x < 0 || y < 0 || x > naturalW || y > naturalH) return null;
    return { x, y, naturalW, naturalH };
  }

  async function onPageClick(ev: React.MouseEvent<HTMLImageElement>) {
    if (activeIndex == null) return;
    const mapped = mapClickToPage(ev.clientX, ev.clientY);
    if (!mapped) return;
    // Scale from screenshot pixels → viewport CSS pixels
    const scaleX = vp.w / mapped.naturalW;
    const scaleY = vp.h / mapped.naturalH;
    const x = mapped.x * scaleX;
    const y = mapped.y * scaleY;
    try {
      await bridgePost("/input/click", { index: activeIndex, x, y });
      setShotKey((k) => k + 1);
      setTimeout(() => setShotKey((k) => k + 1), 400);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onPageWheel(ev: React.WheelEvent<HTMLDivElement>) {
    if (activeIndex == null) return;
    ev.preventDefault();
    try {
      await bridgePost("/input/scroll", { index: activeIndex, dx: ev.deltaX, dy: ev.deltaY });
      setShotKey((k) => k + 1);
    } catch (_) {}
  }

  function onImgLoad() {
    const img = imgRef.current;
    if (!img) return;
    // Prefer natural screenshot size as viewport fallback; bridge also sets headers we can't read from <img>.
    if (img.naturalWidth && img.naturalHeight) {
      setVp({ w: img.naturalWidth, h: img.naturalHeight });
    }
  }

  const shotSrc =
    activeIndex == null ? null : `${BRIDGE}/screenshot?index=${activeIndex}&t=${shotKey}`;

  return (
    <div className="border-t px-3 py-2">
      <div className="flex items-center gap-2">
        {!open ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void openBrowser()} disabled={busy}>
            {busy ? <Loader2Icon className="mr-1.5 size-3.5 animate-spin" /> : <Globe className="mr-1.5 size-3.5" />}
            Open Browser
          </Button>
        ) : (
          <>
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Hide Browser
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => void refresh()} disabled={busy} title="Refresh">
              <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
            </Button>
            <span className="text-muted-foreground text-xs">Click a tab to view · click page to interact · ✕ closes tab</span>
          </>
        )}
      </div>

      {error && <p className="text-destructive mt-1.5 text-xs">{error}</p>}

      {open && (
        <div className="bg-background mt-2 overflow-hidden rounded-lg border">
          <div className="bg-muted/40 flex items-center gap-1 overflow-x-auto border-b px-1.5 py-1">
            {tabs.length === 0 && <span className="text-muted-foreground px-2 py-1 text-xs">No tabs yet</span>}
            {tabs.map((tab) => {
              const selected = tab.index === activeIndex;
              return (
                <div
                  key={`${tab.index}-${tab.url}`}
                  className={cn(
                    "flex max-w-[200px] items-center gap-0.5 rounded-md pl-2 text-xs",
                    selected ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/70",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => void activateTab(tab.index)}
                    className="flex min-w-0 flex-1 items-center gap-1 py-1 text-left"
                    title={tab.url}
                  >
                    <Globe className="size-3 shrink-0 opacity-70" />
                    <span className="truncate">{tab.title || tab.url || "Tab"}</span>
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground mr-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded"
                    title="Close tab"
                    onClick={(e) => void closeTab(tab.index, e)}
                  >
                    <XIcon className="size-3" />
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => void newTab()}
              className="text-muted-foreground hover:bg-background/70 inline-flex size-7 items-center justify-center rounded-md"
              title="New tab"
            >
              <Plus className="size-3.5" />
            </button>
          </div>

          <div
            className="bg-black relative aspect-[16/10] w-full min-h-[240px] cursor-pointer select-none"
            onWheel={onPageWheel}
          >
            {shotSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={imgRef}
                src={shotSrc}
                alt="Browser tab"
                className="absolute inset-0 size-full object-contain object-top"
                onClick={(e) => void onPageClick(e)}
                onLoad={onImgLoad}
                draggable={false}
              />
            ) : (
              <div className="text-muted-foreground flex size-full items-center justify-center text-sm">Waiting for tab…</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
