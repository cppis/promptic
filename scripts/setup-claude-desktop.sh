#!/bin/bash
#
# Prompatic — Claude Desktop MCP 설정 스크립트
#
# 사용법:
#   ./scripts/setup-claude-desktop.sh          # 로컬 소스 모드 (개발용)
#   ./scripts/setup-claude-desktop.sh --npx    # npx 모드 (배포 후)
#   ./scripts/setup-claude-desktop.sh --remove # 설정 제거
#

set -e

# ── 색상 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ── config 파일 경로 결정 ──
detect_config_path() {
  case "$(uname -s)" in
    Darwin)
      echo "$HOME/Library/Application Support/Claude/claude_desktop_config.json"
      ;;
    Linux)
      # WSL 환경 감지
      if grep -qi microsoft /proc/version 2>/dev/null; then
        # WSL: Windows 쪽 AppData 경로 사용
        WIN_APPDATA=$(cmd.exe /c "echo %APPDATA%" 2>/dev/null | tr -d '\r')
        if [ -n "$WIN_APPDATA" ]; then
          echo "$(wslpath "$WIN_APPDATA")/Claude/claude_desktop_config.json"
        else
          echo "$HOME/.config/Claude/claude_desktop_config.json"
        fi
      else
        echo "$HOME/.config/Claude/claude_desktop_config.json"
      fi
      ;;
    MINGW*|MSYS*|CYGWIN*)
      echo "$APPDATA/Claude/claude_desktop_config.json"
      ;;
    *)
      echo "$HOME/.config/Claude/claude_desktop_config.json"
      ;;
  esac
}

# ── index.js 절대 경로 결정 ──
get_server_path() {
  local script_dir
  script_dir="$(cd "$(dirname "$0")" && pwd)"
  echo "$(cd "$script_dir/../mcp-server" && pwd)/index.js"
}

# ── WSL 환경 감지 ──
is_wsl() {
  grep -qi microsoft /proc/version 2>/dev/null
}

# ── JSON 처리 (node 사용) ──
merge_config() {
  local config_file="$1"
  local mode="$2"
  local server_path="$3"
  local is_wsl_env="$4"

  node -e "
    const fs = require('fs');
    const configPath = '$config_file';
    const mode = '$mode';
    const serverPath = '$server_path';
    const isWsl = '$is_wsl_env' === 'true';

    // 기존 config 읽기 (없으면 빈 객체)
    let config = {};
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (e) {}

    if (!config.mcpServers) config.mcpServers = {};

    if (mode === 'npx') {
      if (isWsl) {
        // WSL: Windows 쪽 Claude Desktop이 wsl 명령어로 npx를 호출하도록 설정
        config.mcpServers.prompatic = {
          command: 'wsl',
          args: ['npx', '-y', 'prompatic']
        };
      } else {
        config.mcpServers.prompatic = {
          command: 'npx',
          args: ['-y', 'prompatic']
        };
      }
    } else {
      if (isWsl) {
        // WSL: Windows 쪽 Claude Desktop이 wsl 명령어로 node를 호출하도록 설정
        // WSL 리눅스 경로를 그대로 사용 (wsl 내부에서 해석됨)
        config.mcpServers.prompatic = {
          command: 'wsl',
          args: ['node', serverPath]
        };
      } else {
        config.mcpServers.prompatic = {
          command: 'node',
          args: [serverPath]
        };
      }
    }

    // 디렉토리 생성
    const dir = require('path').dirname(configPath);
    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    console.log(JSON.stringify(config.mcpServers.prompatic, null, 2));
  "
}

remove_config() {
  local config_file="$1"

  node -e "
    const fs = require('fs');
    const configPath = '$config_file';

    let config = {};
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (e) {
      console.log('config 파일이 없습니다.');
      process.exit(0);
    }

    if (config.mcpServers && config.mcpServers.prompatic) {
      delete config.mcpServers.prompatic;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      console.log('삭제 완료');
    } else {
      console.log('prompatic 설정이 없습니다.');
    }
  "
}

# ── 메인 ──
MODE="local"
if [ "$1" = "--npx" ]; then
  MODE="npx"
elif [ "$1" = "--remove" ]; then
  MODE="remove"
fi

CONFIG_PATH=$(detect_config_path)

# WSL 환경 감지
WSL_ENV="false"
if is_wsl; then
  WSL_ENV="true"
fi

echo ""
echo -e "${GREEN}Prompatic — Claude Desktop MCP 설정${NC}"
echo ""
echo -e "  config: ${YELLOW}${CONFIG_PATH}${NC}"
if [ "$WSL_ENV" = "true" ]; then
  echo -e "  환경:   ${YELLOW}WSL (Windows 쪽 Claude Desktop에 wsl 명령어로 연결)${NC}"
fi

if [ "$MODE" = "remove" ]; then
  echo -e "  작업:   ${RED}설정 제거${NC}"
  echo ""
  remove_config "$CONFIG_PATH"
  echo ""
  echo -e "${GREEN}완료.${NC} Claude Desktop을 재시작하세요."
  exit 0
fi

if [ "$MODE" = "npx" ]; then
  echo -e "  모드:   npx (배포 버전)"
  echo ""
  RESULT=$(merge_config "$CONFIG_PATH" "npx" "" "$WSL_ENV")
else
  SERVER_PATH=$(get_server_path)
  if [ ! -f "$SERVER_PATH" ]; then
    echo ""
    echo -e "${RED}오류: $SERVER_PATH 파일을 찾을 수 없습니다.${NC}"
    echo "  mcp-server 디렉토리에서 npm install을 먼저 실행하세요."
    exit 1
  fi
  echo -e "  모드:   local (소스 직접 실행)"
  echo -e "  서버:   ${YELLOW}${SERVER_PATH}${NC}"
  if [ "$WSL_ENV" = "true" ]; then
    echo -e "  실행:   ${YELLOW}wsl node ${SERVER_PATH}${NC}"
  fi
  echo ""
  RESULT=$(merge_config "$CONFIG_PATH" "local" "$SERVER_PATH" "$WSL_ENV")
fi

echo -e "  설정 내용:"
echo "$RESULT" | sed 's/^/    /'
echo ""
echo -e "${GREEN}완료.${NC} Claude Desktop을 재시작하세요."
