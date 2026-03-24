# PromptLens

> AI가 내 말을 어떻게 이해했는지 보여주고, 부족한 맥락을 알아서 채워준다.

PromptLens는 Claude Desktop과 Claude Code에서 MCP 도구로 동작하는 프롬프트 분석 시스템입니다.
대화 중 자연스럽게 "이 프롬프트를 분석해줘"라고 요청하면, 품질 점수·누락 요소·개선 제안을 즉시 받을 수 있습니다.

> **처음 사용하시나요?** 👉 [Getting Started 가이드](docs/getting-started.md)를 따라 5분 안에 시작해보세요.

---

## 목차

- [설치 및 설정](#설치-및-설정)
- [분석 모드](#분석-모드)
- [제공 도구](#제공-도구-9개)
- [사용법](#사용법)
- [개발](#개발)
- [npm 배포](#npm-배포)
- [문서](#문서)

---

## 설치 및 설정

> **config 파일 위치**
> - **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
> - **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

### 1. 로컬 개발 버전 (소스에서 직접 실행)

```bash
cd mcp-server
npm install
```

**자동 설정 (권장):**

```bash
./scripts/setup-claude-desktop.sh
```

스크립트가 OS를 감지하여 `claude_desktop_config.json`에 PromptLens를 자동 등록합니다. 기존 MCP 설정은 유지됩니다.

<details>
<summary>수동 설정</summary>

```json
{
  "mcpServers": {
    "promptlens": {
      "command": "node",
      "args": ["/absolute/path/to/prompt-lens/mcp-server/index.js"]
    }
  }
}
```

설정 후 Claude Desktop을 재시작합니다.
</details>

<details>
<summary>Claude Code 설정</summary>

```bash
claude mcp add promptlens node /absolute/path/to/prompt-lens/mcp-server/index.js
```
</details>

### 2. npm 배포 버전 (릴리즈 후)

npm에 publish된 후에는 설치 없이 npx로 실행할 수 있습니다.

**자동 설정:**

```bash
./scripts/setup-claude-desktop.sh --npx
```

<details>
<summary>수동 설정</summary>

```json
{
  "mcpServers": {
    "promptlens": {
      "command": "npx",
      "args": ["-y", "promptlens-mcp"]
    }
  }
}
```
</details>

<details>
<summary>Claude Code 설정</summary>

```bash
claude mcp add promptlens -- npx -y promptlens-mcp
```
</details>

---

## 분석 모드

| 모드 | 비용 | 분석 방식 |
|------|------|-----------|
| **local** (기본) | 무료 | 규칙 엔진 5축 점수 + 누락 요소 + 개선 제안 |
| **api** (선택) | BYOK | Claude API 3색 리포트: Referenced / Inferred / Missing |

local 모드는 API 키 없이 즉시 사용 가능합니다. API 모드를 쓰려면 Anthropic API 키를 등록합니다:

```
"PromptLens API 키를 설정해줘: sk-ant-api03-..."
```

---

## 제공 도구 (9개)

| 도구 | 설명 |
|------|------|
| `analyze_prompt` | 프롬프트 품질 분석 (mode: local/api) |
| `list_projects` | 모든 프로젝트 목록 + 통계 |
| `create_project` | 새 프로젝트 생성 |
| `get_history` | 프로젝트별 히스토리 조회 (검색·페이징) |
| `add_history_entry` | 프롬프트를 히스토리에 수동 추가 |
| `import_claude_conversations` | Claude Desktop/Code 대화 Import |
| `get_stats` | 전체 통계 (프로젝트 수, 평균 점수, 태그) |
| `set_api_key` | API 키 등록 + 유효성 검증 |
| `get_settings` | 현재 설정 확인 (API 키 상태, 모델) |

---

## 사용법

PromptLens의 모든 기능은 Claude Desktop 또는 Claude Code 대화에서 자연어로 사용합니다.
별도의 명령어 암기가 필요 없으며, 아래와 같이 말하면 됩니다.

### 1. 프롬프트 분석

가장 핵심적인 기능입니다. 분석하고 싶은 프롬프트를 Claude에게 전달하면 됩니다.

**로컬 분석 (기본, 무료):**

```
"React로 로그인 폼 만들어줘"라는 프롬프트를 분석해줘
```

5축 점수(명확성, 구체성, 맥락, 구조, 완전성)와 함께 누락된 요소, 개선 제안을 받습니다.
결과 예시: Score 43/100 (D등급) — 역할(Role), 맥락(Context), 출력 형식(Output Format), 예시(Example) 누락.

**API 분석 (3색 리포트, API 키 필요):**

```
이 프롬프트를 API 모드로 분석해줘: "React로 로그인 폼 만들어줘"
```

Claude API가 프롬프트를 3색으로 분류합니다:
- **Referenced** (명시적 언급): 프롬프트에 직접 적힌 정보
- **Inferred** (AI 추론): 명시하지 않았지만 AI가 추측하는 정보 + 신뢰도
- **Missing** (누락): 언급도 추론도 어려운 정보

**프로젝트에 분석 결과 저장:**

분석하면서 동시에 프로젝트에 기록을 남길 수 있습니다.

```
"React로 로그인 폼 만들어줘"를 분석하고, 프로젝트 "web-app"에 저장해줘
```

### 2. 프로젝트 관리

프로젝트를 만들어 프롬프트 히스토리를 체계적으로 관리할 수 있습니다.

**프로젝트 생성:**

```
PromptLens에 "챗봇 개발" 프로젝트를 만들어줘
```

**프로젝트 목록 조회:**

```
PromptLens 프로젝트 목록을 보여줘
```

각 프로젝트의 프롬프트 수, 평균 점수, 생성일을 확인할 수 있습니다.

### 3. 히스토리 관리

프로젝트별로 분석 기록을 조회하고 검색할 수 있습니다.

**히스토리 조회:**

```
"챗봇 개발" 프로젝트의 히스토리를 보여줘
```

최근 분석 기록이 날짜순으로 표시됩니다 (기본 20개).

**키워드로 검색:**

```
"챗봇 개발" 프로젝트에서 "로그인" 관련 히스토리를 찾아줘
```

프롬프트 내용, 태그, 메모를 기준으로 검색합니다.

**수동으로 프롬프트 기록:**

분석 없이 프롬프트만 히스토리에 남기고 싶을 때:

```
"챗봇 개발" 프로젝트에 "사용자 인증 플로우 설계해줘"를 기록해줘
```

### 4. 대화 Import

Claude Desktop이나 Claude Code에서 사용한 대화를 일괄 Import할 수 있습니다.

**Claude Desktop 대화 Import:**

```
~/Downloads/conversations.json을 PromptLens에 Import해줘
```

기본적으로 대화별로 프로젝트가 생성됩니다 (per-conversation 모드).

**하나의 프로젝트로 병합 Import:**

```
conversations.json을 "전체 대화" 프로젝트 하나로 Import해줘
```

**Claude Code 대화 Import (.jsonl):**

```
~/.claude/conversations/conversation.jsonl을 Import해줘
```

### 5. API 키 설정

API 분석 모드를 쓰려면 Anthropic API 키를 등록해야 합니다.

**키 등록:**

```
PromptLens API 키를 설정해줘: sk-ant-api03-...
```

키 등록 시 자동으로 유효성을 검증합니다. 유효하지 않은 키는 등록되지 않습니다.

**분석 모델 변경:**

```
PromptLens API 모델을 claude-3-5-haiku로 변경해줘
```

사용 가능 모델: `claude-sonnet-4-5-20250514` (기본), `claude-3-5-haiku-20241022`, `claude-opus-4-0-20250514`

### 6. 설정 및 통계 확인

**현재 설정 확인:**

```
PromptLens 설정을 보여줘
```

API 키 등록 여부, 사용 중인 모델, 데이터 저장 경로를 확인합니다.

**전체 통계 조회:**

```
PromptLens 통계를 보여줘
```

전체 프로젝트 수, 총 프롬프트 수, 평균 점수, 자주 쓰는 태그 등을 확인합니다.

---

## 개발

```bash
cd mcp-server
npm install
npm test          # 68개 테스트
node index.js     # 직접 실행
```

모든 데이터는 로컬에만 저장되며 외부로 전송되지 않습니다.

| 파일 | 경로 | 내용 |
|------|------|------|
| data.json | `~/.promptlens/data.json` | 프로젝트·히스토리 |
| settings.json | `~/.promptlens/settings.json` | API 키·모델 설정 |

---

## npm 배포

npm에 패키지를 publish해야 `npx promptlens-mcp`가 동작합니다.

```bash
# 사전 준비: npmjs.com 계정 생성 후
npm login

# 배포
cd mcp-server
npm test              # 테스트 통과 확인
npm publish           # npm에 배포

# 버전 업데이트 시
npm version patch     # 0.3.0 → 0.3.1 (버그 수정)
npm version minor     # 0.3.0 → 0.4.0 (기능 추가)
npm publish
```

배포 후 `npx promptlens-mcp`로 설치 없이 실행할 수 있고, `npm install -g promptlens-mcp`로 글로벌 설치도 가능합니다.

---

## 문서

| 문서 | 내용 |
|------|------|
| [getting-started.md](docs/getting-started.md) | **빠른 시작 가이드 (5분)** |
| [0.overview.md](docs/0.overview.md) | 프로젝트 개요, 아키텍처, 로드맵 |
| [1.add.md](docs/1.add.md) | 제품 설계 + 시장 조사 |
| [2.plan.md](docs/2.plan.md) | 개발 계획 + 기술 아키텍처 |
| [3.usage.md](docs/3.usage.md) | 사용 가이드, 도구 레퍼런스, FAQ |

## License

MIT
