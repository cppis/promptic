/**
 * 파일 기반 JSON 스토리지.
 * 데이터는 ~/.promptic/data.json 에 저장된다.
 * MCP 서버 재시작 후에도 데이터가 유지된다.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

const DATA_DIR = path.join(os.homedir(), '.promptic');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readData() {
  ensureDir();
  if (!fs.existsSync(DATA_FILE)) {
    return { projects: {}, entries: {}, snapshots: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return { projects: {}, entries: {}, snapshots: {} };
  }
}

function writeData(data) {
  ensureDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function readSettings() {
  ensureDir();
  if (!fs.existsSync(SETTINGS_FILE)) {
    return { apiKey: null, model: 'claude-haiku-4-5-20251001', activeProject: null, dataDir: DATA_DIR };
  }
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
  } catch {
    return { apiKey: null, model: 'claude-haiku-4-5-20251001', activeProject: null, dataDir: DATA_DIR };
  }
}

function writeSettings(settings) {
  ensureDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

// entryId 생성: h_{10hex}_{6hex}
function generateEntryId() {
  const rand = () => Math.random().toString(16).slice(2);
  return `h_${rand().slice(0, 10)}_${rand().slice(0, 6)}`;
}

// projectId 생성: p_{8hex}
function generateProjectId() {
  return `p_${Math.random().toString(16).slice(2, 10)}`;
}

// snapshotId 생성: s_{8hex}
function generateSnapshotId() {
  return `s_${Math.random().toString(16).slice(2, 10)}`;
}

export {
  readData, writeData,
  readSettings, writeSettings,
  generateEntryId, generateProjectId, generateSnapshotId,
  DATA_DIR
};
