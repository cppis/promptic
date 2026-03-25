/**
 * 시각화/내보내기/가져오기 핸들러: visualize_project, export_project, import_project, import_claude_conversations
 */
import fs from 'fs';
import path from 'path';
import { readData, writeData, readSettings, generateEntryId, DATA_DIR } from '../storage.js';
import { analyzeLocal } from '../analyzer.js';

export function visualizeProject({ projectId, outputPath } = {}) {
  const data = readData();
  const settings = readSettings();
  const pid = projectId || settings.activeProject;
  if (!pid) throw new Error('visualize_project: projectId 또는 활성 프로젝트가 필요합니다.');
  const project = data.projects[pid];
  if (!project) throw new Error(`visualize_project: 프로젝트 "${pid}" 를 찾을 수 없습니다.`);

  const entries = Object.values(data.entries)
    .filter(e => e.projectId === pid)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  if (entries.length === 0) return '시각화할 데이터가 없습니다. 먼저 프롬프트를 분석하세요.';

  const scores = entries.map(e => e.score);
  const grades = { A: 0, B: 0, C: 0, D: 0 };
  entries.forEach(e => { if (e.grade) grades[e.grade]++; });

  const html = `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><title>Promptic — ${project.name}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<style>
  body { font-family: 'Segoe UI', sans-serif; max-width: 900px; margin: 40px auto; background: #f8f9fa; color: #333; }
  h1 { color: #4a90d9; }
  .card { background: #fff; border-radius: 12px; padding: 24px; margin: 16px 0; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
  .stat { display: inline-block; text-align: center; margin: 0 20px; }
  .stat .num { font-size: 2em; font-weight: bold; color: #4a90d9; }
  canvas { max-height: 300px; }
</style>
</head>
<body>
<h1>📊 Promptic 대시보드</h1>
<p>프로젝트: <strong>${project.name}</strong>  |  생성일: ${new Date(project.createdAt).toLocaleDateString('ko-KR')}</p>
<div class="card">
  <div class="stat"><div class="num">${entries.length}</div><div>총 프롬프트</div></div>
  <div class="stat"><div class="num">${scores.length ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) : '-'}</div><div>평균 점수</div></div>
  <div class="stat"><div class="num">${grades.A}</div><div>A등급</div></div>
  <div class="stat"><div class="num">${scores.length ? Math.max(...scores) : '-'}</div><div>최고 점수</div></div>
</div>
<div class="card"><h2>점수 추이</h2>
  <canvas id="lineChart"></canvas>
</div>
<div class="card"><h2>등급 분포</h2>
  <canvas id="pieChart"></canvas>
</div>
<script>
const labels = ${JSON.stringify(entries.map((_, i) => `#${i+1}`))};
const scores = ${JSON.stringify(scores)};
new Chart(document.getElementById('lineChart'), {
  type: 'line',
  data: { labels, datasets: [{ label: '점수', data: scores, borderColor: '#4a90d9', fill: true, backgroundColor: 'rgba(74,144,217,0.1)', tension: 0.3 }] },
  options: { scales: { y: { min: 0, max: 100 } } }
});
new Chart(document.getElementById('pieChart'), {
  type: 'pie',
  data: {
    labels: ['A (80-100)', 'B (60-79)', 'C (40-59)', 'D (0-39)'],
    datasets: [{ data: [${grades.A},${grades.B},${grades.C},${grades.D}], backgroundColor: ['#2ecc71','#3498db','#f39c12','#e74c3c'] }]
  }
});
</script>
</body></html>`;

  const filePath = outputPath || path.join(DATA_DIR, `${project.name.replace(/\s+/g, '_')}_dashboard.html`);
  fs.writeFileSync(filePath, html, 'utf-8');
  return `HTML 대시보드 생성 완료: ${filePath}\n브라우저에서 열어서 확인하세요.`;
}

export function exportProject({ projectId, format = 'json', outputPath, dateFrom, dateTo, scoreMin, scoreMax, grade, tags = [] } = {}) {
  const data = readData();
  const settings = readSettings();
  const pid = projectId || settings.activeProject;
  if (!pid) throw new Error('export_project: projectId 또는 활성 프로젝트가 필요합니다.');
  const project = data.projects[pid];
  if (!project) throw new Error(`export_project: 프로젝트 "${pid}" 를 찾을 수 없습니다.`);

  let entries = Object.values(data.entries).filter(e => e.projectId === pid);
  if (dateFrom) entries = entries.filter(e => new Date(e.createdAt) >= new Date(dateFrom));
  if (dateTo)   entries = entries.filter(e => new Date(e.createdAt) <= new Date(dateTo));
  if (scoreMin != null) entries = entries.filter(e => e.score >= scoreMin);
  if (scoreMax != null) entries = entries.filter(e => e.score <= scoreMax);
  if (grade)    entries = entries.filter(e => e.grade === grade.toUpperCase());
  if (tags.length > 0) entries = entries.filter(e => tags.every(t => (e.tags||[]).includes(t)));
  entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const ext = format === 'csv' ? 'csv' : format === 'markdown' ? 'md' : 'json';
  const filePath = outputPath || path.join(DATA_DIR, `${project.name.replace(/\s+/g, '_')}_export.${ext}`);

  let content = '';
  if (format === 'json') {
    content = JSON.stringify({ project, entries }, null, 2);
  } else if (format === 'csv') {
    const headers = 'entryId,score,grade,clarity,completeness,specificity,context,output_format,tags,createdAt,prompt';
    const rows = entries.map(e =>
      [e.id, e.score, e.grade, e.scores?.clarity, e.scores?.completeness, e.scores?.specificity, e.scores?.context, e.scores?.output_format,
       (e.tags||[]).join(';'), e.createdAt, `"${e.prompt.replace(/"/g,'""')}"`].join(',')
    );
    content = [headers, ...rows].join('\n');
  } else {
    content = `# ${project.name} — 히스토리\n\n총 ${entries.length}개\n\n`;
    entries.forEach((e, i) => {
      content += `## ${i + 1}. 점수: ${e.score} (${e.grade})  \`${e.id}\`\n`;
      content += `**날짜:** ${new Date(e.createdAt).toLocaleString('ko-KR')}\n\n`;
      content += `\`\`\`\n${e.prompt}\n\`\`\`\n\n---\n\n`;
    });
  }

  fs.writeFileSync(filePath, content, 'utf-8');
  return `내보내기 완료 (${format.toUpperCase()}, ${entries.length}개): ${filePath}`;
}

export function importProject({ filePath, mode = 'merge', projectName } = {}) {
  if (!filePath) throw new Error('import_project: filePath 가 필요합니다.');
  if (!fs.existsSync(filePath)) throw new Error(`import_project: 파일을 찾을 수 없습니다: ${filePath}`);

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const data = readData();

  const importedProject = raw.project;
  const importedEntries = raw.entries || [];

  const finalName = projectName || importedProject?.name || 'imported_project';
  const finalId = importedProject?.id || `p_${Math.random().toString(16).slice(2,10)}`;

  if (mode === 'replace' && data.projects[finalId]) {
    Object.keys(data.entries).filter(k => data.entries[k].projectId === finalId).forEach(k => delete data.entries[k]);
  }

  data.projects[finalId] = { ...importedProject, id: finalId, name: finalName };
  let count = 0;
  importedEntries.forEach(e => {
    if (mode === 'merge' && data.entries[e.id]) return;
    data.entries[e.id] = { ...e, projectId: finalId };
    count++;
  });

  writeData(data);
  return `가져오기 완료: 프로젝트 "${finalName}" (${count}개 엔트리)\nprojectId: \`${finalId}\``;
}

export function importClaudeConversations({ filePath, mode = 'merge', projectName } = {}) {
  if (!filePath) throw new Error('import_claude_conversations: filePath 가 필요합니다.');
  if (!fs.existsSync(filePath)) throw new Error(`import_claude_conversations: 파일을 찾을 수 없습니다: ${filePath}`);

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const data = readData();

  const projectId = `p_${Math.random().toString(16).slice(2,10)}`;
  const finalName = projectName || 'Claude 대화 가져오기';
  data.projects[projectId] = { id: projectId, name: finalName, createdAt: new Date().toISOString() };

  let count = 0;
  const conversations = Array.isArray(raw) ? raw : (raw.conversations || []);
  for (const conv of conversations) {
    const messages = conv.messages || conv.chat_messages || [];
    for (const msg of messages) {
      if (msg.role === 'human' || msg.role === 'user') {
        const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        if (text.length < 10) continue;
        const analysis = analyzeLocal(text);
        const entryId = generateEntryId();
        data.entries[entryId] = {
          id: entryId, prompt: text, score: analysis.totalScore, grade: analysis.grade,
          scores: analysis.scores, missingElements: analysis.missingElements,
          suggestedTags: analysis.suggestedTags, tags: [], projectId,
          createdAt: msg.created_at || new Date().toISOString(),
        };
        count++;
      }
    }
  }

  writeData(data);
  return `Claude 대화 가져오기 완료: ${count}개 프롬프트 → 프로젝트 "${finalName}"\nprojectId: \`${projectId}\``;
}
