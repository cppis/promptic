/**
 * PromptLens — Project Export / Import (v0.4.0)
 *
 * Formats:
 *   JSON     — full fidelity, importable
 *   Markdown — human-readable report (export only)
 *   CSV      — spreadsheet-friendly (export only)
 */

const SCHEMA_VERSION = '0.4.0';

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreToGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  return 'D';
}

function fmtDate(iso) {
  try { return new Date(iso).toISOString().slice(0, 10); }
  catch { return iso || ''; }
}

function escapeCsvField(val) {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function axisObj(axisScores) {
  // axisScores may be array [clarity, specificity, context, structure, actionability]
  // or an object { clarity, specificity, context, structure, actionability }
  if (Array.isArray(axisScores)) {
    return {
      clarity:       axisScores[0] ?? 0,
      specificity:   axisScores[1] ?? 0,
      context:       axisScores[2] ?? 0,
      structure:     axisScores[3] ?? 0,
      actionability: axisScores[4] ?? 0
    };
  }
  return axisScores || {};
}

// ── JSON ──────────────────────────────────────────────────────────────────────

/**
 * Serialize a project + entries to a .promptlens.json string.
 * @param {object} project   — project metadata
 * @param {Array}  entries   — history entries (filtered or full)
 * @returns {string} JSON string
 */
export function toJson(project, entries) {
  return JSON.stringify({
    _schema:  SCHEMA_VERSION,
    _tool:    'promptlens',
    project:  { ...project, updatedAt: new Date().toISOString() },
    history:  entries,
    meta: {
      exportedAt:  new Date().toISOString(),
      entryCount:  entries.length,
      avgScore:    entries.length
        ? Math.round(entries.reduce((s, e) => s + (e.score || 0), 0) / entries.length)
        : 0
    }
  }, null, 2);
}

/**
 * Parse and validate a .promptlens.json string.
 * @returns {{ project, history, meta }} or throws Error
 */
export function fromJson(content) {
  let parsed;
  try { parsed = JSON.parse(content); }
  catch { throw new Error('JSON 파싱 실패: 유효한 JSON 파일인지 확인하세요.'); }

  if (!parsed.project) throw new Error('필수 필드 누락: project');
  if (!parsed.project.id)   throw new Error('필수 필드 누락: project.id');
  if (!parsed.project.name) throw new Error('필수 필드 누락: project.name');
  if (!Array.isArray(parsed.history)) throw new Error('필수 필드 누락: history (array)');

  const warnings = [];
  if (parsed._schema && parsed._schema !== SCHEMA_VERSION) {
    warnings.push(`스키마 버전 불일치: 파일=${parsed._schema}, 현재=${SCHEMA_VERSION}`);
  }

  return { project: parsed.project, history: parsed.history, meta: parsed.meta || {}, warnings };
}

// ── Markdown ──────────────────────────────────────────────────────────────────

/**
 * Generate a Markdown report for a project.
 */
export function toMarkdown(project, entries) {
  const sorted     = [...entries].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const scores     = entries.map(e => e.score || 0);
  const avgScore   = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const maxEntry   = entries.reduce((m, e) => (e.score || 0) > (m?.score || 0) ? e : m, null);
  const minEntry   = entries.reduce((m, e) => (e.score || 0) < (m?.score || Infinity) ? e : m, null);

  // Top missing elements
  const missingCount = {};
  for (const e of entries) {
    for (const m of (e.missingElements || [])) {
      missingCount[m] = (missingCount[m] || 0) + 1;
    }
  }
  const topMissing = Object.entries(missingCount)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([k, v]) => `${k} (${v}회)`);

  // Grade distribution
  const gradeDist = { A: 0, B: 0, C: 0, D: 0 };
  for (const e of entries) gradeDist[scoreToGrade(e.score || 0)]++;

  const startDate = entries.length
    ? fmtDate(entries.reduce((m, e) => e.createdAt < m ? e.createdAt : m, entries[0].createdAt))
    : '—';
  const endDate   = entries.length ? fmtDate(sorted[0]?.createdAt) : '—';

  const lines = [
    `# ${project.name} — PromptLens 분석 리포트`,
    `> 기간: ${startDate} ~ ${endDate} | 총 ${entries.length}개 분석 | 평균 점수: ${avgScore}/100`,
    '',
    '## 요약',
    '',
    maxEntry ? `- **최고 점수:** ${maxEntry.score}점 (${fmtDate(maxEntry.createdAt)})` : '',
    minEntry ? `- **최저 점수:** ${minEntry.score}점 (${fmtDate(minEntry.createdAt)})` : '',
    topMissing.length ? `- **자주 누락된 요소:** ${topMissing.join(', ')}` : '',
    `- **등급 분포:** A ${gradeDist.A}개 / B ${gradeDist.B}개 / C ${gradeDist.C}개 / D ${gradeDist.D}개`,
    '',
    '---',
    '',
    '## 분석 기록',
    ''
  ].filter(l => l !== undefined);

  for (const e of sorted) {
    const axis = axisObj(e.axisScores);
    lines.push(
      `### [${fmtDate(e.createdAt)}] ${e.score}점 (${e.grade || scoreToGrade(e.score)}등급)`,
      '',
      '**원본 프롬프트:**',
      `> ${(e.prompt || '').replace(/\n/g, '\n> ')}`,
      ''
    );

    if ((e.missingElements || []).length) {
      lines.push(`**누락 요소:** ${e.missingElements.join(', ')}`, '');
    }

    if (e.enhanced) {
      lines.push(
        '**개선된 프롬프트:**',
        `> ${(e.enhanced || '').replace(/\n/g, '\n> ')}`,
        ''
      );
    }

    if (Object.keys(axis).length) {
      lines.push(
        `**5축 점수:** Clarity ${axis.clarity} / Specificity ${axis.specificity} / Context ${axis.context} / Structure ${axis.structure} / Actionability ${axis.actionability}`,
        ''
      );
    }

    if ((e.tags || []).length) {
      lines.push(`**태그:** ${e.tags.join(', ')}`, '');
    }

    lines.push('---', '');
  }

  return lines.join('\n');
}

// ── CSV ───────────────────────────────────────────────────────────────────────

/**
 * Generate a CSV file for a project (export only).
 */
export function toCsv(project, entries) {
  const headers = [
    'id', 'date', 'score', 'grade',
    'axis_clarity', 'axis_specificity', 'axis_context', 'axis_structure', 'axis_actionability',
    'analysis_mode', 'tags', 'missing_elements', 'version', 'parent_id', 'prompt', 'enhanced'
  ];

  const rows = entries.map(e => {
    const axis = axisObj(e.axisScores);
    return [
      e.id,
      fmtDate(e.createdAt),
      e.score ?? '',
      e.grade || scoreToGrade(e.score || 0),
      axis.clarity       ?? '',
      axis.specificity   ?? '',
      axis.context       ?? '',
      axis.structure     ?? '',
      axis.actionability ?? '',
      e.analysisMode || 'local',
      (e.tags || []).join(';'),
      (e.missingElements || []).join(';'),
      e.version ?? 1,
      e.parentId || '',
      e.prompt || '',
      e.enhanced || ''
    ].map(escapeCsvField).join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}
