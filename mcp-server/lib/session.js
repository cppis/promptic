/**
 * 세션 컨텍스트 — MCP 서버 프로세스 생존 기간 동안 마지막 entryId를 추적한다.
 * 서버 재시작 시 초기화된다 (의도된 동작).
 */
const sessionCtx = {
  lastEntryId: null,
  lastProjectId: null,
};

export function getLastEntryId() {
  return sessionCtx.lastEntryId;
}

export function setLastEntryId(id) {
  sessionCtx.lastEntryId = id;
}

export function getLastProjectId() {
  return sessionCtx.lastProjectId;
}

export function setLastProjectId(id) {
  sessionCtx.lastProjectId = id;
}
