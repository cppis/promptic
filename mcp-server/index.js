#!/usr/bin/env node

/**
 * Prompatic MCP Server (v0.5.1)
 *
 * MCP-only architecture — all Prompatic features accessible via
 * Claude Desktop and Claude Code as native MCP tools.
 *
 * Transport: stdio
 * Storage: ~/.prompatic/projects/{id}.json (per-project), ~/.prompatic/settings.json (config)
 *
 * Tools (20):
 *   analyze_prompt          — Prompt quality analysis (local rules or Claude API) + auto-tag
 *   list_projects           — List all projects with stats
 *   create_project          — Create a new project
 *   set_active_project      — Set / clear / get the active project
 *   get_history             — Get prompt history for a project
 *   add_history_entry       — Add a prompt to history
 *   import_claude_conversations — Import Claude Desktop/Code conversations
 *   get_stats               — Overall statistics
 *   set_api_key             — Register Claude API key for API analysis mode
 *   get_settings            — View current settings (API key status, model, etc.)
 *   visualize_project       — Generate HTML dashboard with charts
 *   compare_prompts         — Diff two prompt versions (text, score, axis)
 *   get_versions            — Get version chain for a prompt
 *   export_project          — Export project to JSON/Markdown/CSV file
 *   import_project          — Import a .prompatic.json file into a project
 *   query_history           — Advanced history query with score/date/grade/tag filters
 *   snapshot_project        — Save a timestamped project snapshot + diff between snapshots
 *   batch_analyze           — Analyze multiple prompts at once (v0.5.1)
 *   improve_prompt          — Auto-generate improved prompt from analysis (v0.5.1)
 *   loop_improve            — Repeat improve→analyze until target score reached (v0.5.1)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { Storage, DATA_DIR, EXPORTS_DIR, SNAPSHOTS_DIR } from './lib/storage.js';
import { analyzePrompt, analyzePromptWithApi } from './lib/analyzer.js';
import { importClaudeDesktop, importClaudeCode } from './lib/importer.js';
import { generateDashboardHtml, generateOverviewHtml } from './lib/visualizer.js';
import { compareEntries } from './lib/differ.js';
import { toJson, toMarkdown, toCsv, fromJson } from './lib/exporter.js';
import { filterEntries, sortEntries, summarizeFilter } from './lib/query.js';
import { session } from './lib/session.js';
import { suggestTagsLocal, suggestTagsApi } from './lib/tagger.js';
import { generateImprovedPrompt, runImprovementLoop } from './lib/improver.js';

const storage = new Storage();

const server = new McpServer({
  name: 'prompatic',
  version: '0.5.1'
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
6. Implicit analysis: user pastes a prompt and asks "이거 괜찮아?", "이거 좀 부족한데", "이거 어떻게 개선해?", "what's wrong with this", "how can I improve this".
7. Re-analyze: user ends message with ">> re" or ">> 재분석" or ">> v2". Treat everything before it as the new prompt. Automatically set parentId to the most recent entryId from this session (the last analyze_prompt result). This links the new analysis as a revision of the previous one.
8. Auto-improve: user ends message with ">> fix" or ">> 개선". Call analyze_prompt on the previous entry's prompt, then use the improver to generate an improved version. Show the improved prompt and score delta. If ">> fix+save" or ">> 개선+저장", also save the improved version to history.
9. Improvement loop: user ends message with ">> loop" or ">> loop N" or ">> 루프" or ">> 루프 N". Run the improvement loop: repeatedly improve and re-analyze until the target score N (default 85) is reached or maxIterations (5) is exceeded.`,
  {
    prompt: z.string().describe('The prompt text to analyze'),
    mode: z.enum(['local', 'api']).optional().describe('Analysis mode: "local" (free, rule-based) or "api" (Claude API 3-color report). Default: local'),
    projectId: z.string().optional().describe('Optional project ID to save the analysis to history'),
    tags: z.array(z.string()).optional().describe('Optional tags for the history entry'),
    parentId: z.string().optional().describe('Parent entry ID for version tracking. Links this analysis as a revision of a previous prompt. When using ">> re" or ">> v2" trigger, this is auto-filled with the last entryId from the session.'),
    autoRun: z.boolean().optional().describe('When true (triggered by ">> anz+run" or ">> 분석+실행"), the caller MUST execute the enhancedPrompt immediately after showing the analysis. Do not just display it — run it as a new user request.'),
    autoTag: z.boolean().optional().describe('Enable auto tag suggestion (default: true). Suggests tags based on prompt content.'),
    tagMode: z.enum(['suggest', 'auto']).optional().describe('"suggest" (default): show suggested tags in response only. "auto": automatically apply suggested tags to the history entry.')
  },
  async ({ prompt, mode, projectId, tags, parentId, autoRun, autoTag, tagMode }) => {
    const analysisMode = mode || 'local';
    // projectId가 없으면 활성 프로젝트로 자동 폴백 — entryId를 항상 발급받기 위함
    const effectiveProjectId = projectId || storage.getActiveProject() || null;
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

    // ── 자동 태그 추천 (v0.5.1) ──
    const shouldAutoTag = autoTag !== false; // 기본값 true
    let suggestedTags = [];
    if (shouldAutoTag) {
      if (analysisMode === 'api') {
        const apiKey = storage.getApiKey();
        // api 모드: 의미 기반 태그 (실패 시 local fallback 내장)
        suggestedTags = await suggestTagsApi(prompt, apiKey);
      } else {
        suggestedTags = suggestTagsLocal(prompt);
      }
    }

    // 태그 결합: 사용자 지정 태그 + 자동 태그 (tagMode: "auto" 시)
    const effectiveTagMode = tagMode || 'suggest';
    let entryTags = tags || ['mcp', analysisMode];
    if (effectiveTagMode === 'auto' && suggestedTags.length > 0) {
      // 사용자 태그 + 자동 태그 합산 (중복 제거)
      const tagSet = new Set([...entryTags, ...suggestedTags]);
      entryTags = [...tagSet];
    }

    // Save to history if effectiveProjectId is available (explicit or active project fallback)
    let savedEntry = null;
    if (effectiveProjectId) {
      savedEntry = await storage.addHistoryEntry(effectiveProjectId, {
        prompt,
        enhanced: result.enhancedPrompt || result.enhanced || '',
        score: result.score,
        axisScores: result.axisScores,
        tags: entryTags,
        note: `[MCP ${analysisMode}] ${result.summary}`,
        platform: 'claude',
        parentId: parentId || null
      });
    }

    // ── 세션 컨텍스트 업데이트 (v0.5.1) ──
    if (savedEntry) {
      session.setLastEntry(savedEntry.id, effectiveProjectId);
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

    // 자동 태그 결과 첨부
    if (shouldAutoTag && suggestedTags.length > 0) {
      response.suggestedTags = suggestedTags;
      if (effectiveTagMode === 'auto') {
        response.appliedTags = entryTags;
      }
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
  'List all Prompatic projects with their stats (prompt count, average score, trend).',
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
  'Create a new Prompatic project for organizing prompt history.',
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
    // 세션 컨텍스트 업데이트 (v0.5.1)
    session.setLastEntry(entry.id, projectId);
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
  'Get overall Prompatic statistics: total projects, total prompts, average score, most used tags, score trend.',
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
  'Register or update your Anthropic API key for Claude API analysis mode. The key is stored locally in ~/.prompatic/settings.json. You can also set the preferred model.',
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
  `View current Prompatic settings: API key status, preferred model, active project, storage location.

TRIGGER RULES — call this tool when:
- User says "Prompatic 설정 보여줘" / "show Prompatic settings"
- User says "지금 활성 프로젝트가 뭐야?" / "what is the active project?" / "현재 활성 프로젝트 알려줘"
- User says "현재 설정 확인" / "check current settings"
- User says "API 키 등록됐어?" / "is API key set?"`,
  {},
  async () => {
    const apiKey = storage.getApiKey();
    const model = storage.getModel();
    const activeProjectId = storage.getActiveProject();
    let activeProjectName = null;
    if (activeProjectId) {
      const projects = await storage.getProjects();
      const p = projects.find(p => p.id === activeProjectId);
      activeProjectName = p ? p.name : null;
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          apiKeyStatus: apiKey ? 'registered' : 'not set',
          maskedKey: apiKey ? apiKey.slice(0, 10) + '...' + apiKey.slice(-4) : null,
          model,
          activeProject: activeProjectId
            ? { id: activeProjectId, name: activeProjectName }
            : null,
          storagePath: '~/.prompatic/projects/',
          settingsPath: '~/.prompatic/settings.json',
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
// Tool: set_active_project
// ─────────────────────────────────────────────
server.tool(
  'set_active_project',
  `Set, clear, or get the active project. When an active project is set, analyze_prompt automatically saves results to that project even if no projectId is specified — so you get an entryId every time without repeating the project name.

TRIGGER RULES — call this tool automatically when:

[SET — action: "set"]
- User says "활성 프로젝트를 '프로젝트명'으로 설정해줘" / "set active project to '...'"
- User says "기본 프로젝트를 '프로젝트명'으로 해줘" / "default project: '...'"
- User says "'프로젝트명' 프로젝트로 바꿔줘" / "switch to project '...'"
- User says "'프로젝트명'을 기본으로 써줘" / "use '...' as default project"

[CLEAR — action: "clear"]
- User says "활성 프로젝트 해제해줘" / "clear active project" / "기본 프로젝트 없애줘"
- User says "활성 프로젝트 초기화해줘" / "reset active project"

[GET — action: "get"]
- User says "지금 활성 프로젝트가 뭐야?" / "현재 활성 프로젝트가 뭐야?" / "활성 프로젝트 알려줘"
- User says "what is the active project?" / "which project is active?" / "show active project"
- User says "지금 어떤 프로젝트야?" / "현재 프로젝트 뭐야?" / "기본 프로젝트가 뭐야?"`,
  {
    action:      z.enum(['set', 'clear', 'get']).describe('"set" to assign a project, "clear" to remove, "get" to check current'),
    projectName: z.string().optional().describe('Project name (required for action: "set")')
  },
  async ({ action, projectName }) => {
    if (action === 'get') {
      const id = storage.getActiveProject();
      if (!id) {
        return { content: [{ type: 'text', text: JSON.stringify({ activeProject: null, message: '활성 프로젝트가 설정되지 않았습니다.' }, null, 2) }] };
      }
      const projects = await storage.getProjects();
      const p = projects.find(p => p.id === id);
      return { content: [{ type: 'text', text: JSON.stringify({ activeProject: { id, name: p ? p.name : '(삭제된 프로젝트)' } }, null, 2) }] };
    }

    if (action === 'clear') {
      storage.clearActiveProject();
      return { content: [{ type: 'text', text: JSON.stringify({ message: '활성 프로젝트가 해제되었습니다.' }, null, 2) }] };
    }

    // action === 'set'
    if (!projectName) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'projectName is required for action: "set"' }, null, 2) }] };
    }
    const projects = await storage.getProjects();
    const project = projects.find(p =>
      p.name.toLowerCase() === projectName.toLowerCase() || p.id === projectName
    );
    if (!project) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: `Project "${projectName}" not found.`,
            availableProjects: projects.map(p => ({ id: p.id, name: p.name }))
          }, null, 2)
        }]
      };
    }
    storage.setActiveProject(project.id);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          message: `활성 프로젝트가 "${project.name}"으로 설정되었습니다. 이제 >> 분석 실행 시 자동으로 이 프로젝트에 저장됩니다.`,
          activeProject: { id: project.id, name: project.name }
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
  'Generate an HTML dashboard with charts for a project or all projects. Includes score trend line chart, 5-axis radar chart, grade distribution donut, tag statistics bar chart, and recent analysis table. The HTML file is saved to ~/.prompatic/ and can be opened in a browser. When the user says ">> viz" or ">> 시각화", generate a dashboard for the most recently active project.',
  {
    projectId: z.string().optional().describe('Project ID to visualize. If omitted, generates an overview dashboard for all projects.'),
    outputPath: z.string().optional().describe('Custom output file path. Default: ~/.prompatic/dashboard-{projectId}.html')
  },
  async ({ projectId, outputPath }) => {
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');

    const dataDir = path.join(os.homedir(), '.prompatic');
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
// Tool: export_project
// ─────────────────────────────────────────────
server.tool(
  'export_project',
  'Export a project\'s prompt history to a local file. Formats: "json" (full fidelity, importable), "markdown" (human-readable report), "csv" (spreadsheet). Supports partial export via filter. When the user says "프로젝트를 내보내줘", "export project", or "저장해줘 [format]", call this tool.',
  {
    projectId:  z.string().describe('Project ID to export'),
    format:     z.enum(['json', 'markdown', 'csv']).optional().describe('Export format. Default: json'),
    outputPath: z.string().optional().describe('File save path. Default: ~/.prompatic/exports/{name}-{date}.{ext}'),
    scoreMin:   z.number().optional().describe('Export only entries with score >= this value'),
    scoreMax:   z.number().optional().describe('Export only entries with score <= this value'),
    grade:      z.array(z.enum(['A','B','C','D'])).optional().describe('Export only entries with these grades'),
    dateFrom:   z.string().optional().describe('Export entries from this date (YYYY-MM-DD)'),
    dateTo:     z.string().optional().describe('Export entries up to this date (YYYY-MM-DD)'),
    tags:       z.array(z.string()).optional().describe('Export only entries with ALL these tags')
  },
  async ({ projectId, format = 'json', outputPath, ...filterParams }) => {
    const raw = storage.loadProjectRaw(projectId);
    if (!raw) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: `Project not found: ${projectId}` }, null, 2) }] };
    }

    // Apply filter if any filter params are provided
    const hasFilter = Object.values(filterParams).some(v => v !== undefined);
    const entries   = hasFilter ? filterEntries(raw.history, filterParams) : raw.history;

    // Serialize
    let content;
    let ext;
    if (format === 'markdown') { content = toMarkdown(raw.project, entries); ext = 'md'; }
    else if (format === 'csv') { content = toCsv(raw.project, entries);      ext = 'csv'; }
    else                       { content = toJson(raw.project, entries);      ext = 'prompatic.json'; }

    // Determine output path (restrict to DATA_DIR subtree for security)
    const safeName = raw.project.name.replace(/[^a-zA-Z0-9가-힣_-]/g, '-');
    const dateStr  = new Date().toISOString().slice(0, 10);
    const defaultPath = path.join(EXPORTS_DIR, `${safeName}-${dateStr}.${ext}`);
    let filePath = outputPath || defaultPath;
    // Security: ensure path stays within DATA_DIR
    if (!path.resolve(filePath).startsWith(path.resolve(DATA_DIR))) {
      filePath = defaultPath;
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          message:    'Export complete',
          filePath,
          format,
          entryCount: entries.length,
          totalEntries: raw.history.length,
          filtered:   hasFilter
        }, null, 2)
      }]
    };
  }
);

// ─────────────────────────────────────────────
// Tool: import_project
// ─────────────────────────────────────────────
server.tool(
  'import_project',
  'Import a .prompatic.json file into Prompatic. Two modes: "new" creates a fresh project, "merge" appends entries to an existing project (deduplication by entry ID). When the user says "import", "가져와줘", or references a .prompatic.json file, call this tool.',
  {
    filePath:    z.string().describe('Path to the .prompatic.json file to import'),
    mode:        z.enum(['new', 'merge']).optional().describe('"new" creates a new project (default), "merge" appends to an existing project with the same ID'),
    projectName: z.string().optional().describe('Override project name when using "new" mode')
  },
  async ({ filePath, mode = 'new', projectName }) => {
    if (!fs.existsSync(filePath)) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: `File not found: ${filePath}` }, null, 2) }] };
    }

    let parsed;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      parsed = fromJson(content);
    } catch (err) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }, null, 2) }] };
    }

    const { project: srcProject, history: srcHistory, warnings } = parsed;
    let result;

    if (mode === 'merge') {
      // Merge into existing project with same ID
      const existing = await storage.getHistory(srcProject.id);
      if (existing === null) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: `No project with id "${srcProject.id}" found. Use mode "new" to create it.` }, null, 2) }] };
      }
      const existingIds = new Set(existing.map(e => e.id));
      const toImport    = srcHistory.filter(e => !existingIds.has(e.id));
      for (const entry of toImport) {
        await storage.addHistoryEntry(srcProject.id, entry);
      }
      result = { projectId: srcProject.id, projectName: srcProject.name, mode: 'merge', imported: toImport.length, skipped: srcHistory.length - toImport.length };
    } else {
      // Create new project
      const newProject = await storage.createProject(projectName || srcProject.name);
      for (const entry of srcHistory) {
        await storage.addHistoryEntry(newProject.id, { ...entry, projectId: newProject.id });
      }
      result = { projectId: newProject.id, projectName: newProject.name, mode: 'new', imported: srcHistory.length, skipped: 0 };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ ...result, warnings: warnings || [] }, null, 2)
      }]
    };
  }
);

// ─────────────────────────────────────────────
// Tool: query_history
// ─────────────────────────────────────────────
server.tool(
  'query_history',
  'Advanced history query with filters: score range, grade, date range, tags (AND/OR), missing elements, version roots only. More powerful than get_history. When the user asks to find prompts by score, date, grade, tag, or missing element — e.g. "점수 60점 미만", "이번 달 D등급", "output_format이 누락된 것" — call this tool.',
  {
    projectId:    z.string().describe('Project ID to query'),
    scoreMin:     z.number().optional().describe('Minimum score (inclusive)'),
    scoreMax:     z.number().optional().describe('Maximum score (inclusive)'),
    grade:        z.array(z.enum(['A','B','C','D'])).optional().describe('Filter by grade(s)'),
    dateFrom:     z.string().optional().describe('Start date YYYY-MM-DD (inclusive)'),
    dateTo:       z.string().optional().describe('End date YYYY-MM-DD (inclusive)'),
    tags:         z.array(z.string()).optional().describe('AND tag filter — all tags must be present'),
    tagsAny:      z.array(z.string()).optional().describe('OR tag filter — at least one tag must be present'),
    missing:      z.array(z.string()).optional().describe('Filter entries that include ALL these missing elements'),
    versionsOnly: z.boolean().optional().describe('Return only version-chain root entries (parentId === null)'),
    search:       z.string().optional().describe('Full-text search in prompt and note fields'),
    limit:        z.number().optional().describe('Max results to return. Default: 20'),
    sortBy:       z.enum(['score_asc','score_desc','date_asc','date_desc']).optional().describe('Sort order. Default: date_desc')
  },
  async ({ projectId, limit = 20, sortBy = 'date_desc', ...filterParams }) => {
    const history = await storage.getHistory(projectId);
    if (!history) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: `Project not found: ${projectId}` }, null, 2) }] };
    }

    const matched = filterEntries(history, filterParams);
    const sorted  = sortEntries(matched, sortBy);
    const limited = sorted.slice(0, limit);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          entries:      limited,
          total:        matched.length,
          returned:     limited.length,
          appliedFilter: summarizeFilter(filterParams),
          sortBy
        }, null, 2)
      }]
    };
  }
);

// ─────────────────────────────────────────────
// Tool: snapshot_project
// ─────────────────────────────────────────────
server.tool(
  'snapshot_project',
  'Save a timestamped snapshot of a project\'s current state. Optionally compare with a previous snapshot to show score improvement, grade distribution change, and missing-element trend. When the user says "스냅샷 저장", "snapshot", or "지난 스냅샷과 비교" — call this tool.',
  {
    projectId:   z.string().describe('Project ID to snapshot'),
    label:       z.string().optional().describe('Optional label/description for this snapshot'),
    compareWith: z.string().optional().describe('Filename of a previous snapshot to diff against (e.g. "MyProject-snap-2026-02-01T09-00-00.json")')
  },
  async ({ projectId, label = '', compareWith }) => {
    const raw = storage.loadProjectRaw(projectId);
    if (!raw) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: `Project not found: ${projectId}` }, null, 2) }] };
    }

    // Build snapshot
    const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeName = raw.project.name.replace(/[^a-zA-Z0-9가-힣_-]/g, '-');
    const snapName = `${safeName}-snap-${ts}.json`;
    const snapPath = path.join(SNAPSHOTS_DIR, snapName);

    const snapshot = {
      ...raw,
      meta: {
        ...raw.meta,
        snapshotAt: new Date().toISOString(),
        label
      }
    };
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    fs.writeFileSync(snapPath, JSON.stringify(snapshot, null, 2), 'utf-8');

    const result = {
      message:     'Snapshot saved',
      snapshotPath: snapPath,
      entryCount:  raw.history.length,
      avgScore:    raw.meta?.avgScore ?? 0,
      label
    };

    // Compare with previous snapshot
    if (compareWith) {
      const oldPath = path.join(SNAPSHOTS_DIR, compareWith);
      if (!fs.existsSync(oldPath)) {
        result.diffError = `Snapshot file not found: ${compareWith}`;
      } else {
        try {
          const old = JSON.parse(fs.readFileSync(oldPath, 'utf-8'));
          result.diff = buildSnapshotDiff(old, snapshot);
        } catch (err) {
          result.diffError = `Failed to parse snapshot: ${err.message}`;
        }
      }
    }

    // List available snapshots for this project
    const allSnaps = fs.readdirSync(SNAPSHOTS_DIR)
      .filter(f => f.startsWith(safeName) && f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, 5);
    result.recentSnapshots = allSnaps;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  }
);

// ── Snapshot diff helper ──────────────────────────────────────────────────────
function buildSnapshotDiff(oldSnap, newSnap) {
  const oldH = oldSnap.history || [];
  const newH = newSnap.history || [];

  const oldScores = oldH.map(e => e.score || 0);
  const newScores = newH.map(e => e.score || 0);
  const oldAvg    = oldScores.length ? Math.round(oldScores.reduce((a, b) => a + b, 0) / oldScores.length) : 0;
  const newAvg    = newScores.length ? Math.round(newScores.reduce((a, b) => a + b, 0) / newScores.length) : 0;

  // Grade distribution
  function gradeDist(entries) {
    const d = { A: 0, B: 0, C: 0, D: 0 };
    for (const e of entries) {
      const g = e.grade || (e.score >= 90 ? 'A' : e.score >= 70 ? 'B' : e.score >= 50 ? 'C' : 'D');
      d[g]++;
    }
    return d;
  }
  const oldDist = gradeDist(oldH);
  const newDist = gradeDist(newH);

  // Missing element frequency
  function missingFreq(entries) {
    const f = {};
    for (const e of entries) for (const m of (e.missingElements || [])) f[m] = (f[m] || 0) + 1;
    return f;
  }
  const oldMissing = missingFreq(oldH);
  const newMissing = missingFreq(newH);
  const allMissing = new Set([...Object.keys(oldMissing), ...Object.keys(newMissing)]);
  const missingDiff = {};
  for (const m of allMissing) {
    const oldVal = oldMissing[m] || 0;
    const newVal = newMissing[m] || 0;
    if (oldVal !== newVal) missingDiff[m] = { before: oldVal, after: newVal, delta: newVal - oldVal };
  }

  const oldAt = oldSnap.meta?.snapshotAt || '?';
  const newAt = newSnap.meta?.snapshotAt || new Date().toISOString();

  return {
    period:         { from: oldAt.slice(0, 10), to: newAt.slice(0, 10) },
    entryCount:     { before: oldH.length,  after: newH.length,  delta: newH.length - oldH.length },
    avgScore:       { before: oldAvg,        after: newAvg,       delta: newAvg - oldAvg },
    gradeDistribution: {
      before: oldDist,
      after:  newDist,
      delta:  { A: newDist.A - oldDist.A, B: newDist.B - oldDist.B, C: newDist.C - oldDist.C, D: newDist.D - oldDist.D }
    },
    missingElementChanges: missingDiff,
    summary: `분석 수 ${oldH.length}→${newH.length} (${newH.length - oldH.length >= 0 ? '+' : ''}${newH.length - oldH.length}), 평균 점수 ${oldAvg}→${newAvg} (${newAvg - oldAvg >= 0 ? '+' : ''}${newAvg - oldAvg}점)`
  };
}

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
        text: `다음 프롬프트를 Prompatic로 분석해줘 (local 모드):\n\n"${prompt}"\n\n5축 점수, 누락 요소, 개선 제안을 보여주고, 개선된 프롬프트도 제안해줘.`
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
        text: `다음 프롬프트를 Prompatic로 정밀 분석하고 개선해줘:\n\n"${prompt}"\n\n1단계: analyze_prompt로 분석해줘.\n2단계: 분석 결과의 누락 요소를 모두 채운 개선된 프롬프트를 작성해줘.\n3단계: 개선된 프롬프트도 analyze_prompt로 다시 분석해서 점수 변화를 비교해줘.${project ? `\n4단계: 두 결과를 "${project}" 프로젝트에 저장해줘 (개선본은 parentId로 연결).` : ''}`
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
        text: `Prompatic의 "${project}" 프로젝트 대시보드를 생성해줘. visualize_project 도구를 사용하여 HTML 리포트를 만들고, 주요 통계(평균 점수, 최고/최저, 개선 추이)를 요약해줘.`
      }
    }]
  })
);

// ─────────────────────────────────────────────
// Tool: batch_analyze (v0.5.1)
// ─────────────────────────────────────────────
server.tool(
  'batch_analyze',
  `Analyze multiple prompts at once and return a ranked comparison table. Useful for evaluating prompt candidates or scoring existing prompts in bulk.

TRIGGER RULES — call this tool when:
1. User says "여러 프롬프트 한 번에 분석해줘" or "batch analyze these prompts"
2. User says "후보 프롬프트들 비교해줘" or "compare these prompt candidates"
3. User provides multiple prompts and asks for ranking or comparison`,
  {
    prompts: z.array(z.string()).min(2).max(20).describe('Array of prompt texts to analyze (2-20 prompts)'),
    mode: z.enum(['local', 'api']).optional().describe('Analysis mode: "local" (default) or "api"'),
    projectId: z.string().optional().describe('Project ID to save results'),
    saveAll: z.boolean().optional().describe('Save all results to history (default: false)'),
    tags: z.array(z.string()).optional().describe('Common tags to apply to all entries')
  },
  async ({ prompts, mode, projectId, saveAll, tags }) => {
    const analysisMode = mode || 'local';
    const effectiveProjectId = projectId || storage.getActiveProject() || null;
    const shouldSave = saveAll === true;

    // api 모드: API 키 확인
    if (analysisMode === 'api') {
      const apiKey = storage.getApiKey();
      if (!apiKey) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'API key not set. Use set_api_key tool first, or use mode: "local".',
              hint: 'Run: set_api_key with your Anthropic API key (sk-ant-...)'
            }, null, 2)
          }]
        };
      }
    }

    const results = [];

    if (analysisMode === 'api') {
      // API 모드: 동시 요청 제한 (semaphore 3)
      const apiKey = storage.getApiKey();
      const model = storage.getModel();
      const MAX_CONCURRENT = 3;

      for (let i = 0; i < prompts.length; i += MAX_CONCURRENT) {
        const batch = prompts.slice(i, i + MAX_CONCURRENT);
        const batchResults = await Promise.all(
          batch.map(async (p) => {
            try {
              return await analyzePromptWithApi(p, apiKey, model);
            } catch {
              // API 실패 시 local fallback
              return analyzePrompt(p);
            }
          })
        );
        results.push(...batchResults.map((r, j) => ({ prompt: batch[j], ...r })));
      }
    } else {
      // Local 모드: 순차 처리 (CPU bound)
      for (const p of prompts) {
        const r = analyzePrompt(p);
        results.push({ prompt: p, ...r });
      }
    }

    // 점수 내림차순 정렬
    results.sort((a, b) => b.score - a.score);

    // 히스토리 저장 + entryId 발급
    const entries = [];
    if (shouldSave && effectiveProjectId) {
      for (const r of results) {
        // 자동 태그 추천
        const suggestedTags = suggestTagsLocal(r.prompt);
        const entryTags = new Set([...(tags || ['mcp', analysisMode]), '#batch', ...suggestedTags]);

        const entry = await storage.addHistoryEntry(effectiveProjectId, {
          prompt: r.prompt,
          enhanced: r.enhancedPrompt || r.enhanced || '',
          score: r.score,
          axisScores: r.axisScores,
          tags: [...entryTags],
          note: `[batch ${analysisMode}] ${r.summary || ''}`,
          platform: 'claude'
        });
        entries.push(entry);
        // 마지막 엔트리를 세션에 기록
        session.setLastEntry(entry.id, effectiveProjectId);
      }
    }

    // 결과 테이블 구성
    const table = results.map((r, idx) => ({
      rank: idx + 1,
      score: r.score,
      grade: r.grade,
      entryId: entries[idx]?.id || null,
      promptSummary: r.prompt.length > 60 ? r.prompt.slice(0, 60) + '...' : r.prompt,
      missingElements: r.missingElements || r.missing || []
    }));

    const avgScore = Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length * 10) / 10;

    // api 모드 비용 안내
    const costWarning = analysisMode === 'api'
      ? `⚠️ API 모드: ${prompts.length}건의 API 호출이 발생했습니다.`
      : null;

    const response = {
      totalPrompts: prompts.length,
      averageScore: avgScore,
      bestEntry: table[0],
      table,
      saved: shouldSave,
      ...(costWarning && { costWarning })
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2)
      }]
    };
  }
);

// ─────────────────────────────────────────────
// Tool: improve_prompt (v0.5.1)
// ─────────────────────────────────────────────
server.tool(
  'improve_prompt',
  `Generate an improved version of a previously analyzed prompt based on its analysis results (missingElements, axis scores). The improved version is optionally saved as a new version linked to the original via parentId.

TRIGGER RULES — call this tool when:
1. Command suffix: user ends message with ">> fix" or ">> 개선". Improve the most recent analyzed prompt.
2. Save mode: user ends message with ">> fix+save" or ">> 개선+저장". Improve and save to history.
3. Natural language: "이전 프롬프트 개선해줘", "improve the last prompt", "fix my prompt"`,
  {
    entryId: z.string().optional().describe('Entry ID to improve. If omitted, uses the last analyzed entry from this session.'),
    projectId: z.string().optional().describe('Project ID. If omitted, uses active project.'),
    saveResult: z.boolean().optional().describe('Save the improved prompt to history (default: false). Set true for ">> fix+save".')
  },
  async ({ entryId, projectId, saveResult }) => {
    // entryId 결정: 명시 또는 세션 내 직전 ID
    let targetEntryId;
    try {
      targetEntryId = entryId || session.getLastEntryId();
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: err.message }, null, 2)
        }]
      };
    }

    // 원본 엔트리 조회
    const originalEntry = await storage.findEntryById(targetEntryId);
    if (!originalEntry) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: `Entry not found: ${targetEntryId}` }, null, 2)
        }]
      };
    }

    const effectiveProjectId = projectId || originalEntry.projectId || storage.getActiveProject() || null;

    // 개선 프롬프트 생성
    const apiKey = storage.getApiKey();
    let improvedPrompt;
    try {
      improvedPrompt = await generateImprovedPrompt(originalEntry, apiKey, storage.getModel());
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: `Improvement failed: ${err.message}` }, null, 2)
        }]
      };
    }

    // 개선본 분석 (점수 비교용)
    const improvedAnalysis = analyzePrompt(improvedPrompt);

    const response = {
      originalScore: originalEntry.score,
      originalGrade: originalEntry.grade,
      improvedScore: improvedAnalysis.score,
      improvedGrade: improvedAnalysis.grade,
      scoreDelta: improvedAnalysis.score - originalEntry.score,
      improvedPrompt,
      originalEntryId: targetEntryId,
      changes: {
        resolvedMissing: (originalEntry.missingElements || []).filter(
          m => !(improvedAnalysis.missingElements || improvedAnalysis.missing || []).includes(m)
        ),
        remainingMissing: improvedAnalysis.missingElements || improvedAnalysis.missing || []
      }
    };

    // 저장 모드
    if (saveResult && effectiveProjectId) {
      const savedEntry = await storage.addHistoryEntry(effectiveProjectId, {
        prompt: improvedPrompt,
        enhanced: improvedAnalysis.enhancedPrompt || '',
        score: improvedAnalysis.score,
        axisScores: improvedAnalysis.axisScores,
        tags: [...(originalEntry.tags || []), '#improved'],
        note: `[auto-improve] from ${targetEntryId} (+${response.scoreDelta}pts)`,
        platform: 'claude',
        parentId: targetEntryId
      });
      response.savedEntryId = savedEntry.id;
      response.version = savedEntry.version;
      session.setLastEntry(savedEntry.id, effectiveProjectId);
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
// Tool: loop_improve (v0.5.1)
// ─────────────────────────────────────────────
server.tool(
  'loop_improve',
  `Repeatedly improve and re-analyze a prompt until a target score is reached or max iterations exceeded. Each iteration generates an improved version, analyzes it, and links it via parentId.

TRIGGER RULES — call this tool when:
1. Command suffix: user ends message with ">> loop" or ">> loop N" or ">> 루프" or ">> 루프 N" where N is the target score.
2. Natural language: "목표 90점까지 자동 개선해줘", "keep improving until score 90", "자동 루프 돌려줘"`,
  {
    entryId: z.string().optional().describe('Starting entry ID. If omitted, uses the last analyzed entry from this session.'),
    targetScore: z.number().min(0).max(100).optional().describe('Target score to reach (default: 85)'),
    maxIterations: z.number().min(1).max(10).optional().describe('Maximum improvement iterations (default: 5)'),
    projectId: z.string().optional().describe('Project ID. If omitted, uses active project.')
  },
  async ({ entryId, targetScore, maxIterations, projectId }) => {
    // entryId 결정
    let startEntryId;
    try {
      startEntryId = entryId || session.getLastEntryId();
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: err.message }, null, 2)
        }]
      };
    }

    const effectiveProjectId = projectId || storage.getActiveProject() || null;
    if (!effectiveProjectId) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: '활성 프로젝트가 없습니다. 먼저 프로젝트를 생성하거나 활성 프로젝트를 설정하세요.' }, null, 2)
        }]
      };
    }

    const apiKey = storage.getApiKey();
    const model = storage.getModel();

    try {
      const loopResult = await runImprovementLoop(startEntryId, {
        targetScore: targetScore || 85,
        maxIterations: maxIterations || 5,
        storage,
        analyzePrompt,
        generateImprovedPrompt,
        apiKey,
        model,
        projectId: effectiveProjectId,
        session
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(loopResult, null, 2)
        }]
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: `Improvement loop failed: ${err.message}`,
            hint: 'Check the starting entryId and ensure it exists.'
          }, null, 2)
        }]
      };
    }
  }
);

// ─────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
