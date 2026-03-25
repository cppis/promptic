#!/usr/bin/env bash
# publish.sh — @cppis/promptic 새 버전 배포 스크립트
#
# 사용법:
#   ./scripts/publish.sh [patch|minor|major]
#
# 기본값: patch
# 예시:
#   ./scripts/publish.sh          # 1.0.0 → 1.0.1
#   ./scripts/publish.sh minor    # 1.0.0 → 1.1.0
#   ./scripts/publish.sh major    # 1.0.0 → 2.0.0

set -euo pipefail

# ── 설정 ────────────────────────────────────────────────────────────────────
PACKAGE_DIR="$(cd "$(dirname "$0")/../mcp-server" && pwd)"
BUMP="${1:-patch}"

# ── 유효성 검사 ──────────────────────────────────────────────────────────────
if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  echo "❌  잘못된 인자: '$BUMP'"
  echo "    사용법: $0 [patch|minor|major]"
  exit 1
fi

# npm 인증 확인 (NPM_TOKEN 환경변수 또는 ~/.npmrc)
if [[ -z "${NPM_TOKEN:-}" ]]; then
  if ! npm whoami &>/dev/null; then
    echo "❌  npm 로그인이 필요합니다."
    echo "    NPM_TOKEN 환경변수를 설정하거나 'npm login' 을 실행하세요."
    exit 1
  fi
fi

# git 작업 디렉터리가 깨끗한지 확인
# (미커밋 변경사항이 있으면 배포 전에 정리하도록 강제)
# untracked 파일(??)은 무시한다 — git으로 관리하지 않는 파일은 배포에 영향 없음
cd "$PACKAGE_DIR/.."
if [[ -n "$(git status --porcelain | grep -v '^??')" ]]; then
  echo "❌  커밋되지 않은 변경사항이 있습니다. 먼저 커밋하고 배포하세요."
  git status --short
  exit 1
fi

# ── 버전 bump ────────────────────────────────────────────────────────────────
cd "$PACKAGE_DIR"

OLD_VERSION=$(node -p "require('./package.json').version")

# npm version은 git tag도 자동 생성하므로 --no-git-tag-version 으로 직접 제어
npm version "$BUMP" --no-git-tag-version

NEW_VERSION=$(node -p "require('./package.json').version")

echo ""
echo "📦  버전 업데이트: $OLD_VERSION → $NEW_VERSION"

# ── npm publish ──────────────────────────────────────────────────────────────
echo "🚀  npm 배포 중..."

PUBLISH_CMD="npm publish --access=public"

if [[ -n "${NPM_TOKEN:-}" ]]; then
  # CI/CD 환경: 환경변수 토큰 사용
  npm publish --access=public --//registry.npmjs.org/:_authToken="$NPM_TOKEN"
else
  # 로컬 환경: npm 로그인 세션 사용
  $PUBLISH_CMD
fi

echo "✅  @cppis/promptic@$NEW_VERSION 배포 완료!"
echo "    https://www.npmjs.com/package/@cppis/promptic"

# ── git commit & tag ─────────────────────────────────────────────────────────
cd "$PACKAGE_DIR/.."

git add mcp-server/package.json
git commit -m "chore(release): @cppis/promptic@$NEW_VERSION"
git tag "v$NEW_VERSION"

echo ""
echo "🏷️   git 태그 생성: v$NEW_VERSION"
echo "    원격에 push 하려면:"
echo "    git push && git push origin v$NEW_VERSION"
