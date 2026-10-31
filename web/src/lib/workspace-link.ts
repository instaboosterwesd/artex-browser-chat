/** File / path tools whose arguments usually include a workspace path. */
export const WORKSPACE_PATH_TOOLS = new Set([
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "LS",
  "Glob",
  "Grep",
  "NotebookEdit",
]);

/** Normalize agent paths to workspace-relative forward-slash form. */
export function normalizeWorkspacePath(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
}

/**
 * Pull a path out of a tool summary / JSON args blob.
 * Supports file_path, path, notebook_path, and a bare path summary line.
 */
export function extractToolPath(tool: string, raw: string): string | null {
  if (!WORKSPACE_PATH_TOOLS.has(tool) || !raw.trim()) return null;
  const text = raw.trim();

  const tryObj = (s: string): string | null => {
    if (!s.startsWith("{")) return null;
    try {
      const o = JSON.parse(s) as Record<string, unknown>;
      for (const key of ["file_path", "path", "notebook_path"]) {
        const v = o[key];
        if (typeof v === "string" && v.trim()) return normalizeWorkspacePath(v);
      }
    } catch {
      /* not JSON */
    }
    return null;
  };

  const fromJson = tryObj(text);
  if (fromJson) return fromJson;

  // Expanded detail blocks look like "[Command]\n{...json...}"
  const cmd = /\[Command\]\s*\n([\s\S]*?)(?:\n\n\[|$)/.exec(text);
  if (cmd) {
    const fromCmd = tryObj(cmd[1].trim());
    if (fromCmd) return fromCmd;
  }

  // Summaries are often just the path (Read / LS / Write).
  const line = text.split("\n")[0]?.trim() ?? "";
  if (line && !line.startsWith("{") && line.length < 512 && /[./\\]/.test(line)) {
    return normalizeWorkspacePath(line);
  }
  return null;
}

/**
 * Deep-link into the Workspace file manager.
 * Directories use ?path=; files use ?path=<parent>&file=<rel>.
 */
export function workspaceHref(fileOrDir: string, asDirectory = false): string {
  const clean = normalizeWorkspacePath(fileOrDir).replace(/\/+$/, "");
  if (!clean) return "/function/workspace";
  if (asDirectory) {
    return `/function/workspace?path=${encodeURIComponent(clean)}`;
  }
  const slash = clean.lastIndexOf("/");
  const dir = slash >= 0 ? clean.slice(0, slash) : "";
  return `/function/workspace?path=${encodeURIComponent(dir)}&file=${encodeURIComponent(clean)}`;
}
