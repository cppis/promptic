#!/usr/bin/env node

/**
 * PromptLens MCP Server (v0.3.0)
 *
 * MCP-only architecture — all PromptLens features accessible via
 * Claude Desktop and Claude Code as native MCP tools.
 *
 * Transport: stdio
 * Storage: ~/.promptlens/data.json (data), ~/.promptlens/settings.json (config)
 *
 * Tools (12):
 *   analyze_prompt          — Prompt quality analysis (local rules or Claude API)
 *   list_projects           — List all projects with stats
 *   create_project          — Create a new project
 *   get_history             — Get prompt history for a project
 *   add_history_entry       — Add a prompt to history
 *   import_claude_conversations — Import Claude Desktop/Code conversations
 *   get_stats               — Overall statistics
 *   set_api_key             — Register Claude API key for API analysis mode
 *   get_settings            — View current settings (API key status, model, etc.)
 *   visualize_project       — Generate HTML dashboard with charts
 *   compare_prompts         — Diff two prompt versions (text, score, axis)
 *   get_versions            — Get version chain for a prompt
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Storage } from './lib/storage.js';
import { analyzePrompt, analyzePromptWithApi } from './lib/analyzer.js';
import { importClaudeDesktop, importClaudeCode } from './lib/importer.js';
import { generateDashboardHtml, generateOverviewHtml } from './lib/visualizer.js';
import { compareEntries } from './lib/differ.js';

const storage = new Storage();

const server = new McpServer({
  name: 'promptlens',
  version: '0.3.0'
});

// ─────────────────────────────────────────────
// Tool: analyze_prompt
// ─────────────────────────────────────────────
server.tool(
  'analyze_prompt',
  `Analyze a prompt for quality. Two modes: "local" (default, free, instant 5-axis scoring) or "api" (Claude API 3-color report: Referenced/Inferred/Missing — requires API key). Returns scores, missing elements, and improvement suggestions.

TRIGGER RULES — call this tool automatically when:
1. Command suffix: user ends message with ">> anz" or ">> 분석". Treat everything before it as the prompt.
2. Analyze + Run: user ends message with ">> anz+run" or ">> 분석+실행". Treat everything before it as the prompt. After receiving the analysis result, you MUST immediately execute the enhancedPrompt (the improved prompt) as if the user typed it directly. Do NOT just show the improved prompt — actually run it and produce the result.
3. Deep analyze: user ends message with ">> deep" or ">> 정밀분석". Treat everything before it as the prompt. Run the full deep-analyze pipeline: (1) call analyze_prompt on the original, (2) generate an improved prompt fixing all missing elements, (3) call analyze_prompt again on the improved version, (4) compare and show the score difference. If a projectId is available, save both entries with parentId linking.
4. Natural language (EN): user says "analyze this prompt", "check this prompt", "rate this prompt", "how good is this prompt", "evaluate my prompt", "review this prompt".
5. Natural language (KR): user says "이 프롬프트 분석해줘", "프롬프트 점검해줘", "프롬프트 평가해줘", "이거 분석해봐", "프롬프트 리뷰해줘", "이 프롬프트 어때", "이 프롬프트 괜찮아?", "프롬프트 좀 봐줘".
6. Implicit analysis: user pastes a prompt and asks "이거 괜찮아?", "이거 좀 부족한데", "이거 어떻게 개선해?", "what's wrong with this", "how can I improve this".`,
  {
    prompt: z.string().describe('The prompt text to analyze'),
    mode: z.enum(['local', 'api']).optional().describe('Analysis mode: "local" (free, rule-based) or "api" (Claude API 3-color report). Default: local'),
    projectId: z.string().optional().describe('Optional project ID to save the analysis to history'),
    tags: z.array(z.string()).optional().describe('Optional tags for the history entry'),
    parentId: z.string().optional().describe('Parent entry ID for version tracking. Links this analysis as a revision of a previous prompt.'),
    autoRun: z.boolean().optional().describe('When true (triggered by ">> anz+run" or ">> 분석+실행"), the caller MUST execute the enhancedPrompt immediately after showing the analysis. Do not just display it — run it as a new user request.')
  },
  async ({ prompt, mode, projectId, tags, parentId, autoRun }) => {
    const analysisMode = mode || 'local';
    let result;

    if (analysisMode === 'api') {
      const apiKey = storage.getApiKey();
      if (!apiKey) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'API key not set. Use set_api_key tool first, or use mode: "local" for free analysis.',
              hint: 'Run: set_api_key with your Anthropic API key (sk-ant-...)'
            }, null, 2)
          }]
        };
      }
      const model = storage.getModel();
      try {
        result = await analyzePromptWithApi(prompt, apiKey, model);
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: `API analysis failed: ${err.message}`,
              hint: 'Check your API key and credit balance. Falling back to local analysis.',
              fallback: analyzePrompt(prompt)
            }, null, 2)
          }]
        };
      }
    } else {
      result = analyzePrompt(prompt);
    }

    // Save to history if projectId provided
    let savedEntry = null;
    if (projectId) {
      savedEntry = await storage.addHistoryEntry(projectId, {
        prompt,
        enhanced: result.enhancedPrompt || result.enhanced || '',
        score: result.score,
        axisScores: result.axisScores,
        tags: tags || ['mcp', analysisMode],
        note: `[MCP ${analysisMode}] ${result.summary}`,
        platform: 'claude',
        parentId: parentId || null
      });
    }

    // Auto-diff with parent if parentId is set
    let diff = null;
    if (parentId && savedEntry) {
      const parentEntry = await storage.findEntryById(parentId);
      if (parentEntry) {
        diff = compareEntries(parentEntry, savedEntry);
      }
    }

    const response = { ...result };
    if (savedEntry) {
      response.entryId = savedEntry.id;
      response.version = savedEntry.version;
    }
    if (diff) {
      response.diff = diff;
    }

    // autoRun: instruct the LLM to execute the enhanced prompt immediately
    if (autoRun && response.enhancedPrompt) {
      response.autoRun = true;
      response._instruction = 'AUTO-RUN MODE: Show the analysis summary briefly, then IMMEDIATELY execute the enhancedPrompt below as if the user typed it. Do not ask for confirmation — just run it and produce the output.';
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2)
      }]
    };
  }
);

// ─────────────────────────────────────────────
// Tool: list_projects
// ─────────────────────────────────────────────
server.tool(
  'list_projects',
  'List all PromptLens projects with their stats (prompt count, average score, trend).',
  {},
  async () => {
    const projects = await storage.getProjects();
    const result = [];
    for (const p of projects) {
      const entries = await storage.getHistory(p.id);
      const avgScore = entries.length > 0
        ? Math.round(entries.reduce((s, e) => s + e.score, 0) / entries.length)
        : 0;
      result.push({
        id: p.id,
        name: p.name,
        promptCount: entries.length,
        avgScore,
        createdAt: p.createdAt
      });
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  }
);

// ─────────────────────────────────────────────
// Tool: create_project
// ─────────────────────────────────────────────
server.tool(
  'create_project',
  'Create a new PromptLens project for organizing prompt history.',
  {
    name: z.string().describe('Project name')
  },
  async ({ name }) => {
    const project = await storage.createProject(name);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ message: `Project "${name}" created`, project }, null, 2)
      }]
    };
  }
);

// ─────────────────────────────────────────────
// Tool: get_history
// ─────────────────────────────────────────────
server.tool(
  'get_history',
  'Get prompt history entries for a project. Returns prompts with scores, tags, and timestamps.',
  {
    projectId: z.string().describe('Project ID'),
    limit: z.number().optional().describe('Maximum number of entries to return (default: 20)'),
    search: z.string().optional().describe('Search text to filter entries by prompt content or tags')
  },
  async ({ projectId, limit, search }) => {
    let entries = await storage.getHistory(projectId);

    if (search) {
      const q = search.toLowerCase();
      entries = entries.filter(e =>
        e.prompt.toLowerCase().includes(q) ||
        e.tags.some(t => t.toLowerCase().includes(q)) ||
        e.note.toLowerCase().includes(q)
      );
    }

    // Sort by date descending
    entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (limit) {
      entries = entries.slice(0, limit);
    } else {
      entries = entries.slice(0, 20);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(entries, null, 2)
      }]
    };
  }
);

// ─────────────────────────────────────────────
// Tool: add_history_entry
// ─────────────────────────────────────────────
server.tool(
  'add_history_entry',
  'Add a prompt to history with optional score and tags. Use this to manually record prompts you want to track.',
  {
    projectId: z.string().describe('Project ID'),
    prompt: z.string().describe('The prompt text'),
    score: z.number().min(0).max(100).optional().describe('Quality score (0-100)'),
    tags: z.array(z.string()).optional().describe('Tags for categorization'),
    note: z.string().optional().describe('Note or comment')
  },
  async ({ projectId, prompt, score, tags, note }) => {
    const analysis = analyzePrompt(prompt);
    const entry = await storage.addHistoryEntry(projectId, {
      prompt,
      enhanced: '',
      score: score ?? analysis.score,
      axisScores: analysis.axisScores,
      tags: tags || ['mcp'],
      note: note || '',
      platform: 'claude'
    });
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ message: 'Entry added', entry }, null, 2)
      }]
    };
  }
);

// ─────────────────────────────────────────────
// Tool: import_claude_conversations
// ─────────────────────────────────────────────
server.tool(
  'import_claude_conversations',
  'Import conversations from Claude Desktop (conversations.json) or Claude Code (.jsonl). Creates one project per conversation or merges all into one project.',
  {
    filePath: z.string().describe('Path to conversations.json or .jsonl file'),
    mode: z.enum(['per-conversation', 'single']).optional().describe('Import mode: per-conversation (default) creates one project per conversation, single merges all into one project'),
    projectName: z.string().optional().describe('Project name for single mode')
  },
  async ({ filePath, mode, projectName }) => {
    const fs = await import('fs');
    if (!fs.existsSync(filePath)) {
      return {
        content: [{ type: 'text', text: `Error: File not found: ${filePath}` }]
      };
    }

    const text = fs.readFileSync(filePath, 'utf-8');
    const importMode = mode || 'per-conversation';

    let result;
    if (filePath.endsWith('.jsonl')) {
      result = await importClaudeCode(storage, text, importMode, projectName);
    } else {
      result = await importClaudeDesktop(storage, text, importMode, projectName);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          message: 'Import complete',
          imported: result.imported,
          skipped: result.skipped,
          projectCount: result.projectCount || 1,
          projectIds: result.projectIds || [result.projectId]
        }, null, 2)
      }]
    };
  }
);

// ─────────────────────────────────────────────
// Tool: get_stats
// ─────────────────────────────────────────────
server.tool(
  'get_stats',
  'Get overall PromptLens statistics: total projects, total prompts, average score, most used tags, score trend.',
  {},
  async () => {
    const projects = await storage.getProjects();
    let totalPrompts = 0;
    let totalScore = 0;
    let scored = 0;
    const tagCounts = {};

    for (const p of projects) {
      const entries = await storage.getHistory(p.id);
      totalPrompts += entries.length;
      for (const e of entries) {
        if (e.score > 0) { totalScore += e.score; scored++; }
        for (const t of e.tags) {
          tagCounts[t] = (tagCounts[t] || 0) + 1;
        }
      }
    }

    const topTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          totalProjects: projects.length,
          totalPrompts,
          avgScore: scored > 0 ? Math.round(totalScore / scored) : 0,
          topTags
        }, null, 2)
      }]
    };
  }
);

// ─────────────────────────────────────────────
// Tool: set_api_key
// ─────────────────────────────────────────────
server.tool(
  'set_api_key',
  'Register or update your Anthropic API key for Claude API analysis mode. The key is stored locally in ~/.promptlens/settings.json. You can also set the preferred model.',
  {
    apiKey: z.string().describe('Anthropic API key (sk-ant-...)'),
    model: z.string().optional().describe('Preferred model for API analysis (default: claude-sonnet-4-5-20250514). Options: claude-sonnet-4-5-20250514, claude-3-5-haiku-20241022, claude-opus-4-0-20250514')
  },
  async ({ apiKey, model }) => {
    // Validate key format
    if (!apiKey.startsWith('sk-ant-')) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: 'Invalid API key format. Key should start with "sk-ant-"' }, null, 2)
        }]
      };
    }

    // Test the key with a minimal request
    try {
      const testModel = 'claude-3-5-haiku-20241022';
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: testModel,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }]
        })
      });

      if (!response.ok) {
        const err = await response.text();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: `API key validation failed: ${err}` }, null, 2)
          }]
        };
      }

      storage.setApiKey(apiKey);
      if (model) storage.setModel(model);

      const masked = apiKey.slice(0, 10) + '...' + apiKey.slice(-4);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            message: 'API key registered and validated successfully',
            maskedKey: masked,
            model: model || storage.getModel(),
            hint: 'You can now use analyze_prompt with mode: "api" for 3-color reports'
          }, null, 2)
        }]
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: `Connection failed: ${err.message}` }, null, 2)
        }]
      };
    }
  }
);

// ─────────────────────────────────────────────
// Tool: get_settings
// ─────────────────────────────────────────────
server.tool(
  'get_settings',
  'View current PromptLens settings: API key status, preferred model, storage location.',
  {},
  async () => {
    const apiKey = storage.getApiKey();
    const model = storage.getModel();
    const settings = storage.getSettings();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          apiKeyStatus: apiKey ? 'registered' : 'not set',
          maskedKey: apiKey ? apiKey.slice(0, 10) + '...' + apiKey.slice(-4) : null,
          model,
          storagePath: '~/.promptlens/data.json',
          settingsPath: '~/.promptlens/settings.json',
          availableModes: {
            local: 'Free, instant, rule-based 5-axis scoring (always available)',
            api: apiKey ? 'Claude API 3-color report (Referenced/Inferred/Missing)' : 'Requires API key — use set_api_key first'
          }
        }, null, 2)
      }]
    };
  }
);

// ─────────────────────────────────────────────
// Tool: compare_prompts
// ─────────────────────────────────────────────
server.tool(
  'compare_prompts',
  'Compare two prompt entries and show the diff: text changes, score changes, 5-axis score changes, and tag changes. Use this to see how a prompt improved between versions. When the user says ">> diff", compare the two most recent entries in the specified project.',
  {
    entryIdA: z.string().describe('First (older) entry ID'),
    entryIdB: z.string().describe('Second (newer) entry ID'),
    projectId: z.string().optional().describe('Project ID (helps locate entries faster)')
  },
  async ({ entryIdA, entryIdB, projectId }) => {
    let entryA, entryB;

    if (projectId) {
      const entries = await storage.getHistory(projectId);
      entryA = entries.find(e => e.id === entryIdA);
      entryB = entries.find(e => e.id === entryIdB);
    } else {
      entryA = await storage.findEntryById(entryIdA);
      entryB = await storage.findEntryById(entryIdB);
    }

    if (!entryA) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: `Entry not found: ${entryIdA}` }, null, 2) }] };
    }
    if (!entryB) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: `Entry not found: ${entryIdB}` }, null, 2) }] };
    }

    const diff = compareEntries(entryA, entryB);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(diff, null, 2)
      }]
    };
  }
);

// ─────────────────────────────────────────────
// Tool: get_versions
// ─────────────────────────────────────────────
server.tool(
  'get_versions',
  'Get the version chain (revision history) of a prompt. Returns all versions linked by parentId, from the original to the latest revision, with score changes between each version.',
  {
    entryId: z.string().describe('Any entry ID in the version chain'),
    projectId: z.string().describe('Project ID containing the entry')
  },
  async ({ entryId, projectId }) => {
    const chain = await storage.getVersionChain(projectId, entryId);

    if (chain.length === 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Entry not found: ${entryId}` }, null, 2) }]
      };
    }

    if (chain.length === 1) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            message: 'This prompt has no linked versions.',
            entry: {
              id: chain[0].id,
              version: chain[0].version || 1,
              score: chain[0].score,
              prompt: chain[0].prompt,
              date: chain[0].createdAt
            },
            hint: 'To create a new version, use analyze_prompt with parentId set to this entry ID.'
          }, null, 2)
        }]
      };
    }

    const versions = chain.map((e, i) => ({
      version: e.version || i + 1,
      id: e.id,
      score: e.score,
      grade: e.score >= 90 ? 'A' : e.score >= 70 ? 'B' : e.score >= 50 ? 'C' : 'D',
      scoreChange: i > 0 ? e.score - chain[i - 1].score : 0,
      prompt: e.prompt.length > 100 ? e.prompt.slice(0, 100) + '...' : e.prompt,
      date: e.createdAt
    }));

    const first = chain[0];
    const last = chain[chain.length - 1];

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          totalVersions: chain.length,
          improvement: `${first.score} → ${last.score} (${last.score - first.score >= 0 ? '+' : ''}${last.score - first.score}점)`,
          versions
        }, null, 2)
      }]
    };
  }
);

// ─────────────────────────────────────────────
// Tool: visualize_project
// ─────────────────────────────────────────────
server.tool(
  'visualize_project',
  'Generate an HTML dashboard with charts for a project or all projects. Includes score trend line chart, 5-axis radar chart, grade distribution donut, tag statistics bar chart, and recent analysis table. The HTML file is saved to ~/.promptlens/ and can be opened in a browser. When the user says ">> viz" or ">> 시각화", generate a dashboard for the most recently active project.',
  {
    projectId: z.string().optional().describe('Project ID to visualize. If omitted, generates an overview dashboard for all projects.'),
    outputPath: z.string().optional().describe('Custom output file path. Default: ~/.promptlens/dashboard-{projectId}.html')
  },
  async ({ projectId, outputPath }) => {
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');

    const dataDir = path.join(os.homedir(), '.promptlens');
    let html, filePath;

    if (projectId) {
      // Single project dashboard
      const projects = await storage.getProjects();
      const project = projects.find(p => p.id === projectId || p.name === projectId);
      if (!project) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: `Project not found: ${projectId}`, hint: 'Use list_projects to see available projects.' }, null, 2)
          }]
        };
      }
      const entries = await storage.getHistory(project.id);
      if (entries.length === 0) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: `No history entries in project "${project.name}".`, hint: 'Analyze some prompts first with analyze_prompt.' }, null, 2)
          }]
        };
      }
      html = generateDashboardHtml(project, entries);
      filePath = outputPath || path.join(dataDir, `dashboard-${project.id}.html`);
    } else {
      // Overview dashboard for all projects
      const projects = await storage.getProjects();
      if (projects.length === 0) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: 'No projects found.', hint: 'Create a project first with create_project.' }, null, 2)
          }]
        };
      }
      const historyMap = {};
      for (const p of projects) {
        historyMap[p.id] = await storage.getHistory(p.id);
      }
      html = generateOverviewHtml(projects, historyMap);
      filePath = outputPath || path.join(dataDir, 'dashboard-overview.html');
    }

    fs.writeFileSync(filePath, html, 'utf-8');

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          message: 'Dashboard generated',
          filePath,
          hint: `Open in browser: file://${filePath}`
        }, null, 2)
      }]
    };
  }
);

// ─────────────────────────────────────────────
// MCP Prompts (Workflow Presets)
// ─────────────────────────────────────────────

server.prompt(
  'quick-analyze',
  'Quick prompt analysis — paste a prompt and get instant 5-axis scoring with improvement suggestions.',
  [
    { name: 'prompt', description: 'The prompt text to analyze', required: true }
  ],
  async ({ prompt }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `다음 프롬프트를 PromptLens로 분석해줘 (local 모드):\n\n"${prompt}"\n\n5축 점수, 누락 요소, 개선 제안을 보여주고, 개선된 프롬프트도 제안해줘.`
      }
    }]
  })
);

server.prompt(
  'deep-analyze',
  'Deep analysis pipeline — analyze → optimize → save. Runs local analysis, auto-generates an improved version, and saves both to a project for comparison.',
  [
    { name: 'prompt', description: 'The prompt text to analyze', required: true },
    { name: 'project', description: 'Project name to save results', required: false }
  ],
  async ({ prompt, project }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `다음 프롬프트를 PromptLens로 정밀 분석하고 개선해줘:\n\n"${prompt}"\n\n1단계: analyze_prompt로 분석해줘.\n2단계: 분석 결과의 누락 요소를 모두 채운 개선된 프롬프트를 작성해줘.\n3단계: 개선된 프롬프트도 analyze_prompt로 다시 분석해서 점수 변화를 비교해줘.${project ? `\n4단계: 두 결과를 "${project}" 프로젝트에 저장해줘 (개선본은 parentId로 연결).` : ''}`
      }
    }]
  })
);

server.prompt(
  'project-report',
  'Generate a visual dashboard report for a project with score trends, radar charts, and grade distribution.',
  [
    { name: 'project', description: 'Project name or ID', required: true }
  ],
  async ({ project }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `PromptLens의 "${project}" 프로젝트 대시보드를 생성해줘. visualize_project 도구를 사용하여 HTML 리포트를 만들고, 주요 통계(평균 점수, 최고/최저, 개선 추이)를 요약해줘.`
      }
    }]
  })
);

// ─────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
