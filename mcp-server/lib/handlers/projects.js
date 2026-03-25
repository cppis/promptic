/**
 * 프로젝트 관리 핸들러: list_projects, create_project, set_active_project, snapshot_project
 */
import { readData, writeData, readSettings, writeSettings, generateProjectId, generateSnapshotId } from '../storage.js';
import { setLastProjectId } from '../session.js';

export function listProjects() {
  const data = readData();
  const settings = readSettings();
  const projects = Object.values(data.projects);
  if (projects.length === 0) {
    return '프로젝트가 없습니다. `create_project` 명령으로 새 프로젝트를 만드세요.';
  }

  const lines = ['## 프로젝트 목록\n'];
  for (const p of projects) {
    const entries = Object.values(data.entries).filter(e => e.projectId === p.id);
    const scores = entries.map(e => e.score).filter(s => s != null);
    const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : '-';
    const isActive = settings.activeProject === p.id ? ' ✅ (활성)' : '';
    lines.push(`- **${p.name}**${isActive} \`${p.id}\``);
    lines.push(`  - 프롬프트 수: ${entries.length}  |  평균 점수: ${avgScore}`);
    lines.push(`  - 생성일: ${new Date(p.createdAt).toLocaleString('ko-KR')}`);
  }
  return lines.join('\n');
}

export function createProject({ name }) {
  if (!name || typeof name !== 'string' || name.trim() === '') {
    throw new Error('create_project: name 파라미터가 필요합니다.');
  }
  const data = readData();
  const id = generateProjectId();
  data.projects[id] = {
    id,
    name: name.trim(),
    createdAt: new Date().toISOString(),
  };
  writeData(data);
  return `프로젝트 생성 완료: **${name.trim()}** \`${id}\`\n활성 프로젝트로 설정하려면 \`set_active_project\` 를 사용하세요.`;
}

export function setActiveProject({ action = 'set', projectName }) {
  const settings = readSettings();
  const data = readData();

  if (action === 'get') {
    if (!settings.activeProject) return '현재 활성 프로젝트가 없습니다.';
    const p = data.projects[settings.activeProject];
    return p
      ? `활성 프로젝트: **${p.name}** \`${p.id}\``
      : '활성 프로젝트가 설정되어 있지만 데이터를 찾을 수 없습니다.';
  }

  if (action === 'clear') {
    settings.activeProject = null;
    writeSettings(settings);
    return '활성 프로젝트를 해제했습니다.';
  }

  // action === 'set'
  if (!projectName) throw new Error('set_active_project: projectName 이 필요합니다 (action: "set").');
  const match = Object.values(data.projects).find(
    p => p.name === projectName || p.id === projectName
  );
  if (!match) throw new Error(`set_active_project: 프로젝트 "${projectName}" 을 찾을 수 없습니다.`);
  settings.activeProject = match.id;
  writeSettings(settings);
  setLastProjectId(match.id);
  return `활성 프로젝트 설정 완료: **${match.name}** \`${match.id}\`\n이제 \`analyze_prompt\` 결과가 이 프로젝트에 자동 저장됩니다.`;
}

export function snapshotProject({ projectId, label, compareWith }) {
  const data = readData();
  const settings = readSettings();
  const pid = projectId || settings.activeProject;
  if (!pid) throw new Error('snapshot_project: projectId 또는 활성 프로젝트가 필요합니다.');
  const project = data.projects[pid];
  if (!project) throw new Error(`snapshot_project: 프로젝트 "${pid}" 를 찾을 수 없습니다.`);

  const entries = Object.values(data.entries).filter(e => e.projectId === pid);
  const scores = entries.map(e => e.score).filter(s => s != null);
  const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

  const sid = generateSnapshotId();
  const snapshot = {
    id: sid,
    projectId: pid,
    label: label || `snapshot_${new Date().toISOString().slice(0, 10)}`,
    createdAt: new Date().toISOString(),
    entryCount: entries.length,
    avgScore,
    topGrades: { A: 0, B: 0, C: 0, D: 0 },
  };
  entries.forEach(e => { if (e.grade) snapshot.topGrades[e.grade]++; });

  if (!data.snapshots[pid]) data.snapshots[pid] = {};
  data.snapshots[pid][sid] = snapshot;
  writeData(data);

  let result = `스냅샷 저장 완료: **${snapshot.label}** \`${sid}\`\n`;
  result += `- 프로젝트: ${project.name}\n`;
  result += `- 엔트리 수: ${entries.length}  |  평균 점수: ${avgScore ?? '-'}\n`;
  result += `- 등급 분포: A=${snapshot.topGrades.A} B=${snapshot.topGrades.B} C=${snapshot.topGrades.C} D=${snapshot.topGrades.D}\n`;

  if (compareWith) {
    const prev = data.snapshots[pid]?.[compareWith];
    if (!prev) {
      result += `\n⚠️ 비교 대상 스냅샷 \`${compareWith}\` 를 찾을 수 없습니다.`;
    } else {
      const deltaEntries = entries.length - prev.entryCount;
      const deltaScore = avgScore != null && prev.avgScore != null ? avgScore - prev.avgScore : null;
      result += `\n### 비교: ${prev.label} → ${snapshot.label}\n`;
      result += `- 엔트리 변화: ${prev.entryCount} → ${entries.length} (${deltaEntries >= 0 ? '+' : ''}${deltaEntries})\n`;
      if (deltaScore != null) result += `- 평균 점수 변화: ${prev.avgScore} → ${avgScore} (${deltaScore >= 0 ? '+' : ''}${deltaScore})\n`;
    }
  }
  return result;
}
