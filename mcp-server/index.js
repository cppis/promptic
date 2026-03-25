/**
 * Promptic MCP Server
 *
 * 프롬프트 품질 분석, 히스토리 관리, 프로젝트 버전 추적을 위한 MCP 서버.
 * stdio 전송 방식으로 Claude Code / Cowork 에 연결된다.
 *
 * 18개 도구:
 *   프로젝트:  list_projects, create_project, set_active_project, snapshot_project
 *   분석:      analyze_prompt, compare_prompts, get_versions
 *   히스토리:  add_history_entry, get_history, query_history
 *   내보내기:  visualize_project, export_project, import_project, import_claude_conversations
 *   설정/통계: get_settings, set_api_key, get_stats
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { listProjects, createProject, setActiveProject, snapshotProject } from './lib/handlers/projects.js';
import { analyzePrompt, comparePrompts, getVersions } from './lib/handlers/analysis.js';
import { addHistoryEntry, getHistory, queryHistory } from './lib/handlers/history.js';
import { visualizeProject, exportProject, importProject, importClaudeConversations } from './lib/handlers/exportimport.js';
import { getSettings, setApiKey, getStats } from './lib/handlers/settings.js';

// ── MCP 서버 생성 ──────────────────────────────────────────────────────────
const server = new McpServer({
  name: 'promptic',
  version: '1.0.0',
});

// 에러를 안전하게 텍스트로 반환하는 헬퍼
function safe(fn) {
  try {
    const result = fn();
    return { content: [{ type: 'text', text: result }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `❌ 오류: ${err.message}` }] };
  }
}

// ── 프로젝트 관리 ──────────────────────────────────────────────────────────

server.tool('list_projects', '전체 프로젝트 목록과 통계(프롬프트 수, 평균 점수)를 반환합니다.', {}, async () => safe(listProjects));

server.tool('create_project', '새 프로젝트를 생성합니다.', {
  name: z.string().describe('프로젝트 이름'),
}, async ({ name }) => safe(() => createProject({ name })));

server.tool('set_active_project', '활성 프로젝트를 설정/해제/조회합니다. analyze_prompt 결과가 활성 프로젝트에 자동 저장됩니다.', {
  action: z.enum(['set', 'clear', 'get']).optional().describe('"set" | "clear" | "get" (기본값: set)'),
  projectName: z.string().optional().describe('프로젝트 이름 또는 ID (action=set 시 필요)'),
}, async ({ action, projectName }) => safe(() => setActiveProject({ action, projectName })));

server.tool('snapshot_project', '현재 프로젝트 상태를 스냅샷으로 저장합니다. compareWith로 이전 스냅샷과 비교할 수 있습니다.', {
  projectId: z.string().optional().describe('프로젝트 ID (생략 시 활성 프로젝트)'),
  label: z.string().optional().describe('스냅샷 레이블'),
  compareWith: z.string().optional().describe('비교할 이전 스냅샷 ID'),
}, async ({ projectId, label, compareWith }) => safe(() => snapshotProject({ projectId, label, compareWith })));

// ── 분석 및 평가 ──────────────────────────────────────────────────────────

server.tool('analyze_prompt',
  `프롬프트를 5축(명확성, 완전성, 구체성, 컨텍스트, 출력형식)으로 분석하고 점수/등급/개선 방향을 반환합니다.
트리거 단축어: ">> anz" ">> 분석" ">> deep" ">> 정밀분석" ">> re" ">> 재분석" ">> v2"`, {
  prompt: z.string().describe('분석할 프롬프트 텍스트 또는 트리거 명령 (>> re, >> v2 등)'),
  mode: z.enum(['local', 'api', 'deep']).optional().describe('"local"(기본) | "api" | "deep"'),
  parentId: z.string().optional().describe('이전 버전 entryId (버전 체인 연결)'),
  projectId: z.string().optional().describe('저장할 프로젝트 ID (생략 시 활성 프로젝트)'),
  tags: z.array(z.string()).optional().describe('수동 태그 목록'),
  autoTag: z.boolean().optional().describe('자동 태그 추천 활성화 (기본값: true)'),
  tagMode: z.enum(['suggest', 'auto']).optional().describe('"suggest"(제안만) | "auto"(자동 적용)'),
}, async ({ prompt, mode, parentId, projectId, tags, autoTag, tagMode }) =>
  safe(() => analyzePrompt({ prompt, mode, parentId, projectId, tags, autoTag, tagMode })));

server.tool('compare_prompts', '두 버전의 프롬프트를 텍스트/점수/등급 변화로 비교합니다.', {
  entryIdA: z.string().describe('비교 기준 entryId (v1)'),
  entryIdB: z.string().describe('비교 대상 entryId (v2)'),
  projectId: z.string().optional().describe('프로젝트 ID'),
}, async ({ entryIdA, entryIdB, projectId }) => safe(() => comparePrompts({ entryIdA, entryIdB, projectId })));

server.tool('get_versions', '프롬프트의 전체 버전 체인(v1→v2→v3...)을 조회합니다.', {
  entryId: z.string().describe('조회할 entryId'),
  projectId: z.string().optional().describe('프로젝트 ID'),
}, async ({ entryId, projectId }) => safe(() => getVersions({ entryId, projectId })));

// ── 히스토리 관리 ──────────────────────────────────────────────────────────

server.tool('add_history_entry', '수동으로 프롬프트를 히스토리에 추가합니다.', {
  projectId: z.string().optional().describe('저장할 프로젝트 ID (생략 시 활성 프로젝트)'),
  prompt: z.string().describe('저장할 프롬프트'),
  score: z.number().optional().describe('수동 점수 (0~100, 생략 시 자동 계산)'),
  tags: z.array(z.string()).optional().describe('태그 목록'),
  note: z.string().optional().describe('메모'),
}, async ({ projectId, prompt, score, tags, note }) => safe(() => addHistoryEntry({ projectId, prompt, score, tags, note })));

server.tool('get_history', '히스토리를 날짜 내림차순으로 조회합니다. 페이지네이션 지원.', {
  projectId: z.string().optional().describe('프로젝트 ID (생략 시 활성 프로젝트)'),
  limit: z.number().optional().describe('한 번에 반환할 개수 (기본값: 20)'),
  pageToken: z.string().optional().describe('페이지 토큰'),
  search: z.string().optional().describe('텍스트 검색어'),
}, async ({ projectId, limit, pageToken, search }) => safe(() => getHistory({ projectId, limit, pageToken, search })));

server.tool('query_history', '고급 필터로 히스토리를 검색합니다. 점수 범위, 등급, 태그, 날짜 필터 지원.', {
  projectId: z.string().optional(),
  limit: z.number().optional(),
  scoreMin: z.number().optional().describe('최소 점수'),
  scoreMax: z.number().optional().describe('최대 점수'),
  grade: z.string().optional().describe('등급 필터 (A/B/C/D)'),
  tags: z.array(z.string()).optional().describe('태그 필터 (AND 조건)'),
  dateFrom: z.string().optional().describe('시작 날짜 (ISO 8601)'),
  dateTo: z.string().optional().describe('종료 날짜 (ISO 8601)'),
  search: z.string().optional().describe('프롬프트 텍스트 검색'),
  sortBy: z.enum(['date', 'score']).optional().describe('"date" | "score"'),
  missing: z.string().optional().describe('특정 누락 요소 포함 필터'),
}, async (params) => safe(() => queryHistory(params)));

// ── 시각화 및 내보내기 ────────────────────────────────────────────────────

server.tool('visualize_project', 'HTML 대시보드(점수 추이 차트, 등급 분포)를 생성합니다.', {
  projectId: z.string().optional(),
  outputPath: z.string().optional().describe('저장 경로 (생략 시 ~/.promptic/)'),
}, async ({ projectId, outputPath }) => safe(() => visualizeProject({ projectId, outputPath })));

server.tool('export_project', '프로젝트를 JSON/Markdown/CSV 형식으로 내보냅니다.', {
  projectId: z.string().optional(),
  format: z.enum(['json', 'markdown', 'csv']).optional().describe('"json"(기본) | "markdown" | "csv"'),
  outputPath: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  scoreMin: z.number().optional(),
  scoreMax: z.number().optional(),
  grade: z.string().optional(),
  tags: z.array(z.string()).optional(),
}, async (params) => safe(() => exportProject(params)));

server.tool('import_project', '.promptic.json 파일을 가져옵니다.', {
  filePath: z.string().describe('가져올 파일 경로'),
  mode: z.enum(['merge', 'replace']).optional().describe('"merge"(기본) | "replace"'),
  projectName: z.string().optional().describe('프로젝트 이름 오버라이드'),
}, async ({ filePath, mode, projectName }) => safe(() => importProject({ filePath, mode, projectName })));

server.tool('import_claude_conversations', 'Claude Desktop/Code 대화 JSON 파일을 가져와 프롬프트 히스토리로 변환합니다.', {
  filePath: z.string().describe('Claude 대화 JSON 파일 경로'),
  mode: z.enum(['merge', 'replace']).optional(),
  projectName: z.string().optional(),
}, async ({ filePath, mode, projectName }) => safe(() => importClaudeConversations({ filePath, mode, projectName })));

// ── 설정 및 통계 ──────────────────────────────────────────────────────────

server.tool('get_settings', 'API 키 상태, 모델, 활성 프로젝트, 저장 경로를 확인합니다.', {}, async () => safe(getSettings));

server.tool('set_api_key', 'Anthropic API 키를 등록합니다. 등록 후 api/deep 분석 모드를 사용할 수 있습니다.', {
  apiKey: z.string().describe('Anthropic API 키 (sk-ant-...)'),
  model: z.string().optional().describe('사용할 모델 (기본값: claude-haiku-4-5-20251001)'),
}, async ({ apiKey, model }) => safe(() => setApiKey({ apiKey, model })));

server.tool('get_stats', '전체 통계(프로젝트 수, 총 프롬프트 수, 평균 점수, 최근 추세)를 반환합니다.', {}, async () => safe(getStats));

// ── 서버 시작 ──────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
// stdio 연결 후 서버가 종료되지 않도록 대기
