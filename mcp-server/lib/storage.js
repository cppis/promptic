/**
 * PromptLens — File-based storage
 * Stores data in ~/.promptlens/data.json
 * Settings (including API key) in ~/.promptlens/settings.json
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const DATA_DIR = path.join(os.homedir(), '.promptlens');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

export class Storage {
  constructor() {
    this._ensureDir();
    this._data = this._load();
  }

  _ensureDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  _load() {
    if (fs.existsSync(DATA_FILE)) {
      try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      } catch {
        return { projects: [], history: {} };
      }
    }
    return { projects: [], history: {} };
  }

  _save() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(this._data, null, 2), 'utf-8');
  }

  _genId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // ── Projects ──

  async getProjects() {
    return this._data.projects || [];
  }

  async createProject(name) {
    const project = {
      id: this._genId('proj'),
      name,
      promptCount: 0,
      createdAt: new Date().toISOString()
    };
    this._data.projects.push(project);
    this._data.history[project.id] = [];
    this._save();
    return project;
  }

  async renameProject(id, newName) {
    const proj = this._data.projects.find(p => p.id === id);
    if (proj) { proj.name = newName; this._save(); }
  }

  async deleteProject(id) {
    this._data.projects = this._data.projects.filter(p => p.id !== id);
    delete this._data.history[id];
    this._save();
  }

  // ── History ──

  async getHistory(projectId) {
    return this._data.history[projectId] || [];
  }

  async addHistoryEntry(projectId, entry) {
    if (!this._data.history[projectId]) {
      this._data.history[projectId] = [];
    }

    const fullEntry = {
      id: this._genId('h'),
      projectId,
      prompt: entry.prompt || '',
      enhanced: entry.enhanced || '',
      score: entry.score || 0,
      axisScores: entry.axisScores || [0, 0, 0, 0, 0],
      tags: entry.tags || [],
      note: entry.note || '',
      platform: entry.platform || 'claude',
      parentId: entry.parentId || null,
      version: 1,
      createdAt: entry.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Auto-increment version if parentId is set
    if (fullEntry.parentId) {
      const parent = (this._data.history[projectId] || []).find(e => e.id === fullEntry.parentId);
      if (parent) {
        fullEntry.version = (parent.version || 1) + 1;
      }
    }

    this._data.history[projectId].push(fullEntry);

    // Update project promptCount
    const proj = this._data.projects.find(p => p.id === projectId);
    if (proj) {
      proj.promptCount = this._data.history[projectId].length;
    }

    this._save();
    return fullEntry;
  }

  async updateHistoryEntry(projectId, entryId, updates) {
    const entries = this._data.history[projectId];
    if (!entries) return null;
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return null;
    Object.assign(entry, updates, { updatedAt: new Date().toISOString() });
    this._save();
    return entry;
  }

  async deleteHistoryEntry(projectId, entryId) {
    if (!this._data.history[projectId]) return;
    this._data.history[projectId] = this._data.history[projectId].filter(e => e.id !== entryId);
    const proj = this._data.projects.find(p => p.id === projectId);
    if (proj) {
      proj.promptCount = this._data.history[projectId].length;
    }
    this._save();
  }

  // ── Version Chain ──

  async getVersionChain(projectId, entryId) {
    const entries = this._data.history[projectId] || [];
    const byId = new Map(entries.map(e => [e.id, e]));

    // Find root by walking up parentId
    let current = byId.get(entryId);
    if (!current) return [];
    while (current.parentId && byId.has(current.parentId)) {
      current = byId.get(current.parentId);
    }
    const rootId = current.id;

    // Collect chain from root downward
    const chain = [current];
    const childMap = new Map();
    for (const e of entries) {
      if (e.parentId) {
        childMap.set(e.parentId, [...(childMap.get(e.parentId) || []), e]);
      }
    }
    let node = current;
    while (childMap.has(node.id)) {
      const children = childMap.get(node.id);
      // Pick the child in the same version lineage (first match)
      node = children[0];
      chain.push(node);
    }
    return chain;
  }

  async findEntryById(entryId) {
    for (const [projectId, entries] of Object.entries(this._data.history)) {
      const entry = entries.find(e => e.id === entryId);
      if (entry) return { ...entry, projectId };
    }
    return null;
  }

  async findLatestInProject(projectId) {
    const entries = this._data.history[projectId] || [];
    if (entries.length === 0) return null;
    return entries.reduce((latest, e) =>
      new Date(e.createdAt) > new Date(latest.createdAt) ? e : latest
    );
  }

  // ── Settings ──

  getSettings() {
    if (fs.existsSync(SETTINGS_FILE)) {
      try {
        return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      } catch {
        return {};
      }
    }
    return {};
  }

  saveSettings(settings) {
    const current = this.getSettings();
    const merged = { ...current, ...settings };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf-8');
    return merged;
  }

  getApiKey() {
    const settings = this.getSettings();
    return settings.apiKey || null;
  }

  setApiKey(apiKey) {
    this.saveSettings({ apiKey });
  }

  removeApiKey() {
    const settings = this.getSettings();
    delete settings.apiKey;
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
  }

  getModel() {
    const settings = this.getSettings();
    return settings.model || 'claude-sonnet-4-5-20250514';
  }

  setModel(model) {
    this.saveSettings({ model });
  }
}
