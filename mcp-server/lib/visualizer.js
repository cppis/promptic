/**
 * Promptic — HTML Dashboard Visualizer
 * Generates a self-contained HTML report with Chart.js charts.
 */

/**
 * Generate an HTML dashboard for a project's prompt history.
 * @param {object} project - Project object { id, name, createdAt }
 * @param {Array} entries - History entries
 * @returns {string} Self-contained HTML string
 */
export function generateDashboardHtml(project, entries) {
  // Sort entries by date ascending for charts
  const sorted = [...entries].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  // --- Data preparation ---

  // Score trend data
  const scoreTrendLabels = sorted.map((e, i) => {
    const d = new Date(e.createdAt);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });
  const scoreTrendData = sorted.map(e => e.score);

  // Latest 5-axis radar (use last entry or average)
  const axisLabels = ['Clarity', 'Specificity', 'Context', 'Structure', 'Actionability'];
  let latestAxis = [0, 0, 0, 0, 0];
  let avgAxis = [0, 0, 0, 0, 0];
  if (sorted.length > 0) {
    const last = sorted[sorted.length - 1];
    latestAxis = normalizeAxisScores(last.axisScores);
    // Average axis scores
    const counts = [0, 0, 0, 0, 0];
    for (const e of sorted) {
      const scores = normalizeAxisScores(e.axisScores);
      for (let i = 0; i < 5; i++) {
        avgAxis[i] += scores[i];
        counts[i]++;
      }
    }
    for (let i = 0; i < 5; i++) {
      avgAxis[i] = counts[i] > 0 ? Math.round(avgAxis[i] / counts[i]) : 0;
    }
  }

  // Grade distribution (donut)
  const gradeCounts = { A: 0, B: 0, C: 0, D: 0 };
  for (const e of sorted) {
    if (e.score >= 90) gradeCounts.A++;
    else if (e.score >= 70) gradeCounts.B++;
    else if (e.score >= 50) gradeCounts.C++;
    else gradeCounts.D++;
  }

  // Tag stats (bar)
  const tagCounts = {};
  for (const e of sorted) {
    for (const t of (e.tags || [])) {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    }
  }
  const topTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Summary stats
  const totalPrompts = sorted.length;
  const avgScore = totalPrompts > 0
    ? Math.round(sorted.reduce((s, e) => s + e.score, 0) / totalPrompts)
    : 0;
  const bestScore = totalPrompts > 0 ? Math.max(...sorted.map(e => e.score)) : 0;
  const worstScore = totalPrompts > 0 ? Math.min(...sorted.map(e => e.score)) : 0;

  // Recent entries for table (last 20)
  const recent = [...sorted].reverse().slice(0, 20);

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Promptic — ${escHtml(project.name)}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<style>
  :root {
    --bg: #0f172a; --surface: #1e293b; --border: #334155;
    --text: #e2e8f0; --text-muted: #94a3b8; --accent: #38bdf8;
    --green: #4ade80; --yellow: #facc15; --orange: #fb923c; --red: #f87171;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 24px; }
  .header { text-align: center; margin-bottom: 32px; }
  .header h1 { font-size: 28px; font-weight: 700; margin-bottom: 4px; }
  .header p { color: var(--text-muted); font-size: 14px; }
  .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-bottom: 32px; }
  .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; text-align: center; }
  .stat-card .value { font-size: 32px; font-weight: 700; color: var(--accent); }
  .stat-card .label { font-size: 13px; color: var(--text-muted); margin-top: 4px; }
  .charts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 24px; margin-bottom: 32px; }
  .chart-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
  .chart-card h3 { font-size: 16px; margin-bottom: 16px; color: var(--text-muted); }
  .table-section { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; overflow-x: auto; }
  .table-section h3 { font-size: 16px; margin-bottom: 16px; color: var(--text-muted); }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 10px 12px; border-bottom: 2px solid var(--border); color: var(--text-muted); font-weight: 600; }
  td { padding: 10px 12px; border-bottom: 1px solid var(--border); }
  tr:hover td { background: rgba(56, 189, 248, 0.05); }
  .grade { display: inline-block; width: 28px; height: 28px; border-radius: 6px; text-align: center; line-height: 28px; font-weight: 700; font-size: 13px; }
  .grade-a { background: var(--green); color: #052e16; }
  .grade-b { background: var(--yellow); color: #422006; }
  .grade-c { background: var(--orange); color: #431407; }
  .grade-d { background: var(--red); color: #450a0a; }
  .tag { display: inline-block; background: rgba(56,189,248,0.15); color: var(--accent); padding: 2px 8px; border-radius: 4px; font-size: 11px; margin: 1px 2px; }
  .prompt-text { max-width: 300px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .footer { text-align: center; margin-top: 32px; color: var(--text-muted); font-size: 12px; }
  @media (max-width: 600px) { .charts-grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>

<div class="header">
  <h1>Promptic</h1>
  <p>${escHtml(project.name)} — 생성일: ${new Date(project.createdAt).toLocaleDateString('ko-KR')}</p>
</div>

<div class="stats-row">
  <div class="stat-card"><div class="value">${totalPrompts}</div><div class="label">총 프롬프트</div></div>
  <div class="stat-card"><div class="value">${avgScore}</div><div class="label">평균 점수</div></div>
  <div class="stat-card"><div class="value">${bestScore}</div><div class="label">최고 점수</div></div>
  <div class="stat-card"><div class="value">${worstScore}</div><div class="label">최저 점수</div></div>
</div>

<div class="charts-grid">
  <div class="chart-card">
    <h3>점수 추이</h3>
    <canvas id="scoreTrend"></canvas>
  </div>
  <div class="chart-card">
    <h3>5축 레이더 (최근 vs 평균)</h3>
    <canvas id="axisRadar"></canvas>
  </div>
  <div class="chart-card">
    <h3>등급 분포</h3>
    <canvas id="gradeDonut"></canvas>
  </div>
  <div class="chart-card">
    <h3>태그별 통계 (Top 10)</h3>
    <canvas id="tagBar"></canvas>
  </div>
</div>

<div class="table-section">
  <h3>최근 분석 기록 (최대 20건)</h3>
  <table>
    <thead><tr><th>날짜</th><th>등급</th><th>점수</th><th>프롬프트</th><th>태그</th></tr></thead>
    <tbody>
      ${recent.map(e => {
        const grade = e.score >= 90 ? 'A' : e.score >= 70 ? 'B' : e.score >= 50 ? 'C' : 'D';
        const cls = 'grade-' + grade.toLowerCase();
        const date = new Date(e.createdAt).toLocaleDateString('ko-KR');
        const tags = (e.tags || []).map(t => `<span class="tag">${escHtml(t)}</span>`).join('');
        return `<tr><td>${date}</td><td><span class="grade ${cls}">${grade}</span></td><td>${e.score}</td><td class="prompt-text" title="${escHtml(e.prompt)}">${escHtml(e.prompt)}</td><td>${tags}</td></tr>`;
      }).join('\n      ')}
    </tbody>
  </table>
</div>

<div class="footer">Generated by Promptic v0.3.0</div>

<script>
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = '#334155';

// Score Trend
new Chart(document.getElementById('scoreTrend'), {
  type: 'line',
  data: {
    labels: ${JSON.stringify(scoreTrendLabels)},
    datasets: [{
      label: '점수',
      data: ${JSON.stringify(scoreTrendData)},
      borderColor: '#38bdf8',
      backgroundColor: 'rgba(56,189,248,0.1)',
      fill: true,
      tension: 0.3,
      pointRadius: 3
    }]
  },
  options: {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: { y: { min: 0, max: 100, ticks: { stepSize: 20 } } }
  }
});

// 5-Axis Radar
new Chart(document.getElementById('axisRadar'), {
  type: 'radar',
  data: {
    labels: ${JSON.stringify(axisLabels)},
    datasets: [
      {
        label: '최근',
        data: ${JSON.stringify(latestAxis)},
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56,189,248,0.2)',
        pointRadius: 4
      },
      {
        label: '평균',
        data: ${JSON.stringify(avgAxis)},
        borderColor: '#facc15',
        backgroundColor: 'rgba(250,204,21,0.1)',
        pointRadius: 4
      }
    ]
  },
  options: {
    responsive: true,
    scales: { r: { min: 0, max: 100, ticks: { stepSize: 20 } } }
  }
});

// Grade Donut
new Chart(document.getElementById('gradeDonut'), {
  type: 'doughnut',
  data: {
    labels: ['A (90+)', 'B (70-89)', 'C (50-69)', 'D (<50)'],
    datasets: [{
      data: [${gradeCounts.A}, ${gradeCounts.B}, ${gradeCounts.C}, ${gradeCounts.D}],
      backgroundColor: ['#4ade80', '#facc15', '#fb923c', '#f87171'],
      borderWidth: 0
    }]
  },
  options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
});

// Tag Bar
new Chart(document.getElementById('tagBar'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(topTags.map(t => t[0]))},
    datasets: [{
      label: '사용 횟수',
      data: ${JSON.stringify(topTags.map(t => t[1]))},
      backgroundColor: 'rgba(56,189,248,0.6)',
      borderRadius: 4
    }]
  },
  options: {
    responsive: true,
    indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: { x: { ticks: { stepSize: 1 } } }
  }
});
</script>
</body>
</html>`;
}

/**
 * Generate a dashboard for all projects (overview).
 * @param {Array} projects - All projects
 * @param {object} historyMap - { projectId: [entries] }
 * @returns {string} Self-contained HTML string
 */
export function generateOverviewHtml(projects, historyMap) {
  const projectStats = projects.map(p => {
    const entries = historyMap[p.id] || [];
    const avg = entries.length > 0
      ? Math.round(entries.reduce((s, e) => s + e.score, 0) / entries.length)
      : 0;
    return { name: p.name, count: entries.length, avg };
  });

  const totalPrompts = projectStats.reduce((s, p) => s + p.count, 0);
  const allEntries = Object.values(historyMap).flat();
  const avgScore = allEntries.length > 0
    ? Math.round(allEntries.reduce((s, e) => s + e.score, 0) / allEntries.length)
    : 0;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Promptic — 전체 대시보드</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<style>
  :root {
    --bg: #0f172a; --surface: #1e293b; --border: #334155;
    --text: #e2e8f0; --text-muted: #94a3b8; --accent: #38bdf8;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 24px; }
  .header { text-align: center; margin-bottom: 32px; }
  .header h1 { font-size: 28px; font-weight: 700; }
  .header p { color: var(--text-muted); font-size: 14px; }
  .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-bottom: 32px; }
  .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; text-align: center; }
  .stat-card .value { font-size: 32px; font-weight: 700; color: var(--accent); }
  .stat-card .label { font-size: 13px; color: var(--text-muted); margin-top: 4px; }
  .chart-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 24px; max-width: 700px; margin-left: auto; margin-right: auto; }
  .chart-card h3 { font-size: 16px; margin-bottom: 16px; color: var(--text-muted); }
  .footer { text-align: center; margin-top: 32px; color: var(--text-muted); font-size: 12px; }
</style>
</head>
<body>
<div class="header">
  <h1>Promptic</h1>
  <p>전체 프로젝트 대시보드</p>
</div>
<div class="stats-row">
  <div class="stat-card"><div class="value">${projects.length}</div><div class="label">프로젝트</div></div>
  <div class="stat-card"><div class="value">${totalPrompts}</div><div class="label">총 프롬프트</div></div>
  <div class="stat-card"><div class="value">${avgScore}</div><div class="label">전체 평균 점수</div></div>
</div>
<div class="chart-card">
  <h3>프로젝트별 프롬프트 수 / 평균 점수</h3>
  <canvas id="projectChart"></canvas>
</div>
<div class="footer">Generated by Promptic v0.3.0</div>
<script>
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = '#334155';
new Chart(document.getElementById('projectChart'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(projectStats.map(p => p.name))},
    datasets: [
      { label: '프롬프트 수', data: ${JSON.stringify(projectStats.map(p => p.count))}, backgroundColor: 'rgba(56,189,248,0.6)', borderRadius: 4, yAxisID: 'y' },
      { label: '평균 점수', data: ${JSON.stringify(projectStats.map(p => p.avg))}, backgroundColor: 'rgba(250,204,21,0.6)', borderRadius: 4, yAxisID: 'y1' }
    ]
  },
  options: {
    responsive: true,
    scales: {
      y: { position: 'left', title: { display: true, text: '프롬프트 수' } },
      y1: { position: 'right', min: 0, max: 100, title: { display: true, text: '평균 점수' }, grid: { drawOnChartArea: false } }
    }
  }
});
</script>
</body>
</html>`;
}

function normalizeAxisScores(axisScores) {
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

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
