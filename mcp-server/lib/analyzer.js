/**
 * Prompatic — Prompt analyzer
 *
 * Two modes:
 * - local: Rule-based instant scoring (no API key required)
 * - api: Claude API meta-analysis with 3-color report (Referenced/Inferred/Missing)
 *
 * Scores across 5 axes: clarity, specificity, context, structure, actionability.
 */

const ROLE_PATTERNS = [
  /you are/i, /act as/i, /역할/i, /전문가/i, /expert/i, /specialist/i,
  /as a/i, /role:/i, /persona/i
];

const CONTEXT_PATTERNS = [
  /background/i, /배경/i, /현재/i, /상황/i, /currently/i, /환경/i,
  /project/i, /프로젝트/i, /기존/i, /legacy/i, /이전/i, /because/i
];

const FORMAT_PATTERNS = [
  /format/i, /형식/i, /table/i, /표/i, /json/i, /markdown/i, /list/i,
  /bullet/i, /step by step/i, /단계/i, /목록/i, /csv/i
];

const EXAMPLE_PATTERNS = [
  /example/i, /예시/i, /예를 들/i, /for instance/i, /e\.g\./i,
  /such as/i, /like this/i, /sample/i
];

const CONSTRAINT_PATTERNS = [
  /must not/i, /하지 마/i, /avoid/i, /제외/i, /limit/i, /제한/i,
  /only/i, /만/i, /don't/i, /금지/i, /within/i, /이내/i
];

const SPECIFICITY_INDICATORS = [
  /\d+/, /\b\d+\s*(개|건|초|분|시간|일|줄|글자)\b/, /specifically/i,
  /구체적/i, /정확히/i, /exactly/i
];

function countMatches(text, patterns) {
  return patterns.filter(p => p.test(text)).length;
}

export function analyzePrompt(prompt) {
  const len = prompt.length;
  const wordCount = prompt.split(/\s+/).filter(Boolean).length;
  const sentenceCount = prompt.split(/[.!?。！？\n]+/).filter(s => s.trim()).length;

  // Detect elements
  const hasRole = countMatches(prompt, ROLE_PATTERNS) > 0;
  const hasContext = countMatches(prompt, CONTEXT_PATTERNS) > 0;
  const hasFormat = countMatches(prompt, FORMAT_PATTERNS) > 0;
  const hasExample = countMatches(prompt, EXAMPLE_PATTERNS) > 0;
  const hasConstraint = countMatches(prompt, CONSTRAINT_PATTERNS) > 0;
  const specificityHits = countMatches(prompt, SPECIFICITY_INDICATORS);

  // ── Axis scores (0-100) ──

  // Clarity: sentence structure, length, not too short/long
  let clarity = 50;
  if (sentenceCount >= 2) clarity += 15;
  if (sentenceCount >= 4) clarity += 10;
  if (wordCount >= 10 && wordCount <= 200) clarity += 15;
  if (hasConstraint) clarity += 10;
  clarity = Math.min(100, clarity);

  // Specificity: numbers, exact terms, concrete requirements
  let specificity = 30;
  specificity += specificityHits * 15;
  if (wordCount >= 20) specificity += 10;
  if (hasExample) specificity += 15;
  specificity = Math.min(100, specificity);

  // Context: background info, project details
  let context = 30;
  if (hasContext) context += 30;
  if (hasRole) context += 20;
  if (len > 100) context += 10;
  if (len > 300) context += 10;
  context = Math.min(100, context);

  // Structure: clear sections, formatting hints
  let structure = 30;
  if (hasFormat) structure += 25;
  if (sentenceCount >= 3) structure += 15;
  if (prompt.includes('\n')) structure += 15;
  if (hasConstraint) structure += 15;
  structure = Math.min(100, structure);

  // Actionability: can AI execute immediately?
  let actionability = 40;
  if (hasRole) actionability += 15;
  if (hasFormat) actionability += 15;
  if (hasContext) actionability += 10;
  if (hasExample) actionability += 10;
  if (hasConstraint) actionability += 10;
  actionability = Math.min(100, actionability);

  const axisScores = [clarity, specificity, context, structure, actionability];
  const score = Math.round(axisScores.reduce((s, v) => s + v, 0) / 5);

  // ── Missing elements ──
  const missing = [];
  if (!hasRole) missing.push({ element: 'Role', suggestion: 'Add "You are a [role]..." to define AI persona' });
  if (!hasContext) missing.push({ element: 'Context', suggestion: 'Add background information about your project/situation' });
  if (!hasFormat) missing.push({ element: 'Output Format', suggestion: 'Specify desired format: table, list, JSON, step-by-step, etc.' });
  if (!hasExample) missing.push({ element: 'Example', suggestion: 'Include an example of expected input/output' });
  if (!hasConstraint) missing.push({ element: 'Constraints', suggestion: 'Add limitations: length, style, things to avoid' });

  // ── Grade ──
  let grade;
  if (score >= 90) grade = 'A';
  else if (score >= 80) grade = 'B+';
  else if (score >= 70) grade = 'B';
  else if (score >= 60) grade = 'C+';
  else if (score >= 50) grade = 'C';
  else grade = 'D';

  // ── Enhancement suggestions ──
  const suggestions = [];
  if (!hasRole) suggestions.push('Prepend a role: "You are a senior [domain] expert..."');
  if (!hasContext) suggestions.push('Add context: "I\'m working on [project] using [tech stack]..."');
  if (!hasFormat) suggestions.push('Specify output format: "Present as a table with columns: ..."');
  if (specificity < 50) suggestions.push('Add specific numbers, names, or constraints');
  if (!hasExample) suggestions.push('Include a concrete example of desired output');

  // ── Enhanced prompt (auto-generated) ──
  let enhanced = prompt;
  if (!hasRole && !hasContext) {
    enhanced = `[Consider adding: role definition and project context]\n\n${prompt}`;
    if (!hasFormat) {
      enhanced += '\n\n[Consider adding: desired output format]';
    }
  }

  const summary = `Score: ${score}/100 (${grade}). Found: ${5 - missing.length}/5 elements. Missing: ${missing.map(m => m.element).join(', ') || 'none'}.`;

  return {
    mode: 'local',
    score,
    grade,
    axisScores,
    axisLabels: ['Clarity', 'Specificity', 'Context', 'Structure', 'Actionability'],
    missing,
    suggestions,
    enhanced,
    summary,
    stats: { characters: len, words: wordCount, sentences: sentenceCount }
  };
}

// ── Claude API Meta-Analysis (3-color report) ──

const ANALYSIS_SYSTEM_PROMPT = `당신은 프롬프트 분석 전문가입니다.
사용자가 AI에게 보낼 프롬프트를 받으면, 그 프롬프트를 AI의 관점에서 분석하여
다음 3가지 카테고리로 분류하세요.

1. referenced (참조됨):
   프롬프트에서 명시적으로 언급된 용어와 개념.
   AI가 해당 단어를 보고 구체적 의미를 특정할 수 있는 것.
   - 각 항목: { "term": "용어", "explanation": "AI가 이 용어를 어떻게 이해했는지" }

2. inferred (추론됨):
   프롬프트에 직접 쓰여 있지 않지만, referenced 항목들과 일반적 맥락에서
   AI가 유추할 수밖에 없는 배경 정보.
   - 각 항목: { "term": "추론 내용", "explanation": "추론 근거", "confidence": "high|medium|low" }

3. missing (부재):
   AI가 좋은 답변을 하려면 알아야 하지만, 프롬프트에도 없고 추론으로도
   확정할 수 없는 정보.
   - 각 항목: { "field": "부재 정보명", "suggestion": "사용자에게 보여줄 보충 가이드" }

4. enhancedPrompt:
   부재 정보를 보충하고 구조를 개선한 버전의 프롬프트.

반드시 유효한 JSON 형식으로만 응답하세요:
{
  "referenced": [...],
  "inferred": [...],
  "missing": [...],
  "enhancedPrompt": "..."
}`;

export async function analyzePromptWithApi(prompt, apiKey, model = 'claude-sonnet-4-5-20250514') {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: ANALYSIS_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `다음 프롬프트를 분석하라:\n\n${prompt}`
      }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error ${response.status}: ${err}`);
  }

  const result = await response.json();
  const text = result.content[0].text;

  let analysis;
  try {
    analysis = JSON.parse(text);
  } catch {
    // Try to extract JSON from markdown code block
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      analysis = JSON.parse(match[1].trim());
    } else {
      throw new Error('Failed to parse API response as JSON');
    }
  }

  // Compute score from analysis
  const refCount = (analysis.referenced || []).length;
  const infCount = (analysis.inferred || []).length;
  const misCount = (analysis.missing || []).length;
  const total = refCount + infCount + misCount;
  const score = total > 0 ? Math.round((refCount / total) * 100) : 50;

  let grade;
  if (score >= 90) grade = 'A';
  else if (score >= 80) grade = 'B+';
  else if (score >= 70) grade = 'B';
  else if (score >= 60) grade = 'C+';
  else if (score >= 50) grade = 'C';
  else grade = 'D';

  // Also run local analysis for axis scores
  const local = analyzePrompt(prompt);

  return {
    mode: 'api',
    score,
    grade,
    axisScores: local.axisScores,
    axisLabels: local.axisLabels,
    referenced: analysis.referenced || [],
    inferred: analysis.inferred || [],
    missing: analysis.missing || [],
    enhancedPrompt: analysis.enhancedPrompt || '',
    suggestions: local.suggestions,
    summary: `Score: ${score}/100 (${grade}). Referenced: ${refCount}, Inferred: ${infCount}, Missing: ${misCount}.`,
    stats: local.stats,
    usage: {
      inputTokens: result.usage?.input_tokens || 0,
      outputTokens: result.usage?.output_tokens || 0,
      model
    }
  };
}
