# Promptic — Getting Started

[![EN](https://img.shields.io/badge/lang-EN-blue)](README.md) [![KO](https://img.shields.io/badge/lang-한국어-brightgreen)](README.ko.md)

[![npm version](https://img.shields.io/npm/v/Promptic?color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cppis/promptic)
[![npm downloads](https://img.shields.io/npm/dm/Promptic?color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cppis/promptic)
[![Node.js](https://img.shields.io/node/v/Promptic?color=339933&logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/cppis/prompt-lens/blob/main/LICENSE)
[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-blueviolet?logo=anthropic&logoColor=white)](https://modelcontextprotocol.io/)
[![GitHub release](https://img.shields.io/github/v/release/cppis/prompt-lens?logo=github)](https://github.com/cppis/prompt-lens/releases)
[![GitHub last commit](https://img.shields.io/github/last-commit/cppis/prompt-lens?logo=github)](https://github.com/cppis/prompt-lens/commits/main)
[![GitHub issues](https://img.shields.io/github/issues/cppis/prompt-lens?logo=github)](https://github.com/cppis/prompt-lens/issues)
[![GitHub stars](https://img.shields.io/github/stars/cppis/prompt-lens?style=social)](https://github.com/cppis/prompt-lens)

Promptic는 Claude Desktop과 Claude Code에서 동작하는 MCP(Model Context Protocol) 서버입니다.
AI가 내 프롬프트를 어떻게 읽었는지 — 무엇을 이해했고, 무엇을 추측했고, 무엇을 몰랐는지 — 를 명시적으로 보여줍니다.

`>> anz`, `>> 분석` 커맨드 또는 "이 프롬프트 분석해줘"라고 말하는 것만으로 바로 사용할 수 있습니다.
로컬 모드는 API 키 없이 무료로 즉시 실행됩니다.

> 5분 안에 Promptic를 설치하고 첫 프롬프트를 분석해봅니다.  

---

## 준비물

- **Node.js 18 이상** — [다운로드](https://nodejs.org/)
- **Claude Desktop** 또는 **Claude Code** — [Claude Desktop 다운로드](https://claude.ai/download)

---

## Step 1. MCP 서버 등록

Promptic를 Claude에 연결하는 단계입니다. 개발 중인 소스를 사용하는 방법과 npm 배포판을 사용하는 방법이 있습니다.

### 방법 A: 소스에서 직접 실행 (개발용)

```bash
git clone https://github.com/cppis/prompt-lens.git
cd prompt-lens/mcp-server
npm install
```

자동 설정 스크립트를 실행하면 Claude Desktop에 Promptic가 등록됩니다:

```bash
./scripts/setup-claude-desktop.sh
```

스크립트가 OS를 감지하여 `claude_desktop_config.json`에 자동 등록합니다. 기존 MCP 설정은 유지됩니다.

**Claude Code를 사용하는 경우:**

```bash
claude mcp add Promptic node /your/path/to/prompt-lens/mcp-server/index.js
```

<details>
<summary>수동 설정 (자동 스크립트 대신 직접 config 편집)</summary>

| OS | config 파일 경로 |
|------|-----------------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "Promptic": {
      "command": "node",
      "args": ["/your/path/to/prompt-lens/mcp-server/index.js"]
    }
  }
}
```

> `/your/path/to/` 부분을 실제 clone한 경로로 바꿔주세요. 설정 후 Claude Desktop을 재시작합니다.
</details>

### 방법 B: npx로 실행 (npm 배포 후)

npm에 publish된 후에는 소스 clone 없이 바로 사용할 수 있습니다.

```json
{
  "mcpServers": {
    "Promptic": {
      "command": "npx",
      "args": ["-y", "@cppis/promptic"]
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add Promptic -- npx -y Promptic
```

---

## Step 2. Claude Desktop 재시작

config 파일을 저장한 후 **Claude Desktop을 완전히 종료하고 다시 실행**합니다.

정상적으로 등록되면 Claude Desktop 입력창 우측 하단에 MCP 도구 아이콘(🔧)이 나타나고, `Promptic`가 목록에 보입니다.

**확인 방법 (Claude Code):**

```bash
claude mcp list
```

출력에 `Promptic`가 있으면 성공입니다.

---

## Step 3. 첫 프롬프트 분석

Promptic는 아래 방법 중 하나만 감지하면 **자동으로 호출**됩니다.

### Trigger Rules — Promptic 자동 호출 조건

| # | 방법 | 예시 |
|---|------|------|
| 1 | **커맨드 `>> anz` / `>> 분석`** | `React로 로그인 폼 만들어줘 >> anz` |
| 2 | **커맨드 `>> anz+run` / `>> 분석+실행`** | `REST API 설계해줘 >> anz+run` |
| 3 | **커맨드 `>> deep` / `>> 정밀분석`** | `시스템 설계해줘 >> 정밀분석` |
| 4 | **영어 자연어** | `analyze this prompt`, `how good is this`, `review this prompt` |
| 5 | **한글 자연어** | `이 프롬프트 분석해줘`, `이 프롬프트 어때?`, `프롬프트 좀 봐줘` |
| 6 | **암시적 개선 요청** | `이거 좀 부족한데`, `이거 어떻게 개선해?`, `what's wrong with this` |

> 룰 #1·2·3은 메시지 끝에 커맨드를 붙이면 발동됩니다. 커맨드 앞의 모든 텍스트가 분석 대상 프롬프트로 처리됩니다.

각 커맨드의 동작 차이:

| 커맨드 | 동작 |
|--------|------|
| `>> anz` / `>> 분석` | 분석 결과 + 개선 제안만 보여줌 |
| `>> anz+run` / `>> 분석+실행` | 분석 후 개선된 프롬프트를 **즉시 실행** |
| `>> deep` / `>> 정밀분석` | 분석 → 개선 → 재분석 → 비교 (4단계 파이프라인) |

### 토큰 사용량 가이드

Promptic 기능별 토큰 소비량 비교입니다. **모델 선택이 가장 큰 변수**입니다.

**커맨드별 토큰 증가량 (Sonnet 기준, 일반 대화 대비):**

| 커맨드 | 토큰 증가 | 이유 |
|--------|----------|------|
| `>> anz` (local) | **+20~30%** | JSON 응답(점수·개선안) ~500토큰이 컨텍스트에 추가됨. 분석 자체는 LLM 미사용 |
| `>> anz+run` | **+50~80%** | 분석 JSON + 개선된 프롬프트로 실제 태스크 실행(출력 토큰 발생) |
| `>> deep` / `>> 정밀분석` | **+200~300%** | analyze_prompt 2회 호출 + 개선 프롬프트 생성 + 비교 응답, 총 4단계 |
| api 모드 | Claude 구독 토큰과 **별도** | Anthropic API 직접 호출 (Claude Desktop 토큰과 무관) |

**모델별 비용 비교 (동일 토큰 수 기준):**

| 모델 | 상대 비용 | 추천 용도 |
|------|----------|-----------|
| Claude Haiku 4.5 | **1x** (기준) | 빠른 반복 분석 |
| Claude Sonnet 4.6 | **약 4x** | 일반 분석 (권장) |
| Claude Opus 4.6 | **약 20x** | 최고 품질이 필요한 경우만 |

> **실용 팁:** 토큰을 아끼려면 일상 분석은 `>> anz` + Sonnet, 중요한 프롬프트만 `>> deep` 또는 Opus를 사용하세요. `>> deep`을 Opus로 실행하면 일반 대화 대비 **최대 10~15배** 토큰이 소비될 수 있습니다.

---

**예시 — 커맨드 사용:**

```
React로 로그인 폼 만들어줘 >> anz
```

**예시 — 자연어 사용:**

```
"React로 로그인 폼 만들어줘"라는 프롬프트를 분석해줘
```

Promptic가 자동으로 호출되어 분석 결과를 돌려줍니다:

```
📊 종합 점수: 43/100 (D등급)

5축 점수:
  - 명확성(Clarity): 55
  - 구체성(Specificity): 30
  - 맥락(Context): 35
  - 구조(Structure): 40
  - 실행성(Actionability): 50

❌ 누락된 요소: Role, Context, Output Format, Example, Constraints

💡 개선 제안:
  - 역할을 지정하세요 (예: "너는 시니어 React 개발자야")
  - 로그인 폼의 구체적 요구사항을 명시하세요
  - 원하는 출력 형식을 지정하세요

✨ 개선된 프롬프트:
  "너는 시니어 React 개발자야. TypeScript 기반의 로그인 폼 컴포넌트를 만들어줘.
   이메일/비밀번호 입력, 유효성 검증, 에러 메시지 표시를 포함하고,
   Tailwind CSS로 스타일링해줘. 코드와 함께 사용법을 설명해줘."
```

### MCP Prompts 워크플로우 (Claude Desktop `/` 메뉴)

Claude Desktop 대화창에서 `/`를 입력하면 Promptic 워크플로우 프리셋을 선택할 수 있습니다:

| 프리셋 | 설명 |
|--------|------|
| `quick-analyze` | 빠른 5축 분석 + 개선 제안 |
| `deep-analyze` | 4단계 정밀 분석 (분석 → 개선 → 재분석 → 비교) |
| `project-report` | 프로젝트 대시보드 생성 + 통계 요약 |

---

## 다음 단계

| 문서 | 내용 |
|------|------|
| [사용 가이드](docs/3.usage.md) | 도구별 파라미터, 시나리오별 사용법, 프로젝트 관리, 버전 관리, 시각화, API 모드, FAQ |
| [프로젝트 개요](docs/0.overview.md) | 아키텍처, 로드맵 |

### 빠른 명령 모음

| 하고 싶은 것 | Claude에게 이렇게 말하세요 |
|-------------|---------------------------|
| 프롬프트 분석 (간단) | `... >> anz` 또는 `... >> 분석` |
| 분석 + 즉시 실행 | `... >> anz+run` 또는 `... >> 분석+실행` |
| 정밀 분석 (4단계) | `... >> deep` 또는 `... >> 정밀분석` |
| 프롬프트 분석 (자연어) | `"이 프롬프트를 분석해줘: ..."` |
| 프로젝트 생성 | `"Promptic에 '프로젝트명' 프로젝트를 만들어줘"` |
| 활성 프로젝트 설정 | `"'프로젝트명'을 활성 프로젝트로 설정해줘"` |
| 프로젝트 시각화 | `... >> viz` 또는 `... >> 시각화` |
| 프롬프트 비교 | `... >> diff` |

전체 명령 목록은 [사용 가이드](docs/3.usage.md#전체-명령-모음)를 참고하세요.
