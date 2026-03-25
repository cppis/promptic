/**
 * Prompatic — File-based storage (v0.4.0)
 *
 * Storage structure:
 *   ~/.prompatic/
 *     settings.json              — API key, model
 *     projects/
 *       _index.json              — project list + stats (fast listing)
 *       {project-id}.json        — per-project data + history
 *     exports/                   — export_project output
 *     snapshots/                 — snapshot_project output
 *     dashboard-*.html           — visualize_project output
 *     data.json.migrated         — legacy backup after migration
 *
 * Migration: on first load, if legacy data.json exists it is split into
 * per-project files and renamed to data.json.migrated.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

export const DATA_DIR      = path.join(os.homedir(), '.prompatic');
const LEGACY_FILE          = path.join(DATA_DIR, 'data.json');
const SETTINGS_FILE        = path.join(DATA_DIR, 'settings.json');
const PROJECTS_DIR         = path.join(DATA_DIR, 'projects');
const INDEX_FILE           = path.join(PROJECTS_DIR, '_index.json');
export const EXPORTS_DIR   = path.join(DATA_DIR, 'exports');
export const SNAPSHOTS_DIR = path.join(DATA_DIR, 'snapshots');

// ── Helpers ──────────────────────────────────────────────────────────────────

function scoreToGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  return 'D';
}

/** Atomic write: write to temp file then rename to avoid partial writes. */
function writeAtomic(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Build the _index entry for a project from its full data. */
function buildIndexEntry(project, history) {
  const scores = history.map(e => e.score).filter(s => typeof s === 'number');
  const avgScore = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0;
  return {
    id:          project.id,
    name:        project.name,
    file:        `${project.id}.json`,
    entryCount:  history.length,
    avgScore,
    createdAt:   project.createdAt,
    updatedAt:   project.updatedAt || project.createdAt
  };
}

/** Enrich a legacy history entry with grade + missingElements if missing. */
function enrichEntry(entry) {
  return {
    ...entry,
    grade:           entry.grade           || scoreToGrade(entry.score || 0),
    missingElements: entry.missingElements || [],
    analysisMode:    entry.analysisMode    || 'local'
  };
}

// ── Storage class ─────────────────────────────────────────────────────────────

export class Storage {
  constructor() {
    this._ensureDirs();
    this._migrateIfNeeded();
  }

  // ── Init ──

  _ensureDirs() {
    for (const dir of [DATA_DIR, PROJECTS_DIR, EXPORTS_DIR, SNAPSHOTS_DIR]) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
  }

  /** One-time migration from legacy data.json to per-project files. */
  _migrateIfNeeded() {
    if (!fileExists(LEGACY_FILE)) return;
    if (fileExists(INDEX_FILE))   return; // already migrated

    let legacy;
    try {
      legacy = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf-8'));
    } catch {
      return; // corrupted legacy — skip
    }

    const projects = legacy.projects || [];
    const historyMap = legacy.history || {};
    const index = { version: '0.4.0', projects: [] };

    for (const project of projects) {
      const rawEntries = historyMap[project.id] || [];
      const history    = rawEntries.map(enrichEntry);
      const projData   = {
        project: { ...project, updatedAt: project.updatedAt || project.createdAt },
        history,
        meta: {
          version:    '0.4.0',
          exportedAt: null,
          entryCount: history.length,
          avgScore:   buildIndexEntry(project, history).avgScore
        }
      };
      writeAtomic(path.join(PROJECTS_DIR, `${project.id}.json`), projData);
      index.projects.push(buildIndexEntry(project, history));
    }

    writeAtomic(INDEX_FILE, index);

    // Rename legacy file as backup
    fs.renameSync(LEGACY_FILE, LEGACY_FILE + '.migrated');
  }

  // ── Index ──

  _loadIndex() {
    if (!fileExists(INDEX_FILE)) return { version: '0.4.0', projects: [] };
    try {
      return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
    } catch {
      return { version: '0.4.0', projects: [] };
    }
  }

  _saveIndex(index) {
    writeAtomic(INDEX_FILE, index);
  }

  // ── Per-project file ──

  _loadProject(projectId) {
    const filePath = path.join(PROJECTS_DIR, `${projectId}.json`);
    if (!fileExists(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return null;
    }
  }

  _saveProject(projectId, data) {
    // Keep meta in sync
    const scores = data.history.map(e => e.score).filter(s => typeof s === 'number');
    data.meta = {
      version:    '0.4.0',
      exportedAt: data.meta?.exportedAt || null,
      entryCount: data.history.length,
      avgScore:   scores.length
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0
    };
    writeAtomic(path.join(PROJECTS_DIR, `${projectId}.json`), data);
  }

  _updateIndexEntry(project, history) {
    const index = this._loadIndex();
    const entry = buildIndexEntry(project, history);
    const idx   = index.projects.findIndex(p => p.id === project.id);
    if (idx >= 0) index.projects[idx] = entry;
    else          index.projects.push(entry);
    this._saveIndex(index);
  }

  // ── Projects ──

  async getProjects() {
    const index = this._loadIndex();
    return index.projects.map(p => ({
      id:           p.id,
      name:         p.name,
      promptCount:  p.entryCount,
      avgScore:     p.avgScore,
      createdAt:    p.createdAt,
      updatedAt:    p.updatedAt
    }));
  }

  async createProject(name) {
    const project = {
      id:        genId('proj'),
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const projData = {
      project,
      history: [],
      meta: { version: '0.4.0', exportedAt: null, entryCount: 0, avgScore: 0 }
    };
    this._saveProject(project.id, projData);
    this._updateIndexEntry(project, []);
    return project;
  }

  async renameProject(id, newName) {
    const data = this._loadProject(id);
    if (!data) return;
    data.project.name      = newName;
    data.project.updatedAt = new Date().toISOString();
    this._saveProject(id, data);
    this._updateIndexEntry(data.project, data.history);
  }

  async deleteProject(id) {
    const filePath = path.join(PROJECTS_DIR, `${id}.json`);
    if (fileExists(filePath)) fs.unlinkSync(filePath);
    const index = this._loadIndex();
    index.projects = index.projects.filter(p => p.id !== id);
    this._saveIndex(index);
  }

  // ── History ──

  async getHistory(projectId) {
    const data = this._loadProject(projectId);
    return data ? data.history : [];
  }

  async addHistoryEntry(projectId, entry) {
    const data = this._loadProject(projectId);
    if (!data) return null;

    const fullEntry = {
      id:             genId('h'),
      projectId,
      prompt:         entry.prompt         || '',
      enhanced:       entry.enhanced       || '',
      score:          entry.score          || 0,
      grade:          scoreToGrade(entry.score || 0),
      axisScores:     entry.axisScores     || [0, 0, 0, 0, 0],
      missingElements:entry.missingElements|| [],
      analysisMode:   entry.analysisMode   || entry.tags?.includes('api') ? 'api' : 'local',
      tags:           entry.tags           || [],
      note:           entry.note           || '',
      platform:       entry.platform       || 'claude',
      parentId:       entry.parentId       || null,
      version:        1,
      createdAt:      entry.createdAt      || new Date().toISOString(),
      updatedAt:      new Date().toISOString()
    };

    // Auto-increment version from parent
    if (fullEntry.parentId) {
      const parent = data.history.find(e => e.id === fullEntry.parentId);
      if (parent) fullEntry.version = (parent.version || 1) + 1;
    }

    data.history.push(fullEntry);
    data.project.updatedAt = new Date().toISOString();
    this._saveProject(projectId, data);
    this._updateIndexEntry(data.project, data.history);
    return fullEntry;
  }

  async updateHistoryEntry(projectId, entryId, updates) {
    const data = this._loadProject(projectId);
    if (!data) return null;
    const entry = data.history.find(e => e.id === entryId);
    if (!entry) return null;
    Object.assign(entry, updates, { updatedAt: new Date().toISOString() });
    if (updates.score !== undefined) entry.grade = scoreToGrade(updates.score);
    this._saveProject(projectId, data);
    return entry;
  }

  async deleteHistoryEntry(projectId, entryId) {
    const data = this._loadProject(projectId);
    if (!data) return;
    data.history = data.history.filter(e => e.id !== entryId);
    this._saveProject(projectId, data);
    this._updateIndexEntry(data.project, data.history);
  }

  // ── Version Chain ──

  async getVersionChain(projectId, entryId) {
    const data = this._loadProject(projectId);
    if (!data) return [];
    const entries = data.history;
    const byId    = new Map(entries.map(e => [e.id, e]));

    let current = byId.get(entryId);
    if (!current) return [];
    while (current.parentId && byId.has(current.parentId)) {
      current = byId.get(current.parentId);
    }

    const chain    = [current];
    const childMap = new Map();
    for (const e of entries) {
      if (e.parentId) childMap.set(e.parentId, [...(childMap.get(e.parentId) || []), e]);
    }
    let node = current;
    while (childMap.has(node.id)) {
      node = childMap.get(node.id)[0];
      chain.push(node);
    }
    return chain;
  }

  async findEntryById(entryId) {
    const index = this._loadIndex();
    for (const idx of index.projects) {
      const data = this._loadProject(idx.id);
      if (!data) continue;
      const entry = data.history.find(e => e.id === entryId);
      if (entry) return { ...entry, projectId: idx.id };
    }
    return null;
  }

  async findLatestInProject(projectId) {
    const history = await this.getHistory(projectId);
    if (history.length === 0) return null;
    return history.reduce((latest, e) =>
      new Date(e.createdAt) > new Date(latest.createdAt) ? e : latest
    );
  }

  /** Load raw project file (used by exporter, snapshot tools). */
  loadProjectRaw(projectId) {
    return this._loadProject(projectId);
  }

  // ── Settings ──

  getSettings() {
    if (fileExists(SETTINGS_FILE)) {
      try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')); }
      catch { return {}; }
    }
    return {};
  }

  saveSettings(settings) {
    const merged = { ...this.getSettings(), ...settings };
    writeAtomic(SETTINGS_FILE, merged);
    return merged;
  }

  getApiKey()      { return this.getSettings().apiKey || null; }
  setApiKey(k)     { this.saveSettings({ apiKey: k }); }
  removeApiKey()   { const s = this.getSettings(); delete s.apiKey; writeAtomic(SETTINGS_FILE, s); }
  getModel()       { return this.getSettings().model || 'claude-sonnet-4-5-20250514'; }
  setModel(m)      { this.saveSettings({ model: m }); }

  // 활성 프로젝트 — projectId를 지정하지 않아도 자동으로 저장할 대상 프로젝트
  getActiveProject() { return this.getSettings().activeProjectId || null; }
  setActiveProject(projectId) { this.saveSettings({ activeProjectId: projectId }); }
  clearActiveProject() {
    const s = this.getSettings();
    delete s.activeProjectId;
    writeAtomic(SETTINGS_FILE, s);
  }
}
