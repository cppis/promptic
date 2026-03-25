# promptic

**Promptic** is an MCP (Model Context Protocol) server for prompt quality analysis, history management, and project version tracking. Connect it to Claude Code or any MCP-compatible client.

## Features

- **Prompt Analysis** — Score prompts across 5 axes: clarity, completeness, specificity, context, and output format
- **Version Tracking** — Chain prompt versions (v1 → v2 → v3) and compare diffs
- **History Management** — Store, search, filter, and paginate prompt history
- **Project Organization** — Group prompts into named projects with snapshots
- **Export / Import** — Export as JSON, Markdown, or CSV; import Claude conversation logs
- **Dashboard** — Generate an HTML visualization with score trends and grade distribution

## Tools (18 total)

| Category | Tools |
|---|---|
| Projects | `list_projects`, `create_project`, `set_active_project`, `snapshot_project` |
| Analysis | `analyze_prompt`, `compare_prompts`, `get_versions` |
| History | `add_history_entry`, `get_history`, `query_history` |
| Export | `visualize_project`, `export_project`, `import_project`, `import_claude_conversations` |
| Settings | `get_settings`, `set_api_key`, `get_stats` |

## Installation

### Claude Code / Cowork

```bash
npx @cppis/promptic
```

Or add to your MCP config (`~/.claude.json` / `mcp.json`):

```json
{
  "mcpServers": {
    "promptic": {
      "command": "npx",
      "args": ["-y", "@cppis/promptic"]
    }
  }
}
```

### Manual

```bash
npm install -g @cppis/promptic
promptic
```

## Usage

Once connected, use the tools via natural language in Claude:

```
>> anz  (or >> 분석)        — Analyze the last prompt
>> deep                    — Deep analysis using Claude API
>> re   (or >> v2)         — Re-analyze with improvements
```

## Analysis Modes

| Mode | Description |
|---|---|
| `local` | Fast rule-based scoring (default) |
| `api` | Claude API-powered analysis |
| `deep` | Full deep analysis with improvement suggestions |

## Requirements

- Node.js >= 18
- Anthropic API key (optional — required for `api` / `deep` modes)

## License

ISC
