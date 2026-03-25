/**
 * 분석 및 평가 핸들러: analyze_prompt, compare_prompts, get_versions
 */
import { readData, writeData, readSettings, generateEntryId } from '../storage.js';
import { analyzeLocal } from '../analyzer.js';
import { getLastEntryId, setLastEntryId } from '../session.js';

/**
 * analyze_prompt
 * mode: 'local' | 'api' | 'deep'  (현재 local만 구현; api/deep은 API 키 필요)
 */
export function analyzePrompt({ prompt, mode = 'local', autoRun = false, parentId, projectId, tags = [], autoTag = true, tagMode = 'suggest' }) {
  if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
    throw new Error('analyze_prompt: prompt 파라미터가 필요합니다.');
  }

  // >> re / >> v2 트리거 처리 — parentId 자동 참조
  let resolvedParentId = parentId;
  const trimmed = prompt.trim();
  const isReTrigger = /^>>\s*(re|재분석|v2)$/i.test(trimmed);
  if (isReTrigger) {
    const lastId = getLastEntryId();
    if (!lastId) return '⚠️ 세션 내 이전 entryId가 없습니다. 먼저 프롬프트를 분석해 주세요.';
    return `직전 entryId \`${lastId}\` 를 parentId로 설정했습니다.\n새 프롬프트를 입력해 주세요 (parentId: ${lastId} 로 자동 연결됩니다).`;
  }

  const settings = readSettings();
  const resolvedProjectId = projectId || settings.activeProject;

  // api / deep 모드이지만 API 키가 없는 경우 → local로 폴백
  if ((mode === 'api' || mode === 'deep') && !settings.apiKey) {
    mode = 'local';
  }

  const analysis = analyzeLocal(prompt);
  const entryId = generateEntryId();
  const now = new Date().toISOString();

  // 태그 처리
  let finalTags = [...(tags || [])];
  if (autoTag) {
    const suggested = analysis.suggestedTags;
    if (tagMode === 'auto') {
      finalTags = [...new Set([...finalTags, ...suggested])];
    }
  }

  const entry = {
    id: entryId,
    prompt,
    score: analysis.totalScore,
    grade: analysis.grade,
    scores: analysis.scores,
    missingElements: analysis.missingElements,
    tags: finalTags,
    suggestedTags: analysis.suggestedTags,
    mode,
    parentId: resolvedParentId || null,
    projectId: resolvedProjectId || null,
    createdAt: now,
  };

  // 프로젝트가 있으면 자동 저장
  const data = readData();
  if (resolvedProjectId && data.projects[resolvedProjectId]) {
    data.entries[entryId] = entry;
    writeData(data);
  }

  setLastEntryId(entryId);

  // ── 결과 포맷팅 ──────────────────────────────────────────
  const bar = (score) => {
    const filled = Math.round(score / 10);
    return '█'.repeat(filled) + '░'.repeat(10 - filled) + ` ${score}`;
  };

  let result = `## 프롬프트 분석 결과\n\n`;
  result += `**종합 점수: ${analysis.totalScore}/100  등급: ${analysis.grade}**\n\n`;
  result += `| 축 | 점수 | 게이지 |\n|---|---|---|\n`;
  result += `| 명확성 (Clarity)       | ${analysis.scores.clarity}  | \`${bar(analysis.scores.clarity)}\` |\n`;
  result += `| 완전성 (Completeness)  | ${analysis.scores.completeness}  | \`${bar(analysis.scores.completeness)}\` |\n`;
  result += `| 구체성 (Specificity)   | ${analysis.scores.specificity}  | \`${bar(analysis.scores.specificity)}\` |\n`;
  result += `| 컨텍스트 (Context)     | ${analysis.scores.context}  | \`${bar(analysis.scores.context)}\` |\n`;
  result += `| 출력형식 (Output Fmt)  | ${analysis.scores.output_format}  | \`${bar(analysis.scores.output_format)}\` |\n\n`;

  if (analysis.missingElements.length > 0) {
    result += `**누락된 요소:**\n`;
    analysis.missingElements.forEach(m => { result += `- ${m}\n`; });
    result += '\n';
  } else {
    result += `✅ 누락된 요소 없음\n\n`;
  }

  if (analysis.suggestedTags.length > 0) {
    result += `**추천 태그:** ${analysis.suggestedTags.join(' ')}\n\n`;
  }

  if (resolvedProjectId && data.projects[resolvedProjectId]) {
    result += `💾 프로젝트 **${data.projects[resolvedProjectId].name}** 에 저장됨\n`;
  } else {
    result += `💡 프로젝트에 저장하려면 \`set_active_project\` 를 먼저 실행하세요.\n`;
  }

  if (resolvedParentId) {
    result += `🔗 버전 체인: \`${resolvedParentId}\` → \`${entryId}\`\n`;
  }

  result += `\nentryId: \`${entryId}\``;
  return result;
}

/**
 * compare_prompts — 두 버전의 텍스트/점수/태그 비교
 */
export function comparePrompts({ entryIdA, entryIdB, projectId }) {
  if (!entryIdA || !entryIdB) throw new Error('compare_prompts: entryIdA, entryIdB 모두 필요합니다.');
  const data = readData();
  const a = data.entries[entryIdA];
  const b = data.entries[entryIdB];
  if (!a) throw new Error(`compare_prompts: entryId \`${entryIdA}\` 를 찾을 수 없습니다.`);
  if (!b) throw new Error(`compare_prompts: entryId \`${entryIdB}\` 를 찾을 수 없습니다.`);

  const delta = b.score - a.score;
  const sign = delta >= 0 ? '+' : '';

  let result = `## 프롬프트 비교\n\n`;
  result += `| 항목 | v1 (\`${entryIdA}\`) | v2 (\`${entryIdB}\`) | 변화 |\n`;
  result += `|---|---|---|---|\n`;
  result += `| 종합 점수 | ${a.score} | ${b.score} | **${sign}${delta}** |\n`;
  result += `| 등급 | ${a.grade} | ${b.grade} | ${a.grade === b.grade ? '동일' : `${a.grade} → ${b.grade}`} |\n`;

  const axes = ['clarity', 'completeness', 'specificity', 'context', 'output_format'];
  const axisNames = { clarity: '명확성', completeness: '완전성', specificity: '구체성', context: '컨텍스트', output_format: '출력형식' };
  for (const ax of axes) {
    const d = (b.scores?.[ax] ?? 0) - (a.scores?.[ax] ?? 0);
    result += `| ${axisNames[ax]} | ${a.scores?.[ax] ?? '-'} | ${b.scores?.[ax] ?? '-'} | ${d >= 0 ? '+' : ''}${d} |\n`;
  }

  result += `\n**누락 요소 변화:**\n`;
  const removedMissing = (a.missingElements || []).filter(m => !(b.missingElements || []).includes(m));
  const addedMissing = (b.missingElements || []).filter(m => !(a.missingElements || []).includes(m));
  if (removedMissing.length > 0) result += `- ✅ 해소됨: ${removedMissing.join(', ')}\n`;
  if (addedMissing.length > 0) result += `- ⚠️ 새로 발생: ${addedMissing.join(', ')}\n`;
  if (removedMissing.length === 0 && addedMissing.length === 0) result += '- 변화 없음\n';

  return result;
}

/**
 * get_versions — 프롬프트의 전체 버전 체인 조회
 */
export function getVersions({ entryId, projectId }) {
  if (!entryId) throw new Error('get_versions: entryId 가 필요합니다.');
  const data = readData();

  // 루트를 찾는다 (parentId가 없는 조상)
  let root = data.entries[entryId];
  if (!root) throw new Error(`get_versions: entryId \`${entryId}\` 를 찾을 수 없습니다.`);
  while (root.parentId && data.entries[root.parentId]) {
    root = data.entries[root.parentId];
  }

  // 루트부터 체인을 BFS로 수집
  const chain = [];
  const queue = [root.id];
  const visited = new Set();
  while (queue.length > 0) {
    const cur = queue.shift();
    if (visited.has(cur)) continue;
    visited.add(cur);
    const entry = data.entries[cur];
    if (entry) {
      chain.push(entry);
      const children = Object.values(data.entries).filter(e => e.parentId === cur);
      children.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      children.forEach(c => queue.push(c.id));
    }
  }

  let result = `## 버전 체인 (총 ${chain.length}개)\n\n`;
  chain.forEach((entry, idx) => {
    const marker = entry.id === entryId ? ' ◀ (현재)' : '';
    result += `### v${idx + 1}${marker}\n`;
    result += `- entryId: \`${entry.id}\`\n`;
    result += `- 점수: ${entry.score}  등급: ${entry.grade}\n`;
    result += `- 날짜: ${new Date(entry.createdAt).toLocaleString('ko-KR')}\n`;
    result += `- 프롬프트: ${entry.prompt.slice(0, 80)}${entry.prompt.length > 80 ? '...' : ''}\n\n`;
  });
  return result;
}
