/**
 * Prompatic — Claude conversation importer for MCP Server
 *
 * Imports from:
 * - Claude Desktop: conversations.json (array of conversations with chat_messages)
 * - Claude Code: .jsonl files (line-delimited JSON with user/assistant messages)
 */

function extractContent(message) {
  if (!message) return '';
  const content = message.content ?? message;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text.trim())
      .join('\n')
      .trim();
  }
  return '';
}

// ── Claude Desktop ──

function parseDesktopConversations(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Invalid JSON'); }

  let conversations = [];
  if (Array.isArray(data)) conversations = data;
  else if (data.conversations) conversations = data.conversations;
  else if (data.chat_messages) conversations = [data];

  const groups = [];

  for (const conv of conversations) {
    const messages = conv.chat_messages || conv.messages || [];
    const name = (conv.name || '').trim() || 'Untitled';
    const pairs = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const sender = msg.sender || msg.role || '';
      if (sender !== 'human' && sender !== 'user') continue;

      const userText = (msg.text || extractContent(msg) || '').trim();
      if (!userText || userText.length < 10) continue;

      let response = '';
      for (let j = i + 1; j < messages.length; j++) {
        const next = messages[j];
        const ns = next.sender || next.role || '';
        if (ns === 'human' || ns === 'user') break;
        if (ns === 'assistant') {
          response = (next.text || extractContent(next) || '').trim();
          break;
        }
      }

      pairs.push({
        prompt: userText,
        response: response.slice(0, 2000),
        timestamp: msg.created_at || conv.created_at || new Date().toISOString()
      });
    }

    if (pairs.length > 0) {
      groups.push({ name, entries: pairs });
    }
  }

  return groups;
}

// ── Claude Code ──

function parseCodeJsonl(text) {
  const lines = text.split('\n').filter(l => l.trim());
  const messages = [];

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'user' || obj.type === 'assistant') {
        const content = extractContent(obj.message);
        if (content) {
          messages.push({
            type: obj.type,
            content,
            timestamp: obj.timestamp,
            sessionId: obj.sessionId
          });
        }
      }
    } catch { /* skip */ }
  }

  // Pair user→assistant
  const pairs = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].type !== 'user') continue;
    let response = '';
    for (let j = i + 1; j < messages.length; j++) {
      if (messages[j].type === 'user') break;
      if (messages[j].type === 'assistant') {
        response += (response ? '\n' : '') + messages[j].content;
      }
    }
    if (messages[i].content.length >= 10) {
      pairs.push({
        prompt: messages[i].content,
        response: response.slice(0, 2000),
        timestamp: messages[i].timestamp,
        sessionId: messages[i].sessionId
      });
    }
  }

  // Group by sessionId
  const sessionMap = new Map();
  for (const p of pairs) {
    const sid = p.sessionId || 'default';
    if (!sessionMap.has(sid)) sessionMap.set(sid, []);
    sessionMap.get(sid).push(p);
  }

  return Array.from(sessionMap.entries()).map(([sid, entries], i) => ({
    name: `Claude Code Session ${i + 1}`,
    entries
  }));
}

// ── Import functions ──

async function importGroups(storage, groups, source, mode, projectName) {
  const seen = new Set();
  let totalImported = 0;
  let totalSkipped = 0;
  const projectIds = [];

  if (mode === 'single') {
    // Merge all into one project
    const proj = await storage.createProject(projectName || `${source} Import (${new Date().toLocaleDateString()})`);
    projectIds.push(proj.id);

    for (const group of groups) {
      for (const entry of group.entries) {
        const key = entry.prompt.trim().toLowerCase().slice(0, 200);
        if (seen.has(key)) { totalSkipped++; continue; }
        seen.add(key);

        await storage.addHistoryEntry(proj.id, {
          prompt: entry.prompt,
          enhanced: '',
          score: 0,
          axisScores: [0, 0, 0, 0, 0],
          tags: [source, group.name.slice(0, 30)],
          note: entry.response ? `[${group.name}] ${entry.response.slice(0, 300)}...` : `[${source}]`,
          platform: 'claude',
          createdAt: entry.timestamp
        });
        totalImported++;
      }
    }
  } else {
    // Per-conversation: each group becomes a project
    for (const group of groups) {
      const proj = await storage.createProject(group.name);
      projectIds.push(proj.id);

      for (const entry of group.entries) {
        const key = entry.prompt.trim().toLowerCase().slice(0, 200);
        if (seen.has(key)) { totalSkipped++; continue; }
        seen.add(key);

        await storage.addHistoryEntry(proj.id, {
          prompt: entry.prompt,
          enhanced: '',
          score: 0,
          axisScores: [0, 0, 0, 0, 0],
          tags: [source],
          note: entry.response ? `[${group.name}] ${entry.response.slice(0, 300)}...` : `[${source}]`,
          platform: 'claude',
          createdAt: entry.timestamp
        });
        totalImported++;
      }
    }
  }

  return {
    imported: totalImported,
    skipped: totalSkipped,
    projectCount: projectIds.length,
    projectIds
  };
}

export async function importClaudeDesktop(storage, text, mode = 'per-conversation', projectName) {
  const groups = parseDesktopConversations(text);
  return importGroups(storage, groups, 'claude-desktop', mode, projectName);
}

export async function importClaudeCode(storage, text, mode = 'per-conversation', projectName) {
  const groups = parseCodeJsonl(text);
  return importGroups(storage, groups, 'claude-code', mode, projectName);
}
