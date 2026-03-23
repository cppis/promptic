/**
 * PromptLens — Advanced History Query Engine (v0.4.0)
 *
 * Supports filtering by:
 *   scoreMin / scoreMax   — score range (inclusive)
 *   grade                 — grade array ["A","B","C","D"]
 *   dateFrom / dateTo     — ISO date range (YYYY-MM-DD, inclusive)
 *   tags                  — AND match (all tags must be present)
 *   tagsAny               — OR match (any tag must be present)
 *   missing               — entries that include all listed missing elements
 *   versionsOnly          — only version-chain roots (parentId === null)
 *   search                — text search in prompt + note (case-insensitive)
 */

/**
 * Filter an array of history entries by the given filter object.
 * All conditions are AND-combined.
 *
 * @param {Array}  entries
 * @param {object} filter
 * @returns {Array} matching entries
 */
export function filterEntries(entries, filter = {}) {
  return entries.filter(e => {
    // ── Score range ──
    if (filter.scoreMin !== undefined && (e.score ?? 0) < filter.scoreMin) return false;
    if (filter.scoreMax !== undefined && (e.score ?? 0) > filter.scoreMax) return false;

    // ── Grade ──
    if (filter.grade?.length) {
      const g = e.grade || scoreToGrade(e.score ?? 0);
      if (!filter.grade.includes(g)) return false;
    }

    // ── Date range (compare ISO strings — works for YYYY-MM-DD prefix) ──
    if (filter.dateFrom) {
      const entryDate = (e.createdAt || '').slice(0, 10);
      if (entryDate < filter.dateFrom) return false;
    }
    if (filter.dateTo) {
      const entryDate = (e.createdAt || '').slice(0, 10);
      if (entryDate > filter.dateTo) return false;
    }

    // ── Tags AND (all must match) ──
    if (filter.tags?.length) {
      const entryTags = e.tags || [];
      if (!filter.tags.every(t => entryTags.includes(t))) return false;
    }

    // ── Tags OR (at least one must match) ──
    if (filter.tagsAny?.length) {
      const entryTags = e.tags || [];
      if (!filter.tagsAny.some(t => entryTags.includes(t))) return false;
    }

    // ── Missing elements (entry must include ALL listed elements) ──
    if (filter.missing?.length) {
      const entryMissing = e.missingElements || [];
      if (!filter.missing.every(m => entryMissing.includes(m))) return false;
    }

    // ── Version roots only ──
    if (filter.versionsOnly && e.parentId !== null && e.parentId !== undefined) return false;

    // ── Full-text search (prompt + note) ──
    if (filter.search) {
      const haystack = ((e.prompt || '') + ' ' + (e.note || '')).toLowerCase();
      if (!haystack.includes(filter.search.toLowerCase())) return false;
    }

    return true;
  });
}

/**
 * Sort entries by the given sortBy key.
 * @param {Array}  entries
 * @param {string} sortBy  — 'score_asc' | 'score_desc' | 'date_asc' | 'date_desc'
 * @returns {Array} sorted (new array, does not mutate)
 */
export function sortEntries(entries, sortBy = 'date_desc') {
  const copy = [...entries];
  switch (sortBy) {
    case 'score_asc':
      return copy.sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
    case 'score_desc':
      return copy.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    case 'date_asc':
      return copy.sort((a, b) => (a.createdAt || '') < (b.createdAt || '') ? -1 : 1);
    case 'date_desc':
    default:
      return copy.sort((a, b) => (a.createdAt || '') > (b.createdAt || '') ? -1 : 1);
  }
}

/**
 * Build a human-readable summary of the applied filter.
 */
export function summarizeFilter(filter) {
  const parts = [];
  if (filter.scoreMin !== undefined || filter.scoreMax !== undefined) {
    const lo = filter.scoreMin ?? 0;
    const hi = filter.scoreMax ?? 100;
    parts.push(`점수 ${lo}~${hi}`);
  }
  if (filter.grade?.length)    parts.push(`등급 [${filter.grade.join(',')}]`);
  if (filter.dateFrom)         parts.push(`${filter.dateFrom} 이후`);
  if (filter.dateTo)           parts.push(`${filter.dateTo} 이전`);
  if (filter.tags?.length)     parts.push(`태그 ALL: ${filter.tags.join(',')}`);
  if (filter.tagsAny?.length)  parts.push(`태그 ANY: ${filter.tagsAny.join(',')}`);
  if (filter.missing?.length)  parts.push(`누락요소: ${filter.missing.join(',')}`);
  if (filter.versionsOnly)     parts.push('버전루트만');
  if (filter.search)           parts.push(`검색: "${filter.search}"`);
  return parts.length ? parts.join(' / ') : '필터 없음 (전체)';
}

// ── Internal ──────────────────────────────────────────────────────────────────

function scoreToGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  return 'D';
}
