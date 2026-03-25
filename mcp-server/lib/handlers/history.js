/**
 * 히스토리 관리 핸들러: add_history_entry, get_history, query_history
 */
import { readData, writeData, readSettings, generateEntryId } from '../storage.js';
import { analyzeLocal } from '../analyzer.js';
import { setLastEntryId } from '../session.js';

export function addHistoryEntry({ projectId, prompt, score, tags = [], note }) {
  if (!prompt) throw new Error('add_history_entry: prompt 가 필요합니다.');
  const settings = readSettings();
  const data = readData();
  const resolvedProjectId = projectId || settings.activeProject;
  if (!resolvedProjectId) throw new Error('add_history_entry: projectId 또는 활성 프로젝트가 필요합니다.');
  if (!data.projects[resolvedProjectId]) throw new Error(`add_history_entry: 프로젝트 "${resolvedProjectId}" 를 찾을 수 없습니다.`);

  const analysis = analyzeLocal(prompt);
  const entryId = generateEntryId();
  const entry = {
    id: entryId,
    prompt,
    score: score != null ? score : analysis.totalScore,
    grade: score != null ? (score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D') : analysis.grade,
    scores: analysis.scores,
    missingElements: analysis.missingElements,
    suggestedTags: analysis.suggestedTags,
    tags,
    note: note || null,
    projectId: resolvedProjectId,
    createdAt: new Date().toISOString(),
  };
  data.entries[entryId] = entry;
  writeData(data);
  setLastEntryId(entryId);

  return `히스토리 추가 완료\n- 점수: ${entry.score}  등급: ${entry.grade}\n- 프로젝트: ${data.projects[resolvedProjectId].name}\nentryId: \`${entryId}\``;
}

export function getHistory({ projectId, limit = 20, pageToken, search } = {}) {
  const data = readData();
  const settings = readSettings();
  const resolvedProjectId = projectId || settings.activeProject;

  let entries = Object.values(data.entries);
  if (resolvedProjectId) entries = entries.filter(e => e.projectId === resolvedProjectId);
  if (search) {
    const q = search.toLowerCase();
    entries = entries.filter(e => e.prompt.toLowerCase().includes(q) || (e.tags || []).some(t => t.toLowerCase().includes(q)));
  }

  // 날짜 내림차순 정렬
  entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // 페이지네이션
  const startIdx = pageToken ? parseInt(pageToken, 10) : 0;
  const page = entries.slice(startIdx, startIdx + limit);
  const nextToken = startIdx + limit < entries.length ? String(startIdx + limit) : null;

  if (page.length === 0) return '히스토리가 없습니다.';

  let result = `## 히스토리 (${page.length}/${entries.length}개)\n\n`;
  page.forEach(e => {
    result += `- \`${e.id}\`  점수: **${e.score}** (${e.grade})  ${new Date(e.createdAt).toLocaleString('ko-KR')}\n`;
    result += `  ${e.prompt.slice(0, 60)}${e.prompt.length > 60 ? '...' : ''}\n`;
    if (e.tags?.length > 0) result += `  태그: ${e.tags.join(' ')}\n`;
  });
  if (nextToken) result += `\n다음 페이지: pageToken="${nextToken}"`;
  return result;
}

export function queryHistory({ projectId, limit = 20, scoreMin, scoreMax, grade, tags = [], dateFrom, dateTo, search, sortBy = 'date', missing } = {}) {
  const data = readData();
  const settings = readSettings();
  const resolvedProjectId = projectId || settings.activeProject;

  let entries = Object.values(data.entries);
  if (resolvedProjectId) entries = entries.filter(e => e.projectId === resolvedProjectId);
  if (scoreMin != null) entries = entries.filter(e => e.score >= scoreMin);
  if (scoreMax != null) entries = entries.filter(e => e.score <= scoreMax);
  if (grade)            entries = entries.filter(e => e.grade === grade.toUpperCase());
  if (dateFrom)         entries = entries.filter(e => new Date(e.createdAt) >= new Date(dateFrom));
  if (dateTo)           entries = entries.filter(e => new Date(e.createdAt) <= new Date(dateTo));
  if (tags.length > 0)  entries = entries.filter(e => tags.every(t => (e.tags || []).includes(t)));
  if (missing)          entries = entries.filter(e => (e.missingElements || []).some(m => m.includes(missing)));
  if (search) {
    const q = search.toLowerCase();
    entries = entries.filter(e => e.prompt.toLowerCase().includes(q));
  }

  // 정렬
  if (sortBy === 'score') entries.sort((a, b) => b.score - a.score);
  else entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const page = entries.slice(0, limit);
  if (page.length === 0) return '조건에 맞는 히스토리가 없습니다.';

  let result = `## 검색 결과 (${page.length}/${entries.length}개)\n\n`;
  page.forEach(e => {
    result += `- \`${e.id}\`  **${e.score}** (${e.grade})  ${new Date(e.createdAt).toLocaleString('ko-KR')}\n`;
    result += `  ${e.prompt.slice(0, 60)}${e.prompt.length > 60 ? '...' : ''}\n`;
  });
  return result;
}
