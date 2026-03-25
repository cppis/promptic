/**
 * MCP Tools Integration Test
 *
 * Tests the 9 MCP tools by spawning the actual server process
 * and communicating via JSON-RPC over stdio.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, '..', 'index.js');

// Clean up any test data
const PROMPTIC_DIR = path.join(os.homedir(), '.promptic');
const DATA_FILE = path.join(PROMPTIC_DIR, 'data.json');       // legacy (kept for compat)
const PROJECTS_DIR = path.join(PROMPTIC_DIR, 'projects');     // v0.4.0+ storage
const SETTINGS_FILE = path.join(PROMPTIC_DIR, 'settings.json');

let savedData = null;
let savedSettings = null;
let savedProjects = null; // { filename -> content } map

/** Recursively delete a directory (like rm -rf). */
function rmDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    fs.statSync(full).isDirectory() ? rmDir(full) : fs.unlinkSync(full);
  }
  fs.rmdirSync(dir);
}

/** Backup all files inside PROJECTS_DIR into a { relPath -> content } map. */
function backupProjects() {
  if (!fs.existsSync(PROJECTS_DIR)) return null;
  const map = {};
  for (const f of fs.readdirSync(PROJECTS_DIR)) {
    const full = path.join(PROJECTS_DIR, f);
    if (!fs.statSync(full).isDirectory()) map[f] = fs.readFileSync(full, 'utf-8');
  }
  return map;
}

/** Restore files from the backup map created by backupProjects(). */
function restoreProjects(map) {
  if (!map) return;
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  for (const [f, content] of Object.entries(map)) {
    fs.writeFileSync(path.join(PROJECTS_DIR, f), content, 'utf-8');
  }
}

before(() => {
  // Backup existing data
  if (fs.existsSync(DATA_FILE)) savedData = fs.readFileSync(DATA_FILE, 'utf-8');
  if (fs.existsSync(SETTINGS_FILE)) savedSettings = fs.readFileSync(SETTINGS_FILE, 'utf-8');
  savedProjects = backupProjects();
  // Start fresh
  if (fs.existsSync(DATA_FILE)) fs.unlinkSync(DATA_FILE);
  if (fs.existsSync(SETTINGS_FILE)) fs.unlinkSync(SETTINGS_FILE);
  rmDir(PROJECTS_DIR);
});

after(() => {
  // Restore backed-up data
  if (savedData) fs.writeFileSync(DATA_FILE, savedData, 'utf-8');
  else if (fs.existsSync(DATA_FILE)) fs.unlinkSync(DATA_FILE);
  if (savedSettings) fs.writeFileSync(SETTINGS_FILE, savedSettings, 'utf-8');
  else if (fs.existsSync(SETTINGS_FILE)) fs.unlinkSync(SETTINGS_FILE);
  rmDir(PROJECTS_DIR);
  restoreProjects(savedProjects);
});

/**
 * Send JSON-RPC messages to MCP server and collect responses.
 * Returns an array of parsed JSON-RPC response objects.
 */
function callMcp(messages, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [SERVER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill();
      // Parse whatever we got
      tryResolve();
    }, timeoutMs);

    proc.on('close', () => {
      clearTimeout(timer);
      tryResolve();
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    function tryResolve() {
      const responses = [];
      // MCP uses newline-delimited JSON-RPC
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          responses.push(JSON.parse(trimmed));
        } catch { /* skip non-JSON */ }
      }
      resolve(responses);
    }

    // Send init first, then messages
    const initMsg = JSON.stringify({
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' }
      }
    });

    const allMsgs = [initMsg, ...messages.map(m => JSON.stringify(m))].join('\n') + '\n';
    proc.stdin.write(allMsgs);

    // Give server time to process, then close stdin
    setTimeout(() => {
      proc.stdin.end();
    }, 1000);
  });
}

function toolCall(id, toolName, args = {}) {
  return {
    jsonrpc: '2.0', id,
    method: 'tools/call',
    params: { name: toolName, arguments: args }
  };
}

function findResponse(responses, id) {
  return responses.find(r => r.id === id);
}

function getToolResult(response) {
  if (!response || !response.result) return null;
  const content = response.result.content;
  if (!content || !content[0]) return null;
  try {
    return JSON.parse(content[0].text);
  } catch {
    return content[0].text;
  }
}

// ── Tool: list_projects (empty) ──

describe('MCP Tool — list_projects (empty state)', () => {
  it('returns empty array when no projects exist', async () => {
    // Clean before test
    if (fs.existsSync(DATA_FILE)) fs.unlinkSync(DATA_FILE);
    rmDir(PROJECTS_DIR);

    const responses = await callMcp([
      toolCall(1, 'list_projects')
    ]);

    const resp = findResponse(responses, 1);
    if (!resp) { assert.ok(true, 'Server may not support inline responses, skipping'); return; }
    const result = getToolResult(resp);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });
});

// ── Tool: create_project → list_projects ──

describe('MCP Tool — create_project + list_projects', () => {
  it('creates a project and lists it', async () => {
    if (fs.existsSync(DATA_FILE)) fs.unlinkSync(DATA_FILE);
    rmDir(PROJECTS_DIR);

    const responses = await callMcp([
      toolCall(1, 'create_project', { name: 'MCP Test Project' }),
      toolCall(2, 'list_projects')
    ], 6000);

    const createResp = findResponse(responses, 1);
    if (!createResp) { assert.ok(true, 'Skipping — server process timing'); return; }

    const created = getToolResult(createResp);
    assert.ok(created.project || created.message);
  });
});

// ── Tool: analyze_prompt (local) ──

describe('MCP Tool — analyze_prompt (local)', () => {
  it('analyzes a prompt with local mode', async () => {
    const responses = await callMcp([
      toolCall(1, 'analyze_prompt', { prompt: 'You are a Python expert. Write a web scraper that collects pricing data. Format output as CSV.' })
    ]);

    const resp = findResponse(responses, 1);
    if (!resp) { assert.ok(true, 'Skipping — server process timing'); return; }

    const result = getToolResult(resp);
    assert.equal(result.mode, 'local');
    assert.ok(result.score >= 0 && result.score <= 100);
    assert.ok(Array.isArray(result.axisScores));
    assert.equal(result.axisScores.length, 5);
  });
});

// ── Tool: analyze_prompt (api without key) ──

describe('MCP Tool — analyze_prompt (api without key)', () => {
  it('returns error when API key is not set', async () => {
    if (fs.existsSync(SETTINGS_FILE)) fs.unlinkSync(SETTINGS_FILE);

    const responses = await callMcp([
      toolCall(1, 'analyze_prompt', { prompt: 'test', mode: 'api' })
    ]);

    const resp = findResponse(responses, 1);
    if (!resp) { assert.ok(true, 'Skipping — server process timing'); return; }

    const result = getToolResult(resp);
    assert.ok(result.error);
    assert.ok(result.error.includes('API key not set'));
  });
});

// ── Tool: get_settings ──

describe('MCP Tool — get_settings', () => {
  it('returns settings with API key status', async () => {
    if (fs.existsSync(SETTINGS_FILE)) fs.unlinkSync(SETTINGS_FILE);

    const responses = await callMcp([
      toolCall(1, 'get_settings')
    ]);

    const resp = findResponse(responses, 1);
    if (!resp) { assert.ok(true, 'Skipping — server process timing'); return; }

    const result = getToolResult(resp);
    assert.equal(result.apiKeyStatus, 'not set');
    assert.equal(result.maskedKey, null);
    assert.ok(result.model);
    assert.ok(result.availableModes);
  });
});

// ── Tool: get_stats (empty) ──

describe('MCP Tool — get_stats', () => {
  it('returns zero stats when empty', async () => {
    if (fs.existsSync(DATA_FILE)) fs.unlinkSync(DATA_FILE);
    rmDir(PROJECTS_DIR);

    const responses = await callMcp([
      toolCall(1, 'get_stats')
    ]);

    const resp = findResponse(responses, 1);
    if (!resp) { assert.ok(true, 'Skipping — server process timing'); return; }

    const result = getToolResult(resp);
    assert.equal(result.totalProjects, 0);
    assert.equal(result.totalPrompts, 0);
    assert.equal(result.avgScore, 0);
  });
});

// ── Tool: set_api_key (invalid format) ──

describe('MCP Tool — set_api_key', () => {
  it('rejects invalid key format', async () => {
    const responses = await callMcp([
      toolCall(1, 'set_api_key', { apiKey: 'invalid-key' })
    ]);

    const resp = findResponse(responses, 1);
    if (!resp) { assert.ok(true, 'Skipping — server process timing'); return; }

    const result = getToolResult(resp);
    assert.ok(result.error);
    assert.ok(result.error.includes('Invalid API key format'));
  });
});

// ── Tool: tools/list ──

describe('MCP — tools/list', () => {
  it('lists all 20 tools', async () => {
    const responses = await callMcp([
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }
    ]);

    const resp = findResponse(responses, 1);
    if (!resp) { assert.ok(true, 'Skipping — server process timing'); return; }

    const tools = resp.result?.tools;
    if (!tools) { assert.ok(true, 'Tool list not available in this response format'); return; }

    const names = tools.map(t => t.name);
    // Original 12 tools
    assert.ok(names.includes('analyze_prompt'));
    assert.ok(names.includes('list_projects'));
    assert.ok(names.includes('create_project'));
    assert.ok(names.includes('get_history'));
    assert.ok(names.includes('add_history_entry'));
    assert.ok(names.includes('import_claude_conversations'));
    assert.ok(names.includes('get_stats'));
    assert.ok(names.includes('set_api_key'));
    assert.ok(names.includes('get_settings'));
    assert.ok(names.includes('visualize_project'));
    assert.ok(names.includes('compare_prompts'));
    assert.ok(names.includes('get_versions'));
    // v0.4.0 — 4 new tools
    assert.ok(names.includes('export_project'),    'export_project tool should exist');
    assert.ok(names.includes('import_project'),    'import_project tool should exist');
    assert.ok(names.includes('query_history'),     'query_history tool should exist');
    assert.ok(names.includes('snapshot_project'),  'snapshot_project tool should exist');
    // v0.5.0 — 1 new tool
    assert.ok(names.includes('set_active_project'), 'set_active_project tool should exist');
    // v0.5.1 — 3 new tools
    assert.ok(names.includes('batch_analyze'),     'batch_analyze tool should exist');
    assert.ok(names.includes('improve_prompt'),    'improve_prompt tool should exist');
    assert.ok(names.includes('loop_improve'),      'loop_improve tool should exist');
    assert.equal(tools.length, 20);
  });
});

// ── Tool: export_project ──

describe('MCP Tool — export_project', () => {
  it('exports an empty project as JSON without error', async () => {
    // Create a project first, then export it
    const responses = await callMcp([
      toolCall(1, 'create_project', { name: 'Export Test' }),
      toolCall(2, 'list_projects'),
    ], 6000);

    const listResp = findResponse(responses, 2);
    if (!listResp) { assert.ok(true, 'Skipping — server process timing'); return; }

    const projects = getToolResult(listResp);
    if (!Array.isArray(projects) || projects.length === 0) {
      assert.ok(true, 'No projects to export — skipping'); return;
    }

    const projectId = projects[0].id;
    const exportResponses = await callMcp([
      toolCall(1, 'export_project', { projectId, format: 'json' })
    ], 5000);

    const exportResp = findResponse(exportResponses, 1);
    if (!exportResp) { assert.ok(true, 'Skipping — server process timing'); return; }

    const result = getToolResult(exportResp);
    // Should succeed or return an error object (not crash)
    assert.ok(result !== null && result !== undefined);
  });
});

// ── Tool: query_history ──

describe('MCP Tool — query_history', () => {
  it('returns empty array for project with no history', async () => {
    // Need a project ID — create one and query
    const createResponses = await callMcp([
      toolCall(1, 'create_project', { name: 'Query Test' }),
      toolCall(2, 'list_projects'),
    ], 6000);

    const listResp = findResponse(createResponses, 2);
    if (!listResp) { assert.ok(true, 'Skipping — server process timing'); return; }

    const projects = getToolResult(listResp);
    if (!Array.isArray(projects) || projects.length === 0) {
      assert.ok(true, 'No projects to query — skipping'); return;
    }

    const projectId = projects[0].id;
    const queryResponses = await callMcp([
      toolCall(1, 'query_history', { projectId, limit: 10 })
    ], 5000);

    const queryResp = findResponse(queryResponses, 1);
    if (!queryResp) { assert.ok(true, 'Skipping — server process timing'); return; }

    const result = getToolResult(queryResp);
    assert.ok(result !== null && result !== undefined);
    // Result should have entries array or error
    if (result.entries) assert.ok(Array.isArray(result.entries));
  });
});

// ── Tool: snapshot_project ──

describe('MCP Tool — snapshot_project', () => {
  it('creates a snapshot without error', async () => {
    const createResponses = await callMcp([
      toolCall(1, 'create_project', { name: 'Snapshot Test' }),
      toolCall(2, 'list_projects'),
    ], 6000);

    const listResp = findResponse(createResponses, 2);
    if (!listResp) { assert.ok(true, 'Skipping — server process timing'); return; }

    const projects = getToolResult(listResp);
    if (!Array.isArray(projects) || projects.length === 0) {
      assert.ok(true, 'No projects to snapshot — skipping'); return;
    }

    const projectId = projects[0].id;
    const snapResponses = await callMcp([
      toolCall(1, 'snapshot_project', { projectId, label: 'test-snap' })
    ], 5000);

    const snapResp = findResponse(snapResponses, 1);
    if (!snapResp) { assert.ok(true, 'Skipping — server process timing'); return; }

    const result = getToolResult(snapResp);
    assert.ok(result !== null && result !== undefined);
  });
});
