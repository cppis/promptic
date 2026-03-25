/**
 * 설정 및 통계 핸들러: get_settings, set_api_key, get_stats
 */
import { readSettings, writeSettings, readData, DATA_DIR } from '../storage.js';

export function getSettings() {
  const settings = readSettings();
  const data = readData();
  const activeProject = settings.activeProject
    ? data.projects[settings.activeProject]?.name ?? settings.activeProject
    : '없음';

  const masked = settings.apiKey
    ? `${settings.apiKey.slice(0, 8)}...${settings.apiKey.slice(-4)} (설정됨)`
    : '미설정 (local 모드만 사용 가능)';

  return [
    '## 현재 설정',
    `- **API 키:** ${masked}`,
    `- **모델:** ${settings.model || 'claude-haiku-4-5-20251001'}`,
    `- **활성 프로젝트:** ${activeProject}`,
    `- **저장 경로:** ${DATA_DIR}`,
    `- **분석 모드:** ${settings.apiKey ? 'local / api / deep 사용 가능' : 'local만 사용 가능'}`,
  ].join('\n');
}

export function setApiKey({ apiKey, model }) {
  if (!apiKey) throw new Error('set_api_key: apiKey 가 필요합니다.');
  const settings = readSettings();
  settings.apiKey = apiKey.trim();
  if (model) settings.model = model.trim();
  writeSettings(settings);
  return `API 키 등록 완료 (${apiKey.slice(0,8)}...)\n이제 api/deep 모드 분석을 사용할 수 있습니다.`;
}

export function getStats() {
  const data = readData();
  const projects = Object.values(data.projects);
  const entries = Object.values(data.entries);
  const scores = entries.map(e => e.score).filter(s => s != null);
  const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const grades = { A: 0, B: 0, C: 0, D: 0 };
  entries.forEach(e => { if (e.grade) grades[e.grade]++; });

  const recentScores = entries
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5)
    .map(e => e.score);
  const trend = recentScores.length >= 2
    ? (recentScores[0] > recentScores[recentScores.length - 1] ? '📈 상승' : recentScores[0] < recentScores[recentScores.length - 1] ? '📉 하락' : '→ 유지')
    : '-';

  return [
    '## 전체 통계',
    `- **프로젝트 수:** ${projects.length}`,
    `- **총 프롬프트 수:** ${entries.length}`,
    `- **평균 점수:** ${avgScore}`,
    `- **최고 점수:** ${scores.length ? Math.max(...scores) : '-'}`,
    `- **등급 분포:** A=${grades.A} B=${grades.B} C=${grades.C} D=${grades.D}`,
    `- **최근 5개 추세:** ${trend}`,
  ].join('\n');
}
