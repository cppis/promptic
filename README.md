# Promptic — Getting Started

[![EN](https://img.shields.io/badge/lang-EN-blue)](README.md) [![KO](https://img.shields.io/badge/lang-한국어-brightgreen)](README.ko.md)

[![npm version](https://img.shields.io/npm/v/promptic?color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cppis/promptic)
[![npm downloads](https://img.shields.io/npm/dm/promptic?color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cppis/promptic)
[![Node.js](https://img.shields.io/node/v/promptic?color=339933&logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/cppis/prompt-lens/blob/main/LICENSE)
[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-blueviolet?logo=anthropic&logoColor=white)](https://modelcontextprotocol.io/)
[![GitHub release](https://img.shields.io/github/v/release/cppis/prompt-lens?logo=github)](https://github.com/cppis/prompt-lens/releases)
[![GitHub last commit](https://img.shields.io/github/last-commit/cppis/prompt-lens?logo=github)](https://github.com/cppis/prompt-lens/commits/main)
[![GitHub issues](https://img.shields.io/github/issues/cppis/prompt-lens?logo=github)](https://github.com/cppis/prompt-lens/issues)
[![GitHub stars](https://img.shields.io/github/stars/cppis/prompt-lens?style=social)](https://github.com/cppis/prompt-lens)

Promptic is an MCP (Model Context Protocol) server for Claude Desktop and Claude Code that makes your prompts visible — what the AI understood, what it guessed, and what it couldn't know.

Trigger with `>> anz`, `>> 분석`, or just say "analyze this prompt."
No API key required for local mode.

> Get Promptic installed and analyze your first prompt in 5 minutes.

---

## Prerequisites

- **Node.js 18+** — [Download](https://nodejs.org/)
- **Claude Desktop** or **Claude Code** — [Download Claude Desktop](https://claude.ai/download)

---

## Step 1. Register the MCP Server

### Option A: Run from source (for development)

```bash
git clone https://github.com/cppis/prompt-lens.git
cd prompt-lens/mcp-server
npm install
```

Run the setup script to register Promptic with Claude Desktop automatically:

```bash
./scripts/setup-claude-desktop.sh
```

The script detects your OS and adds Promptic to `claude_desktop_config.json` without affecting existing MCP configurations.

**For Claude Code:**

```bash
claude mcp add promptic node /your/path/to/prompt-lens/mcp-server/index.js
```

<details>
<summary>Manual setup (edit config directly)</summary>

| OS | Config file path |
|------|-----------------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "promptic": {
      "command": "node",
      "args": ["/your/path/to/prompt-lens/mcp-server/index.js"]
    }
  }
}
```

> Replace `/your/path/to/` with the actual path where you cloned the repo. Restart Claude Desktop after saving.
</details>

### Option B: Run via npx (after npm release)

Once published to npm, no cloning is required.

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

**Claude Code:**

```bash
claude mcp add promptic -- npx -y promptic
```

---

## Step 2. Restart Claude Desktop

After saving the config file, **fully quit and relaunch Claude Desktop**.

When registered successfully, the MCP tool icon (🔧) appears in the bottom-right of the input area and `promptic` is listed in the tools menu.

**Verify in Claude Code:**

```bash
claude mcp list
```

If `promptic` appears in the output, you're good to go.

---

## Step 3. Analyze Your First Prompt

Promptic is **triggered automatically** when it detects any of the following:

### Trigger Rules

| # | Method | Example |
|---|--------|---------|
| 1 | **Command `>> anz` / `>> 분석`** | `Build a login form in React >> anz` |
| 2 | **Command `>> anz+run` / `>> 분석+실행`** | `Design a REST API >> anz+run` |
| 3 | **Command `>> deep` / `>> 정밀분석`** | `Design a system >> deep` |
| 4 | **English natural language** | `analyze this prompt`, `how good is this`, `review this prompt` |
| 5 | **Korean natural language** | `이 프롬프트 분석해줘`, `이 프롬프트 어때?`, `프롬프트 좀 봐줘` |
| 6 | **Implicit improvement request** | `what's wrong with this`, `how can I improve this` |

> For rules #1–3, append the command at the end of your message. Everything before it is treated as the prompt to analyze.

Command behavior comparison:

| Command | Behavior |
|---------|----------|
| `>> anz` / `>> 분석` | Returns analysis + improvement suggestions |
| `>> anz+run` / `>> 분석+실행` | Analyzes, then **immediately executes** the improved prompt |
| `>> deep` / `>> 정밀분석` | Full 4-step pipeline: analyze → improve → re-analyze → compare |

### Token Usage Guide

Token overhead varies by command. **Model choice is the biggest factor.**

**Token increase per command (vs. plain conversation, Sonnet baseline):**

| Command | Token increase | Reason |
|---------|---------------|--------|
| `>> anz` (local) | **+20–30%** | ~500-token JSON result added to context. No LLM call for the analysis itself. |
| `>> anz+run` | **+50–80%** | Analysis JSON + actual task execution with the improved prompt |
| `>> deep` / `>> 정밀분석` | **+200–300%** | 2× analyze_prompt calls + improved prompt generation + comparison, 4 steps total |
| api mode | **Separate from Claude subscription** | Direct Anthropic API call, billed independently |

**Relative cost by model (same token count):**

| Model | Relative cost | Recommended for |
|-------|--------------|-----------------|
| Claude Haiku 4.5 | **1× (baseline)** | Fast iterative analysis |
| Claude Sonnet 4.6 | **~4×** | General use (recommended) |
| Claude Opus 4.6 | **~20×** | High-stakes prompts only |

> **Tip:** For day-to-day analysis use `>> anz` + Sonnet, and reserve `>> deep` or Opus for critical prompts. Running `>> deep` with Opus can consume **up to 10–15× more tokens** than a plain conversation.

---

**Example — command trigger:**

```
Build a login form in React >> anz
```

**Example — natural language trigger:**

```
Analyze this prompt: "Build a login form in React"
```

Promptic responds automatically:

```
📊 Overall score: 43/100 (Grade D)

5-axis scores:
  - Clarity:       55
  - Specificity:   30
  - Context:       35
  - Structure:     40
  - Actionability: 50

❌ Missing elements: Role, Context, Output Format, Example, Constraints

💡 Suggestions:
  - Define a role (e.g., "You are a senior React developer")
  - Specify the exact requirements for the login form
  - State the desired output format

✨ Improved prompt:
  "You are a senior React developer. Build a login form component using TypeScript.
   Include email/password inputs, validation, and error messages.
   Style it with Tailwind CSS and provide usage instructions alongside the code."
```

### MCP Prompts Workflow (Claude Desktop `/` menu)

Type `/` in the Claude Desktop chat input to access Promptic workflow presets:

| Preset | Description |
|--------|-------------|
| `quick-analyze` | Fast 5-axis analysis + improvement suggestions |
| `deep-analyze` | Full 4-step deep analysis pipeline |
| `project-report` | Generate project dashboard + statistics summary |

---

## Next Steps

| Document | Contents |
|----------|----------|
| [Usage Guide](docs/3.usage.md) | Tool parameters, usage scenarios, project management, version control, visualization, API mode, FAQ |
| [Project Overview](docs/0.overview.md) | Architecture, roadmap |

### Quick Command Reference

| What you want to do | Say this to Claude |
|---------------------|-------------------|
| Analyze a prompt (quick) | `... >> anz` or `... >> 분석` |
| Analyze + run immediately | `... >> anz+run` or `... >> 분석+실행` |
| Deep analysis (4-step) | `... >> deep` or `... >> 정밀분석` |
| Analyze via natural language | `"Analyze this prompt: ..."` |
| Create a project | `"Create a project called 'my-project' in Promptic"` |
| Set active project | `"Set 'my-project' as the active project"` |
| Visualize project | `... >> viz` or `... >> 시각화` |
| Compare prompts | `... >> diff` |

For the full command list, see the [Usage Guide](docs/3.usage.md#전체-명령-모음).
