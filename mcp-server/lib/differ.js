/**
 * PromptLens — Prompt Diff Utility
 * Compares two prompt entries: text diff, score diff, axis diff.
 */

/**
 * Compute a simple word-level diff between two texts.
 * Returns an array of { type: 'equal'|'added'|'removed', text } segments.
 */
export function wordDiff(oldText, newText) {
  const oldWords = tokenize(oldText);
  const newWords = tokenize(newText);
  const lcs = longestCommonSubsequence(oldWords, newWords);

  const result = [];
  let oi = 0, ni = 0, li = 0;

  while (li < lcs.length) {
    // Removed words (in old but not in LCS)
    while (oi < oldWords.length && oldWords[oi] !== lcs[li]) {
      result.push({ type: 'removed', text: oldWords[oi] });
      oi++;
    }
    // Added words (in new but not in LCS)
    while (ni < newWords.length && newWords[ni] !== lcs[li]) {
      result.push({ type: 'added', text: newWords[ni] });
      ni++;
    }
    // Equal
    result.push({ type: 'equal', text: lcs[li] });
    oi++; ni++; li++;
  }
  // Remaining
  while (oi < oldWords.length) {
    result.push({ type: 'removed', text: oldWords[oi++] });
  }
  while (ni < newWords.length) {
    result.push({ type: 'added', text: newWords[ni++] });
  }

  return result;
}

/**
 * Compare two history entries and return a structured diff report.
 */
export function compareEntries(entryA, entryB) {
  // Text diff
  const textDiff = wordDiff(entryA.prompt, entryB.prompt);

  // Format as readable diff string
  const diffLines = formatDiff(textDiff);

  // Score comparison
  const scoreDiff = {
    before: entryA.score,
    after: entryB.score,
    change: entryB.score - entryA.score,
    changePercent: entryA.score > 0
      ? `${entryB.score > entryA.score ? '+' : ''}${Math.round(((entryB.score - entryA.score) / entryA.score) * 100)}%`
      : 'N/A'
  };

  // Axis scores comparison
  const axisA = normalizeAxis(entryA.axisScores);
  const axisB = normalizeAxis(entryB.axisScores);
  const axisNames = ['clarity', 'specificity', 'context', 'structure', 'actionability'];
  const axisDiff = {};
  for (let i = 0; i < 5; i++) {
    const name = axisNames[i];
    axisDiff[name] = {
      before: axisA[i],
      after: axisB[i],
      change: axisB[i] - axisA[i]
    };
  }

  // Tags diff
  const tagsA = new Set(entryA.tags || []);
  const tagsB = new Set(entryB.tags || []);
  const addedTags = [...tagsB].filter(t => !tagsA.has(t));
  const removedTags = [...tagsA].filter(t => !tagsB.has(t));

  // Grade
  const gradeA = scoreToGrade(entryA.score);
  const gradeB = scoreToGrade(entryB.score);

  return {
    summary: `${gradeA}(${entryA.score}) → ${gradeB}(${entryB.score}) [${scoreDiff.change >= 0 ? '+' : ''}${scoreDiff.change}점]`,
    textDiff: diffLines,
    scoreDiff,
    axisDiff,
    tagsDiff: { added: addedTags, removed: removedTags },
    versionA: { id: entryA.id, version: entryA.version || 1, date: entryA.createdAt },
    versionB: { id: entryB.id, version: entryB.version || 1, date: entryB.createdAt }
  };
}

// ── Helpers ──

function tokenize(text) {
  return text.split(/(\s+)/).filter(t => t.length > 0);
}

function longestCommonSubsequence(a, b) {
  const m = a.length, n = b.length;
  // Optimize for very long texts
  if (m > 500 || n > 500) {
    return simpleLCS(a, b);
  }
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  // Backtrack
  const result = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1]);
      i--; j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return result;
}

function simpleLCS(a, b) {
  // For long texts, use a simpler matching approach
  const bSet = new Set(b);
  return a.filter(w => bSet.has(w));
}

function formatDiff(segments) {
  const lines = [];
  let current = '';
  for (const seg of segments) {
    if (seg.type === 'removed') {
      current += `[-${seg.text}-]`;
    } else if (seg.type === 'added') {
      current += `[+${seg.text}+]`;
    } else {
      current += seg.text;
    }
  }
  return current;
}

function normalizeAxis(axisScores) {
  if (!axisScores) return [0, 0, 0, 0, 0];
  if (Array.isArray(axisScores)) {
    return axisScores.length >= 5 ? axisScores.slice(0, 5) : [...axisScores, ...Array(5 - axisScores.length).fill(0)];
  }
  if (typeof axisScores === 'object') {
    return [
      axisScores.clarity || 0,
      axisScores.specificity || 0,
      axisScores.context || 0,
      axisScores.structure || 0,
      axisScores.actionability || 0
    ];
  }
  return [0, 0, 0, 0, 0];
}

function scoreToGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  return 'D';
}
