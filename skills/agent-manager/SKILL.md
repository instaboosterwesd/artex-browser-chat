---
name: agent-manager
description: |
  Create, update, or delete chat agents from conversation; attach skills (including
  installing a skill from a GitHub/git URL). Use when the user wants Auto to manage
  another agent (e.g. a "dev" agent), add skills, or remove an agent.
---

# agent-manager

Auto is the platform operator. Use these tools to manage **any** agent the user names.

## Create

1. No display name yet → **ask for the agent name**, then `create_agent`.
2. Optional `skills` / `llm_profile_id` in the same call.

## Update (including a custom "dev" agent)

- Name/description (custom only): `update_agent`
- Add skills (keep existing): `add_agent_skills`
- Replace all skills: `set_agent_skills`
- LLM bind/clear: `set_agent_llm`
- Built-in agents: skills/LLM only (not rename)

## Delete

- `delete_agent` with the agent `key` (custom agents only; never built-ins)

## Install skill from GitHub → attach to an agent

When the user pastes a GitHub URL and says put it on agent X:

```
install_skill_from_git
  url: https://github.com/org/repo   # or …/tree/main/path/to/skill
  agent_key: dev                     # or whatever list_agents shows
  force: true                        # only if replacing an existing skill dir
```

This git-clones, installs into `skills/`, and adds the skill onto that agent.

## Always

- `list_agents` / `list_available_skills` / `list_llm_profiles` when unclear
- Summarize what changed in plain language
