package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/Autumn-27/artex/agent"
	"github.com/Autumn-27/artex/db"
	actool "github.com/Autumn-27/norma/tool"
)

// Platform operation tools (for the built-in Auto agent): create/edit skills,
// custom tools, MCP. All are host tools, seeded into the tools table, bound to auto by default, and injected via hostTools. They reuse the existing db/filesystem logic.

func (s *Server) platformTools() []actool.CoreTool {
	return []actool.CoreTool{
		s.toolMCPStatus(),
		s.toolAskOperator(),
		s.toolCreateSkill(),
		s.toolUpdateSkillFile(),
		s.toolCreateCustomTool(),
		s.toolUpdateCustomTool(),
		s.toolCreateMCP(),
		s.toolUpdateMCP(),
		s.toolDeleteAssetsByHost(),
		s.toolListAgents(),
		s.toolCreateAgent(),
		s.toolUpdateAgent(),
		s.toolDeleteAgent(),
		s.toolListAvailableSkills(),
		s.toolSetAgentSkills(),
		s.toolAddAgentSkills(),
		s.toolSetAgentLLM(),
		s.toolInstallSkillFromGit(),
	}
}

// platformToolKeys are the tool keys the Auto agent gets bound by default.
var platformToolKeys = []string{
	"create_skill", "update_skill_file",
	"create_custom_tool", "update_custom_tool",
	"create_mcp", "update_mcp",
	"delete_assets_by_host",
	"list_agents", "create_agent", "update_agent", "delete_agent",
	"list_available_skills", "set_agent_skills", "add_agent_skills", "set_agent_llm",
	"install_skill_from_git",
}

// ---- assets ----

// toolDeleteAssetsByHost hard-deletes every asset tied to one host (exact match).
// Platform-level (not a per-task tool): operates on the global, cross-task asset library.
func (s *Server) toolDeleteAssetsByHost() actool.CoreTool {
	return wrTool("delete_assets_by_host",
		"Delete assets by exact host: removes the host's domains/subdomains plus the services (service) and endpoints (endpoint) under them.\n"+
			"host must match exactly (lowercased, whitespace-trimmed); no fuzzy or wildcard matching.\n"+
			"Passing a root domain (e.g. example.com) also deletes its subdomains and their services/endpoints; passing a subdomain (e.g. a.example.com) or an IP deletes only that host itself and its services/endpoints.\n"+
			"⚠️ Hard delete, applies to the global asset library (shared across tasks), irreversible.",
		objSchema(map[string]any{
			"host": strParam("The host to delete: domain/subdomain/IP. Exact match, e.g. example.com, a.example.com, or 1.2.3.4"),
		}, "host"),
		func(_ context.Context, in json.RawMessage) (actool.Result, error) {
			as := s.assetStore()
			if as == nil {
				return actool.Errorf("asset library not initialized"), nil
			}
			var a struct {
				Host string `json:"host"`
			}
			_ = json.Unmarshal(in, &a)
			if strings.TrimSpace(a.Host) == "" {
				return actool.Errorf("host must not be empty"), nil
			}
			counts, err := as.DeleteByHost(a.Host)
			if err != nil {
				return actool.Errorf("delete failed: " + err.Error()), nil
			}
			var total int64
			for _, n := range counts {
				total += n
			}
			return jsonResult(map[string]any{
				"host":            a.Host,
				"deleted":         total,
				"deleted_by_type": counts,
			})
		})
}

// ---- skills ----

func (s *Server) toolCreateSkill() actool.CoreTool {
	return wrTool("create_skill",
		"Create a new skill (writes SKILL.md, agentskills.io spec). name is lowercase letters/digits/hyphens.",
		objSchema(map[string]any{
			"name":         strParam("skill name (starts with a lowercase letter; letters/digits/hyphens)"),
			"description":  strParam("skill description (required; what it does / when to use it)"),
			"instructions": strParam("Markdown body instructions (optional)"),
		}, "name", "description"),
		func(_ context.Context, in json.RawMessage) (actool.Result, error) {
			var a struct{ Name, Description, Instructions string }
			_ = json.Unmarshal(in, &a)
			if !validSkillName(a.Name) {
				return actool.Errorf("invalid skill name (must start with a lowercase letter, only letters/digits/hyphens, max 64)"), nil
			}
			if strings.TrimSpace(a.Description) == "" {
				return actool.Errorf("description is required"), nil
			}
			path := filepath.Join(s.skillDir, a.Name)
			if _, err := os.Stat(path); err == nil {
				return actool.Errorf("skill already exists: " + a.Name), nil
			}
			if err := os.MkdirAll(path, 0o755); err != nil {
				return actool.Errorf(err.Error()), nil
			}
			var b strings.Builder
			b.WriteString("---\n")
			fmt.Fprintf(&b, "name: %s\n", a.Name)
			fmt.Fprintf(&b, "description: %s\n", a.Description)
			b.WriteString("---\n")
			if strings.TrimSpace(a.Instructions) != "" {
				b.WriteString(a.Instructions)
			} else {
				fmt.Fprintf(&b, "## %s\n\n1. \n2. \n3. \n", a.Name)
			}
			if err := os.WriteFile(filepath.Join(path, "SKILL.md"), []byte(b.String()), 0o644); err != nil {
				_ = os.RemoveAll(path)
				return actool.Errorf(err.Error()), nil
			}
			return actool.Text("skill created: " + a.Name), nil
		})
}

func (s *Server) toolUpdateSkillFile() actool.CoreTool {
	return wrTool("update_skill_file",
		"Write/overwrite one file inside a skill (SKILL.md by default). Used to modify skill content or add scripts/references.",
		objSchema(map[string]any{
			"name":    strParam("skill name"),
			"file":    strParam("relative path (optional, SKILL.md by default, e.g. scripts/run.py)"),
			"content": strParam("full file content"),
		}, "name", "content"),
		func(_ context.Context, in json.RawMessage) (actool.Result, error) {
			var a struct{ Name, File, Content string }
			_ = json.Unmarshal(in, &a)
			if !validSkillName(a.Name) {
				return actool.Errorf("invalid skill name"), nil
			}
			skillPath := filepath.Join(s.skillDir, a.Name)
			if _, err := os.Stat(skillPath); os.IsNotExist(err) {
				return actool.Errorf("skill does not exist: " + a.Name), nil
			}
			rel := strings.TrimSpace(a.File)
			if rel == "" {
				rel = "SKILL.md"
			}
			clean, msg := skillRelPath(rel)
			if msg != "" {
				return actool.Errorf("illegal path: " + msg), nil
			}
			full := filepath.Join(skillPath, clean)
			if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
				return actool.Errorf(err.Error()), nil
			}
			if err := os.WriteFile(full, []byte(a.Content), 0o644); err != nil {
				return actool.Errorf(err.Error()), nil
			}
			return actool.Text("skill file written: " + a.Name + "/" + clean), nil
		})
}

// ---- custom tools ----

type customToolToolInput struct {
	Key         string          `json:"key"`
	Description string          `json:"description"`
	Kind        string          `json:"kind"`
	Exec        json.RawMessage `json:"exec"`
	Schema      json.RawMessage `json:"schema"`
	Agents      []string        `json:"agents"`
	Deferred    bool            `json:"deferred"`
	Enabled     *bool           `json:"enabled"`
}

func customToolSchema(keyDesc string) map[string]any {
	return objSchema(map[string]any{
		"key":         strParam(keyDesc),
		"description": strParam("description shown to the model"),
		"kind":        strParam("shell | command | script (Python only) | http. shell = a bash environment declaration (merely tells the model this tool can be called directly in bash, no exec/schema needed); the other three require exec"),
		"exec":        map[string]any{"type": "object", "description": "execution spec (not needed for the shell kind): command→{command}; script→{code}; http→{method,url,headers,body,proxy,use_recording_proxy}"},
		"schema":      map[string]any{"type": "object", "description": "parameter JSON-Schema (optional for shell/command/script; required for http and must contain properties)"},
		"agents":      map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "agent keys to bind (optional)"},
		"deferred":    map[string]any{"type": "boolean", "description": "whether to defer (no effect for the shell kind; enable only for rarely used command/script/http tools)"},
		"enabled":     map[string]any{"type": "boolean", "description": "whether enabled (default true)"},
	}, "key", "kind")
}

func toDBTool(a customToolToolInput) *db.Tool {
	enabled := true
	if a.Enabled != nil {
		enabled = *a.Enabled
	}
	return &db.Tool{
		Key: a.Key, Description: a.Description, Schema: a.Schema, Agents: a.Agents,
		Enabled: enabled, Kind: a.Kind, Exec: a.Exec, Deferred: a.Deferred,
	}
}

func (s *Server) toolCreateCustomTool() actool.CoreTool {
	return wrTool("create_custom_tool", "[Important] When installing tools the platform does not have, call this tool to put the installed tool into the platform so the platform can call it! Creates a custom tool (shell/command/script/http). shell = a bash environment declaration, needing only key+description+agents, no exec/schema.",
		customToolSchema("tool key (starts with a lowercase letter; letters/digits/underscores)"),
		func(_ context.Context, in json.RawMessage) (actool.Result, error) {
			var a customToolToolInput
			_ = json.Unmarshal(in, &a)
			a.Key = strings.TrimSpace(a.Key)
			if !reToolKey.MatchString(a.Key) {
				return actool.Errorf("key must start with a lowercase letter and contain only lowercase letters/digits/underscores"), nil
			}
			if a.Kind != "shell" && a.Kind != "command" && a.Kind != "script" && a.Kind != "http" {
				return actool.Errorf("kind must be shell / command / script / http"), nil
			}
			if a.Kind == "http" && !hasSchemaProps(a.Schema) {
				return actool.Errorf("http tools must provide a parameter JSON Schema (cannot be empty)"), nil
			}
			if exist, _ := s.m.pg.GetTool(a.Key); exist != nil {
				return actool.Errorf("this key already exists: " + a.Key), nil
			}
			if err := s.m.pg.CreateCustomTool(toDBTool(a)); err != nil {
				return actool.Errorf(err.Error()), nil
			}
			return actool.Text("custom tool created: " + a.Key), nil
		})
}

func (s *Server) toolUpdateCustomTool() actool.CoreTool {
	return wrTool("update_custom_tool", "Update an existing custom tool (by key).",
		customToolSchema("the key of the custom tool to modify"),
		func(_ context.Context, in json.RawMessage) (actool.Result, error) {
			var a customToolToolInput
			_ = json.Unmarshal(in, &a)
			existing, _ := s.m.pg.GetTool(a.Key)
			if existing == nil || existing.System {
				return actool.Errorf("only custom tools can be modified: " + a.Key), nil
			}
			if a.Kind != "shell" && a.Kind != "command" && a.Kind != "script" && a.Kind != "http" {
				return actool.Errorf("kind must be shell / command / script / http"), nil
			}
			if a.Kind == "http" && !hasSchemaProps(a.Schema) {
				return actool.Errorf("http tools must provide a parameter JSON Schema (cannot be empty)"), nil
			}
			if err := s.m.pg.UpdateCustomTool(toDBTool(a)); err != nil {
				return actool.Errorf(err.Error()), nil
			}
			return actool.Text("custom tool updated: " + a.Key), nil
		})
}

// ---- MCP health ----

// toolMCPStatus reports each MCP server's last connect outcome so a worker can
// notice a missing server (and say so) instead of silently degrading when the
// catalog is cached but the server is unreachable.
func (s *Server) toolMCPStatus() actool.CoreTool {
	return wrTool("mcp_status",
		"Report the health of every configured MCP server: name, transport, enabled, cached tool count, and the outcome of the last connect attempt (time, ok/error). Use this when tools you expect are missing or before relying on a skill-gated server.",
		map[string]any{"type": "object", "properties": map[string]any{}},
		func(ctx context.Context, in json.RawMessage) (actool.Result, error) {
			servers, err := s.m.pg.ListMCP()
			if err != nil {
				return actool.Errorf("Error: " + err.Error()), nil
			}
			var b strings.Builder
			fmt.Fprintf(&b, "%d MCP server(s):\n", len(servers))
			for _, m := range servers {
				status := "never connected"
				switch {
				case m.LastConnectOK != nil && *m.LastConnectOK:
					status = "connected ok"
				case m.LastConnectOK != nil && !*m.LastConnectOK:
					status = "DOWN: " + strings.TrimSpace(coalesceStr(m.LastConnectErr, "connect failed"))
				}
				fmt.Fprintf(&b, "- %s [%s, %s, %d cached tools]: %s", m.Name, m.Transport, enabledWord(m.Enabled), len(m.Tools), status)
				if m.LastConnectAt != nil {
					fmt.Fprintf(&b, " (last attempt %s)", m.LastConnectAt.UTC().Format(time.RFC3339))
				}
				b.WriteByte('\n')
			}
			b.WriteString("If a server you need is DOWN, tell the operator in your final report instead of working around it.")
			return actool.Text(b.String()), nil
		})
}

func coalesceStr(p *string, fallback string) string {
	if p == nil {
		return fallback
	}
	return *p
}

func enabledWord(b bool) string {
	if b {
		return "enabled"
	}
	return "disabled"
}

// ---- MCP ----

type mcpToolInput struct {
	ID        int64           `json:"id"`
	Name      string          `json:"name"`
	Transport string          `json:"transport"`
	Command   string          `json:"command"`
	Args      json.RawMessage `json:"args"`
	Env       json.RawMessage `json:"env"`
	URL       string          `json:"url"`
	Enabled   *bool           `json:"enabled"`
	Insecure  *bool           `json:"insecure"`
}

func mcpSchema(withID bool) map[string]any {
	props := map[string]any{
		"name":      strParam("MCP server name"),
		"transport": strParam("stdio | http / sse"),
		"command":   strParam("launch command for stdio (e.g. npx)"),
		"args":      map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "array of command arguments"},
		"env":       map[string]any{"type": "object", "description": "environment variables {KEY:VALUE}"},
		"url":       strParam("URL for http/sse"),
		"enabled":   map[string]any{"type": "boolean", "description": "whether enabled (default true)"},
		"insecure":  map[string]any{"type": "boolean", "description": "http: skip TLS certificate verification (set true for self-signed certificates, default false)"},
	}
	required := []string{"name", "transport"}
	if withID {
		props["id"] = map[string]any{"type": "integer", "description": "id of the MCP server to modify"}
		required = []string{"id", "name", "transport"}
	}
	return objSchema(props, required...)
}

func (a mcpToolInput) toDB() *db.MCPServer {
	enabled := true
	if a.Enabled != nil {
		enabled = *a.Enabled
	}
	insecure := false
	if a.Insecure != nil {
		insecure = *a.Insecure
	}
	return &db.MCPServer{
		ID: a.ID, Name: a.Name, Transport: a.Transport, Command: a.Command,
		Args: a.Args, Env: a.Env, URL: a.URL, Enabled: enabled, Insecure: insecure,
	}
}

func (s *Server) toolCreateMCP() actool.CoreTool {
	return wrTool("create_mcp", "Create an MCP server (stdio/http/sse). Its tools must be authorized per agent visibility after creation.",
		mcpSchema(false),
		func(_ context.Context, in json.RawMessage) (actool.Result, error) {
			var a mcpToolInput
			_ = json.Unmarshal(in, &a)
			a.ID = 0
			if strings.TrimSpace(a.Name) == "" || strings.TrimSpace(a.Transport) == "" {
				return actool.Errorf("name / transport are required"), nil
			}
			id, err := s.m.pg.SaveMCP(a.toDB())
			if err != nil {
				return actool.Errorf(err.Error()), nil
			}
			return actool.Text(fmt.Sprintf("mcp created: id=%d name=%s", id, a.Name)), nil
		})
}

func (s *Server) toolUpdateMCP() actool.CoreTool {
	return wrTool("update_mcp", "Update an existing MCP server (by id).",
		mcpSchema(true),
		func(_ context.Context, in json.RawMessage) (actool.Result, error) {
			var a mcpToolInput
			_ = json.Unmarshal(in, &a)
			if a.ID == 0 {
				return actool.Errorf("id is required"), nil
			}
			if _, err := s.m.pg.SaveMCP(a.toDB()); err != nil {
				return actool.Errorf(err.Error()), nil
			}
			return actool.Text(fmt.Sprintf("mcp updated: id=%d", a.ID)), nil
		})
}

// ---- agents (chat-driven create / update / skills / LLM) ----

func slugAgentKey(name string) string {
	name = strings.ToLower(strings.TrimSpace(name))
	var b strings.Builder
	lastUnderscore := false
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastUnderscore = false
		case r == ' ' || r == '-' || r == '_':
			if b.Len() > 0 && !lastUnderscore {
				b.WriteByte('_')
				lastUnderscore = true
			}
		}
	}
	key := strings.Trim(b.String(), "_")
	if key == "" {
		return ""
	}
	if key[0] >= '0' && key[0] <= '9' {
		key = "a_" + key
	}
	if len(key) > 64 {
		key = key[:64]
	}
	return key
}

func (s *Server) toolListAgents() actool.CoreTool {
	return wrTool("list_agents",
		"List all agents (key, name, description, builtin, enabled, llm_profile_id, skills). Use before create/update to avoid duplicates and to pick an existing agent to modify.",
		objSchema(map[string]any{}),
		func(_ context.Context, in json.RawMessage) (actool.Result, error) {
			ags, err := s.m.pg.ListAgents()
			if err != nil {
				return actool.Errorf(err.Error()), nil
			}
			out := make([]map[string]any, 0, len(ags))
			for _, a := range ags {
				skills, _ := s.m.pg.AgentSkillNames(a.ID)
				row := map[string]any{
					"key": a.Key, "name": a.Name, "description": a.Description,
					"builtin": a.Builtin, "enabled": a.Enabled, "skills": skills,
					"interactive_shell": a.InteractiveShell, "web_search": a.WebSearch,
				}
				if a.LLMProfileID != nil {
					row["llm_profile_id"] = *a.LLMProfileID
				} else {
					row["llm_profile_id"] = nil
				}
				out = append(out, row)
			}
			return jsonResult(map[string]any{"agents": out})
		})
}

func (s *Server) toolCreateAgent() actool.CoreTool {
	return wrTool("create_agent",
		"Create a custom chat agent. IMPORTANT: if the user has not given a display name yet, ASK for the agent name first and only then call this tool. "+
			"Optionally attach skills and an LLM profile in the same call. After creation the agent appears under System → Agent and in the Chat agent picker.",
		objSchema(map[string]any{
			"name":           strParam("Display name (required). Example: Research Helper"),
			"key":            strParam("Optional stable key (lowercase letters/digits/underscores). Auto-derived from name when omitted."),
			"description":    strParam("Optional short description of what this agent does"),
			"skills":         map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Optional skill directory names to grant (e.g. browser-use, api-recon). Use list_available_skills first."},
			"llm_profile_id": map[string]any{"type": "integer", "description": "Optional LLM profile id (from list_llm_profiles). Empty = follow global/default."},
			"prompt":         strParam("Optional system prompt body. Empty keeps the default assistant starter prompt."),
		}, "name"),
		func(_ context.Context, in json.RawMessage) (actool.Result, error) {
			var a struct {
				Name         string   `json:"name"`
				Key          string   `json:"key"`
				Description  string   `json:"description"`
				Skills       []string `json:"skills"`
				LLMProfileID *int64   `json:"llm_profile_id"`
				Prompt       string   `json:"prompt"`
			}
			_ = json.Unmarshal(in, &a)
			a.Name = strings.TrimSpace(a.Name)
			if a.Name == "" {
				return actool.Errorf("name is required — ask the user for the agent name first"), nil
			}
			key := strings.TrimSpace(a.Key)
			if key == "" {
				key = slugAgentKey(a.Name)
			}
			if !reAgentKey.MatchString(key) {
				return actool.Errorf(fmt.Sprintf("invalid key %q (must start with a lowercase letter; only lowercase letters/digits/underscores)", key)), nil
			}
			if exist, _ := s.m.pg.GetAgentByKey(key); exist != nil {
				return actool.Errorf(fmt.Sprintf("agent key already exists: %s — pick another name/key or use update_agent / set_agent_skills", key)), nil
			}
			ag, err := s.m.pg.CreateAgent(key, a.Name, a.Description)
			if err != nil {
				return actool.Errorf(err.Error()), nil
			}
			starter := strings.TrimSpace(a.Prompt)
			if starter == "" {
				starter = agent.DefaultAssistantPrompt
			}
			if err := s.m.pg.SeedPromptIfEmpty(ag.ID, starter); err != nil {
				log.Printf("[agents] seed prompt for %s: %v", key, err)
			}
			_ = s.m.pg.SetAgentInteractiveShell(key, true)
			if len(a.Skills) > 0 {
				if err := s.m.pg.SetAgentSkillVisibility(ag.ID, normalizeSkillList(a.Skills)); err != nil {
					return actool.Errorf("agent created but skills failed: " + err.Error()), nil
				}
				s.grantBrowserMCPIfNeeded(ag.ID, a.Skills)
			}
			if a.LLMProfileID != nil {
				if err := s.m.pg.SetAgentLLMProfile(key, a.LLMProfileID); err != nil {
					return actool.Errorf("agent created but llm bind failed: " + err.Error()), nil
				}
			}
			skills, _ := s.m.pg.AgentSkillNames(ag.ID)
			return jsonResult(map[string]any{
				"ok": true, "key": key, "name": a.Name, "skills": skills,
				"llm_profile_id": a.LLMProfileID,
				"hint":           "Open Chat → select this agent in the picker, or System → Agent to edit further.",
			})
		})
}

func (s *Server) toolUpdateAgent() actool.CoreTool {
	return wrTool("update_agent",
		"Update an existing custom agent (e.g. a user-created 'dev' agent): name and/or description. Built-in agents cannot change name/description — for those use set_agent_skills / add_agent_skills / set_agent_llm. Works on ANY custom agent the user points at.",
		objSchema(map[string]any{
			"key":         strParam("Agent key (from list_agents)"),
			"name":        strParam("New display name (optional)"),
			"description": strParam("New description (optional)"),
		}, "key"),
		func(_ context.Context, in json.RawMessage) (actool.Result, error) {
			var a struct{ Key, Name, Description string }
			_ = json.Unmarshal(in, &a)
			a.Key = strings.TrimSpace(a.Key)
			ag, err := s.m.pg.GetAgentByKey(a.Key)
			if err != nil || ag == nil {
				return actool.Errorf("agent not found: " + a.Key), nil
			}
			if ag.Builtin {
				return actool.Errorf("built-in agent name/description cannot be modified; use set_agent_skills / add_agent_skills / set_agent_llm instead"), nil
			}
			name := strings.TrimSpace(a.Name)
			if name == "" {
				name = ag.Name
			}
			desc := a.Description
			if strings.TrimSpace(desc) == "" {
				desc = ag.Description
			}
			if err := s.m.pg.UpdateAgentMeta(a.Key, name, desc); err != nil {
				return actool.Errorf(err.Error()), nil
			}
			return jsonResult(map[string]any{"ok": true, "key": a.Key, "name": name})
		})
}

func (s *Server) toolDeleteAgent() actool.CoreTool {
	return wrTool("delete_agent",
		"Delete a custom chat agent permanently (built-in agents cannot be deleted). Confirms by key from list_agents. Skills files are kept; only the agent row and its bindings are removed.",
		objSchema(map[string]any{
			"key": strParam("Agent key to delete"),
		}, "key"),
		func(_ context.Context, in json.RawMessage) (actool.Result, error) {
			var a struct{ Key string }
			_ = json.Unmarshal(in, &a)
			a.Key = strings.TrimSpace(a.Key)
			ag, err := s.m.pg.GetAgentByKey(a.Key)
			if err != nil || ag == nil {
				return actool.Errorf("agent not found: " + a.Key), nil
			}
			if ag.Builtin {
				return actool.Errorf("built-in agents cannot be deleted"), nil
			}
			if err := s.m.pg.DeleteAgent(a.Key); err != nil {
				return actool.Errorf(err.Error()), nil
			}
			_ = s.m.pg.RemoveAgentFromToolBindings(a.Key)
			_ = s.m.pg.DeleteTriggersForAgent(a.Key)
			return jsonResult(map[string]any{"ok": true, "deleted": a.Key})
		})
}

func (s *Server) toolListAvailableSkills() actool.CoreTool {
	return wrTool("list_available_skills",
		"List skill directories installed on the platform (name + description). Use before set_agent_skills / create_agent.",
		objSchema(map[string]any{}),
		func(_ context.Context, in json.RawMessage) (actool.Result, error) {
			entries, err := os.ReadDir(s.skillDir)
			if err != nil {
				return actool.Errorf(err.Error()), nil
			}
			out := make([]map[string]any, 0)
			for _, e := range entries {
				if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
					continue
				}
				desc := ""
				body, _ := os.ReadFile(filepath.Join(s.skillDir, e.Name(), "SKILL.md"))
				if len(body) > 0 {
					desc = skillDescFromFrontmatter(body)
				}
				out = append(out, map[string]any{"name": e.Name(), "description": desc})
			}
			return jsonResult(map[string]any{"skills": out})
		})
}

func (s *Server) toolSetAgentSkills() actool.CoreTool {
	return wrTool("set_agent_skills",
		"Replace the skill visibility list for an agent (custom or built-in). Pass the full desired skill name list. Empty list clears all skills. Use list_available_skills for valid names. When adding browser-use / playwright-cli, the browser MCP is also granted.",
		objSchema(map[string]any{
			"key":    strParam("Agent key"),
			"skills": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Full list of skill directory names to grant"},
		}, "key", "skills"),
		func(_ context.Context, in json.RawMessage) (actool.Result, error) {
			var a struct {
				Key    string   `json:"key"`
				Skills []string `json:"skills"`
			}
			_ = json.Unmarshal(in, &a)
			ag, err := s.m.pg.GetAgentByKey(strings.TrimSpace(a.Key))
			if err != nil || ag == nil {
				return actool.Errorf("agent not found: " + a.Key), nil
			}
			skills := normalizeSkillList(a.Skills)
			for _, name := range skills {
				if _, err := os.Stat(filepath.Join(s.skillDir, name, "SKILL.md")); err != nil {
					return actool.Errorf("skill not found on disk: " + name), nil
				}
			}
			if err := s.m.pg.SetAgentSkillVisibility(ag.ID, skills); err != nil {
				return actool.Errorf(err.Error()), nil
			}
			s.grantBrowserMCPIfNeeded(ag.ID, skills)
			return jsonResult(map[string]any{"ok": true, "key": ag.Key, "skills": skills})
		})
}

func (s *Server) toolAddAgentSkills() actool.CoreTool {
	return wrTool("add_agent_skills",
		"Add one or more skills onto an agent (custom or built-in) without removing existing ones. Prefer this when the user says \"add this skill to agent X\". For a full replace use set_agent_skills.",
		objSchema(map[string]any{
			"key":    strParam("Agent key (from list_agents), e.g. a custom 'dev' agent"),
			"skills": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Skill directory names to add"},
		}, "key", "skills"),
		func(_ context.Context, in json.RawMessage) (actool.Result, error) {
			var a struct {
				Key    string   `json:"key"`
				Skills []string `json:"skills"`
			}
			_ = json.Unmarshal(in, &a)
			ag, err := s.m.pg.GetAgentByKey(strings.TrimSpace(a.Key))
			if err != nil || ag == nil {
				return actool.Errorf("agent not found: " + a.Key), nil
			}
			add := normalizeSkillList(a.Skills)
			if len(add) == 0 {
				return actool.Errorf("skills must not be empty"), nil
			}
			for _, name := range add {
				if _, err := os.Stat(filepath.Join(s.skillDir, name, "SKILL.md")); err != nil {
					return actool.Errorf("skill not found on disk: " + name + " — install it first (create_skill or install_skill_from_git)"), nil
				}
			}
			cur, _ := s.m.pg.AgentSkillNames(ag.ID)
			merged := normalizeSkillList(append(cur, add...))
			if err := s.m.pg.SetAgentSkillVisibility(ag.ID, merged); err != nil {
				return actool.Errorf(err.Error()), nil
			}
			s.grantBrowserMCPIfNeeded(ag.ID, merged)
			return jsonResult(map[string]any{"ok": true, "key": ag.Key, "added": add, "skills": merged})
		})
}

func (s *Server) toolInstallSkillFromGit() actool.CoreTool {
	return wrTool("install_skill_from_git",
		"Clone a skill from a GitHub/git URL into the platform skills/ directory, then optionally attach it to an agent. "+
			"Accepts https://github.com/org/repo or a tree URL with a subdirectory (…/tree/main/path/to/skill). "+
			"The skill folder must contain SKILL.md. If agent_key is set, the skill is added to that agent after install.",
		objSchema(map[string]any{
			"url":        strParam("GitHub/git URL of the skill or repo"),
			"name":       strParam("Optional skill directory name (lowercase letters/digits/hyphens). Derived from repo/folder when omitted."),
			"agent_key":  strParam("Optional agent key to attach this skill to after install (any custom or built-in agent)"),
			"force":      map[string]any{"type": "boolean", "description": "Overwrite an existing skill directory with the same name (default false)"},
			"subdir":     strParam("Optional path inside the repo that contains SKILL.md (if not auto-detected)"),
		}, "url"),
		func(_ context.Context, in json.RawMessage) (actool.Result, error) {
			var a struct {
				URL      string `json:"url"`
				Name     string `json:"name"`
				AgentKey string `json:"agent_key"`
				Force    bool   `json:"force"`
				Subdir   string `json:"subdir"`
			}
			_ = json.Unmarshal(in, &a)
			a.URL = strings.TrimSpace(a.URL)
			if a.URL == "" {
				return actool.Errorf("url is required"), nil
			}
			cloneURL, ref, pathHint, err := parseGitSkillURL(a.URL)
			if err != nil {
				return actool.Errorf(err.Error()), nil
			}
			if strings.TrimSpace(a.Subdir) != "" {
				pathHint = strings.Trim(strings.TrimSpace(a.Subdir), "/")
			}
			tmp, err := os.MkdirTemp("", "artex-skill-clone-*")
			if err != nil {
				return actool.Errorf(err.Error()), nil
			}
			defer os.RemoveAll(tmp)
			repoDir := filepath.Join(tmp, "repo")
			args := []string{"clone", "--depth", "1"}
			if ref != "" {
				args = append(args, "--branch", ref)
			}
			args = append(args, cloneURL, repoDir)
			cmd := exec.Command("git", args...)
			cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
			out, err := cmd.CombinedOutput()
			if err != nil {
				// Retry without --branch if ref failed (default branch name unknown).
				if ref != "" {
					_ = os.RemoveAll(repoDir)
					cmd = exec.Command("git", "clone", "--depth", "1", cloneURL, repoDir)
					cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
					out, err = cmd.CombinedOutput()
				}
				if err != nil {
					return actool.Errorf(fmt.Sprintf("git clone failed: %v (%s)", err, strings.TrimSpace(string(out)))), nil
				}
			}
			src, detectName, err := locateSkillDir(repoDir, pathHint)
			if err != nil {
				return actool.Errorf(err.Error()), nil
			}
			name := strings.TrimSpace(a.Name)
			if name == "" {
				name = detectName
			}
			if !validSkillName(name) {
				return actool.Errorf("invalid skill name " + name + " (lowercase letter start; letters/digits/hyphens)"), nil
			}
			dst := filepath.Join(s.skillDir, name)
			if _, err := os.Stat(dst); err == nil {
				if !a.Force {
					return actool.Errorf("skill already exists: " + name + " — pass force=true to overwrite"), nil
				}
				if err := os.RemoveAll(dst); err != nil {
					return actool.Errorf(err.Error()), nil
				}
			}
			if err := copyDir(src, dst); err != nil {
				return actool.Errorf("install copy failed: " + err.Error()), nil
			}
			result := map[string]any{
				"ok": true, "skill": name, "source": a.URL, "path": dst,
			}
			agentKey := strings.TrimSpace(a.AgentKey)
			if agentKey != "" {
				ag, err := s.m.pg.GetAgentByKey(agentKey)
				if err != nil || ag == nil {
					result["attach_error"] = "skill installed but agent not found: " + agentKey
				} else {
					cur, _ := s.m.pg.AgentSkillNames(ag.ID)
					merged := normalizeSkillList(append(cur, name))
					if err := s.m.pg.SetAgentSkillVisibility(ag.ID, merged); err != nil {
						result["attach_error"] = err.Error()
					} else {
						s.grantBrowserMCPIfNeeded(ag.ID, merged)
						result["agent_key"] = ag.Key
						result["skills"] = merged
					}
				}
			}
			return jsonResult(result)
		})
}

func (s *Server) toolSetAgentLLM() actool.CoreTool {
	return wrTool("set_agent_llm",
		"Bind an agent to an LLM profile, or clear the binding so it follows the chat/global default. Use list_llm_profiles to see ids.",
		objSchema(map[string]any{
			"key":            strParam("Agent key"),
			"llm_profile_id": map[string]any{"type": "integer", "description": "Profile id to bind"},
			"clear":          map[string]any{"type": "boolean", "description": "If true, clear the agent LLM binding (ignores llm_profile_id)"},
		}, "key"),
		func(_ context.Context, in json.RawMessage) (actool.Result, error) {
			var a struct {
				Key          string `json:"key"`
				LLMProfileID *int64 `json:"llm_profile_id"`
				Clear        bool   `json:"clear"`
			}
			_ = json.Unmarshal(in, &a)
			a.Key = strings.TrimSpace(a.Key)
			if ag, _ := s.m.pg.GetAgentByKey(a.Key); ag == nil {
				return actool.Errorf("agent not found: " + a.Key), nil
			}
			var id *int64
			if !a.Clear {
				if a.LLMProfileID == nil {
					return actool.Errorf("provide llm_profile_id, or set clear=true"), nil
				}
				id = a.LLMProfileID
			}
			if err := s.m.pg.SetAgentLLMProfile(a.Key, id); err != nil {
				return actool.Errorf(err.Error()), nil
			}
			return jsonResult(map[string]any{"ok": true, "key": a.Key, "llm_profile_id": id, "cleared": a.Clear})
		})
}

func normalizeSkillList(in []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}

func skillDescFromFrontmatter(body []byte) string {
	text := string(body)
	if !strings.HasPrefix(text, "---") {
		return ""
	}
	rest := text[3:]
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return ""
	}
	fm := rest[:end]
	for _, line := range strings.Split(fm, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "description:") {
			d := strings.TrimSpace(strings.TrimPrefix(line, "description:"))
			d = strings.Trim(d, `"'`)
			if len(d) > 160 {
				d = d[:160] + "…"
			}
			return d
		}
	}
	return ""
}

// parseGitSkillURL turns a GitHub (or plain git) URL into clone URL, optional ref, and optional subdir.
func parseGitSkillURL(raw string) (cloneURL, ref, subdir string, err error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", "", "", fmt.Errorf("empty url")
	}
	// git@github.com:org/repo.git
	if strings.HasPrefix(raw, "git@") {
		return raw, "", "", nil
	}
	u, perr := url.Parse(raw)
	if perr != nil {
		return "", "", "", fmt.Errorf("bad url: %v", perr)
	}
	if u.Scheme == "" {
		u.Scheme = "https"
	}
	if u.Host == "" {
		return "", "", "", fmt.Errorf("url missing host")
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) < 2 {
		return "", "", "", fmt.Errorf("expected /owner/repo in url path")
	}
	owner, repo := parts[0], strings.TrimSuffix(parts[1], ".git")
	cloneURL = fmt.Sprintf("%s://%s/%s/%s.git", u.Scheme, u.Host, owner, repo)
	// …/tree/<ref>/<subdir…> or …/blob/<ref>/…
	if len(parts) >= 4 && (parts[2] == "tree" || parts[2] == "blob") {
		ref = parts[3]
		if len(parts) > 4 {
			subdir = strings.Join(parts[4:], "/")
			if parts[2] == "blob" {
				// drop filename; keep parent dir
				subdir = filepath.ToSlash(filepath.Dir(subdir))
				if subdir == "." {
					subdir = ""
				}
			}
		}
	}
	return cloneURL, ref, subdir, nil
}

func locateSkillDir(repoDir, pathHint string) (src string, name string, err error) {
	candidates := []string{}
	if pathHint != "" {
		candidates = append(candidates, filepath.Join(repoDir, filepath.FromSlash(pathHint)))
	}
	candidates = append(candidates, repoDir)
	// Common layouts
	_ = filepath.WalkDir(repoDir, func(path string, d os.DirEntry, werr error) error {
		if werr != nil || d == nil || !d.IsDir() {
			return nil
		}
		rel, _ := filepath.Rel(repoDir, path)
		if rel == "." {
			return nil
		}
		// shallow search only
		if strings.Count(rel, string(os.PathSeparator)) > 3 {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if _, e := os.Stat(filepath.Join(path, "SKILL.md")); e == nil {
			candidates = append(candidates, path)
		}
		return nil
	})
	seen := map[string]bool{}
	for _, c := range candidates {
		c = filepath.Clean(c)
		if seen[c] {
			continue
		}
		seen[c] = true
		if _, e := os.Stat(filepath.Join(c, "SKILL.md")); e == nil {
			base := filepath.Base(c)
			if base == "." || base == "repo" {
				// root skill — use repo folder name from parent of clone
				base = filepath.Base(filepath.Dir(c))
				if base == "" || base == "." {
					base = "imported-skill"
				}
			}
			base = strings.ToLower(base)
			base = strings.ReplaceAll(base, "_", "-")
			return c, base, nil
		}
	}
	return "", "", fmt.Errorf("no SKILL.md found in the repo (pass subdir= if the skill lives in a nested folder)")
}

func copyDir(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		// Skip .git
		if rel == ".git" || strings.HasPrefix(rel, ".git"+string(os.PathSeparator)) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		in, err := os.Open(path)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
		if err != nil {
			return err
		}
		defer out.Close()
		_, err = io.Copy(out, in)
		return err
	})
}

// grantBrowserMCPIfNeeded grants the seeded Playwright "browser" MCP to the agent
// when browser-related skills are attached, so chat agents can drive the headed browser.
func (s *Server) grantBrowserMCPIfNeeded(agentID int64, skills []string) {
	need := false
	for _, name := range skills {
		if name == "browser-use" || name == "browser-skill" || name == "playwright-cli" {
			need = true
			break
		}
	}
	if !need || s.m == nil || s.m.pg == nil {
		return
	}
	servers, err := s.m.pg.ListMCP()
	if err != nil {
		return
	}
	for _, m := range servers {
		if m.Name == "browser" {
			_ = s.m.pg.ToggleVisibility(agentID, "mcp", m.ID, true)
			return
		}
	}
}
