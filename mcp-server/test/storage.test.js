/**
 * Storage tests (v0.4.0 — per-project file storage)
 *
 * Uses a TestStorage subclass that overrides ALL private file-I/O methods
 * to point at a temporary directory, keeping the real ~/.promptic untouched.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ── Temp directory setup ─────────────────────────────────────────────────────

const TEST_BASE = path.join(os.tmpdir(), `.promptic-test-${Date.now()}`);
const TEST_PROJECTS = path.join(TEST_BASE, 'projects');
const TEST_EXPORTS  = path.join(TEST_BASE, 'exports');
const TEST_SNAPS    = path.join(TEST_BASE, 'snapshots');
const TEST_SETTINGS = path.join(TEST_BASE, 'settings.json');
const TEST_INDEX    = path.join(TEST_PROJECTS, '_index.json');

let Storage;

before(async () => {
  fs.mkdirSync(TEST_BASE, { recursive: true });
  const mod = await import('../lib/storage.js');

  // Subclass that redirects every private I/O method to TEST_BASE
  Storage = class TestStorage extends mod.Storage {
    // Skip actual dir creation & migration — we'll manage the test dir ourselves
    _ensureDirs() {
      for (const d of [TEST_BASE, TEST_PROJECTS, TEST_EXPORTS, TEST_SNAPS]) {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      }
    }

    _migrateIfNeeded() { /* no-op — no legacy file in test env */ }

    // ── Index ──
    _loadIndex() {
      if (!fs.existsSync(TEST_INDEX)) return { version: '0.4.0', projects: [] };
      try { return JSON.parse(fs.readFileSync(TEST_INDEX, 'utf-8')); }
      catch { return { version: '0.4.0', projects: [] }; }
    }
    _saveIndex(index) {
      fs.writeFileSync(TEST_INDEX, JSON.stringify(index, null, 2), 'utf-8');
    }

    // ── Per-project file ──
    _loadProject(projectId) {
      const fp = path.join(TEST_PROJECTS, `${projectId}.json`);
      if (!fs.existsSync(fp)) return null;
      try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); }
      catch { return null; }
    }
    _saveProject(projectId, data) {
      // Keep meta in sync (mirrors real _saveProject logic)
      const scores = data.history.map(e => e.score).filter(s => typeof s === 'number');
      data.meta = {
        version:    '0.4.0',
        exportedAt: data.meta?.exportedAt || null,
        entryCount: data.history.length,
        avgScore:   scores.length
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : 0
      };
      fs.writeFileSync(
        path.join(TEST_PROJECTS, `${projectId}.json`),
        JSON.stringify(data, null, 2),
        'utf-8'
      );
    }

    // ── Settings ──
    getSettings() {
      if (fs.existsSync(TEST_SETTINGS)) {
        try { return JSON.parse(fs.readFileSync(TEST_SETTINGS, 'utf-8')); }
        catch { return {}; }
      }
      return {};
    }
    saveSettings(settings) {
      const merged = { ...this.getSettings(), ...settings };
      fs.writeFileSync(TEST_SETTINGS, JSON.stringify(merged, null, 2), 'utf-8');
      return merged;
    }
    // deleteProject uses module-level PROJECTS_DIR directly — override it
    async deleteProject(id) {
      const fp = path.join(TEST_PROJECTS, `${id}.json`);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      const index = this._loadIndex();
      index.projects = index.projects.filter(p => p.id !== id);
      this._saveIndex(index);
    }

    getApiKey()    { return this.getSettings().apiKey || null; }
    setApiKey(k)   { this.saveSettings({ apiKey: k }); }
    removeApiKey() {
      const s = this.getSettings();
      delete s.apiKey;
      fs.writeFileSync(TEST_SETTINGS, JSON.stringify(s, null, 2), 'utf-8');
    }
    getModel()     { return this.getSettings().model || 'claude-sonnet-4-5-20250514'; }
    setModel(m)    { this.saveSettings({ model: m }); }

    getActiveProject()     { return this.getSettings().activeProjectId || null; }
    setActiveProject(id)   { this.saveSettings({ activeProjectId: id }); }
    clearActiveProject()   {
      const s = this.getSettings();
      delete s.activeProjectId;
      fs.writeFileSync(TEST_SETTINGS, JSON.stringify(s, null, 2), 'utf-8');
    }
  };
});

after(() => {
  fs.rmSync(TEST_BASE, { recursive: true, force: true });
});

beforeEach(() => {
  // Wipe all per-project files and index between tests
  if (fs.existsSync(TEST_PROJECTS)) {
    for (const f of fs.readdirSync(TEST_PROJECTS)) {
      fs.unlinkSync(path.join(TEST_PROJECTS, f));
    }
  }
  if (fs.existsSync(TEST_SETTINGS)) fs.unlinkSync(TEST_SETTINGS);
});

// ── Projects ─────────────────────────────────────────────────────────────────

describe('Storage — Projects', () => {
  it('starts with empty project list', async () => {
    const s = new Storage();
    const projects = await s.getProjects();
    assert.deepEqual(projects, []);
  });

  it('creates a project with id and name', async () => {
    const s = new Storage();
    const p = await s.createProject('Test Project');
    assert.ok(p.id.startsWith('proj_'));
    assert.equal(p.name, 'Test Project');
    assert.ok(p.createdAt);
  });

  it('lists created projects', async () => {
    const s = new Storage();
    await s.createProject('A');
    await s.createProject('B');
    const projects = await s.getProjects();
    assert.equal(projects.length, 2);
    const names = projects.map(p => p.name);
    assert.ok(names.includes('A'));
    assert.ok(names.includes('B'));
  });

  it('renames a project', async () => {
    const s = new Storage();
    const p = await s.createProject('Old Name');
    await s.renameProject(p.id, 'New Name');
    const projects = await s.getProjects();
    assert.equal(projects[0].name, 'New Name');
  });

  it('deletes a project and its history', async () => {
    const s = new Storage();
    const p = await s.createProject('To Delete');
    await s.addHistoryEntry(p.id, { prompt: 'test prompt for deletion' });
    await s.deleteProject(p.id);
    const projects = await s.getProjects();
    assert.equal(projects.length, 0);
    const history = await s.getHistory(p.id);
    assert.deepEqual(history, []);
  });
});

// ── History ───────────────────────────────────────────────────────────────────

describe('Storage — History', () => {
  it('adds a history entry with all fields', async () => {
    const s = new Storage();
    const p = await s.createProject('Hist Test');
    const entry = await s.addHistoryEntry(p.id, {
      prompt:     'React로 로그인 폼 만들어줘',
      enhanced:   'enhanced version',
      score:      72,
      axisScores: [80, 60, 70, 75, 65],
      tags:       ['react', 'login'],
      note:       'test note',
      platform:   'claude'
    });

    assert.ok(entry.id.startsWith('h_'));
    assert.equal(entry.prompt, 'React로 로그인 폼 만들어줘');
    assert.equal(entry.score, 72);
    assert.deepEqual(entry.tags, ['react', 'login']);
    assert.ok(entry.createdAt);
    assert.ok(entry.updatedAt);
  });

  it('increments project promptCount on add', async () => {
    const s = new Storage();
    const p = await s.createProject('Count Test');
    await s.addHistoryEntry(p.id, { prompt: 'one' });
    await s.addHistoryEntry(p.id, { prompt: 'two' });
    // promptCount is stored as entryCount in index → exposed as promptCount
    const projects = await s.getProjects();
    const found = projects.find(pr => pr.id === p.id);
    assert.equal(found.promptCount, 2);
  });

  it('returns history for a project', async () => {
    const s = new Storage();
    const p = await s.createProject('Get Test');
    await s.addHistoryEntry(p.id, { prompt: 'first' });
    await s.addHistoryEntry(p.id, { prompt: 'second' });
    const entries = await s.getHistory(p.id);
    assert.equal(entries.length, 2);
  });

  it('returns empty array for unknown project', async () => {
    const s = new Storage();
    const entries = await s.getHistory('nonexistent');
    assert.deepEqual(entries, []);
  });

  it('updates a history entry', async () => {
    const s = new Storage();
    const p = await s.createProject('Update Test');
    const entry = await s.addHistoryEntry(p.id, { prompt: 'original', score: 50 });
    const updated = await s.updateHistoryEntry(p.id, entry.id, { score: 90, note: 'updated' });
    assert.equal(updated.score, 90);
    assert.equal(updated.note, 'updated');
    assert.equal(updated.prompt, 'original'); // unchanged
  });

  it('deletes a history entry and decrements promptCount', async () => {
    const s = new Storage();
    const p = await s.createProject('Delete Test');
    const e1 = await s.addHistoryEntry(p.id, { prompt: 'keep' });
    const e2 = await s.addHistoryEntry(p.id, { prompt: 'remove' });
    await s.deleteHistoryEntry(p.id, e2.id);
    const entries = await s.getHistory(p.id);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].prompt, 'keep');
    const projects = await s.getProjects();
    const found = projects.find(pr => pr.id === p.id);
    assert.equal(found.promptCount, 1);
  });

  it('fills default values for missing fields', async () => {
    const s = new Storage();
    const p = await s.createProject('Default Test');
    const entry = await s.addHistoryEntry(p.id, { prompt: 'minimal' });
    assert.equal(entry.enhanced, '');
    assert.equal(entry.score, 0);
    assert.deepEqual(entry.axisScores, [0, 0, 0, 0, 0]);
    assert.deepEqual(entry.tags, []);
    assert.equal(entry.note, '');
    assert.equal(entry.platform, 'claude');
  });

  it('assigns grade to history entry', async () => {
    const s = new Storage();
    const p = await s.createProject('Grade Test');
    const entryA = await s.addHistoryEntry(p.id, { prompt: 'high', score: 95 });
    const entryD = await s.addHistoryEntry(p.id, { prompt: 'low',  score: 30 });
    assert.equal(entryA.grade, 'A');
    assert.equal(entryD.grade, 'D');
  });
});

// ── Version chain ──────────────────────────────────────────────────────────────

describe('Storage — Version Chain', () => {
  it('auto-increments version from parent', async () => {
    const s = new Storage();
    const p = await s.createProject('Version Test');
    const v1 = await s.addHistoryEntry(p.id, { prompt: 'v1' });
    const v2 = await s.addHistoryEntry(p.id, { prompt: 'v2', parentId: v1.id });
    assert.equal(v1.version, 1);
    assert.equal(v2.version, 2);
  });

  it('getVersionChain returns ordered chain', async () => {
    const s = new Storage();
    const p  = await s.createProject('Chain Test');
    const v1 = await s.addHistoryEntry(p.id, { prompt: 'v1' });
    const v2 = await s.addHistoryEntry(p.id, { prompt: 'v2', parentId: v1.id });
    const chain = await s.getVersionChain(p.id, v2.id);
    assert.equal(chain.length, 2);
    assert.equal(chain[0].id, v1.id);
    assert.equal(chain[1].id, v2.id);
  });
});

// ── Settings ──────────────────────────────────────────────────────────────────

describe('Storage — Settings', () => {
  it('returns empty settings initially', () => {
    const s = new Storage();
    assert.deepEqual(s.getSettings(), {});
  });

  it('saves and retrieves settings', () => {
    const s = new Storage();
    s.saveSettings({ theme: 'dark', language: 'ko' });
    const settings = s.getSettings();
    assert.equal(settings.theme, 'dark');
    assert.equal(settings.language, 'ko');
  });

  it('merges settings on save', () => {
    const s = new Storage();
    s.saveSettings({ a: 1 });
    s.saveSettings({ b: 2 });
    const settings = s.getSettings();
    assert.equal(settings.a, 1);
    assert.equal(settings.b, 2);
  });

  it('manages API key', () => {
    const s = new Storage();
    assert.equal(s.getApiKey(), null);
    s.setApiKey('sk-ant-test-key');
    assert.equal(s.getApiKey(), 'sk-ant-test-key');
    s.removeApiKey();
    assert.equal(s.getApiKey(), null);
  });

  it('manages model with default', () => {
    const s = new Storage();
    assert.equal(s.getModel(), 'claude-sonnet-4-5-20250514');
    s.setModel('claude-3-5-haiku-20241022');
    assert.equal(s.getModel(), 'claude-3-5-haiku-20241022');
  });

  it('manages active project (set / get / clear)', async () => {
    const s = new Storage();
    assert.equal(s.getActiveProject(), null);

    const p = await s.createProject('ActiveTest');
    s.setActiveProject(p.id);
    assert.equal(s.getActiveProject(), p.id);

    s.clearActiveProject();
    assert.equal(s.getActiveProject(), null);
  });
});

// ── Persistence ───────────────────────────────────────────────────────────────

describe('Storage — Persistence', () => {
  it('persists data across instances', async () => {
    const s1 = new Storage();
    const p = await s1.createProject('Persist');
    await s1.addHistoryEntry(p.id, { prompt: 'saved prompt', score: 88 });

    const s2 = new Storage();
    const projects = await s2.getProjects();
    assert.equal(projects.length, 1);
    assert.equal(projects[0].name, 'Persist');
    const entries = await s2.getHistory(p.id);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].score, 88);
  });

  it('persists settings across instances', () => {
    const s1 = new Storage();
    s1.setApiKey('sk-ant-persist-key');
    const s2 = new Storage();
    assert.equal(s2.getApiKey(), 'sk-ant-persist-key');
  });
});
