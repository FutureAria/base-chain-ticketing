#!/usr/bin/env bash
#
# 대회 제출용 ZIP 생성 스크립트
#
# Finder 압축이나 `zip -r .` 은 .gitignore 를 무시한다.
# 그대로 압축하면 server/.env (DB 비밀번호·JWT 키·지갑 개인키)가 그대로 딸려 나간다.
# 이 스크립트는 git 이 아는 파일만 담고, 압축 후 비밀 파일이 섞이지 않았는지 다시 확인한다.
#
# 사용법:  ./scripts/make-submission.sh [출력파일명]

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
OUT="${1:-$ROOT/basechain-submission.zip}"

if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo "❌ git 저장소가 아닙니다. 이 스크립트는 git 이 아는 파일만 담습니다."
  exit 1
fi

echo "▶ 대상 디렉터리: $ROOT"
rm -f "$OUT"

# 추적 중인 파일 + 아직 커밋하지 않은 새 파일 (단, .gitignore 대상은 제외)
#   -c: 추적 중,  -o: 추적 안 됨,  --exclude-standard: .gitignore 적용
FILES=$(git ls-files -co --exclude-standard)

if [ -z "$FILES" ]; then
  echo "❌ 담을 파일을 찾지 못했습니다."
  exit 1
fi

COUNT=$(echo "$FILES" | wc -l | tr -d ' ')
echo "▶ 포함할 파일: ${COUNT}개"

echo "$FILES" | zip -q "$OUT" -@

# ─── 검증: 비밀 파일이 섞이지 않았는지 ───────────────────────
echo "▶ 검증 중..."
# 목록을 한 번만 읽어 변수에 담는다.
# (파이프 뒤에 grep -q 를 쓰면 조기 종료가 SIGPIPE 를 일으켜 pipefail 과 충돌한다)
ZIP_LIST=$(unzip -Z1 "$OUT")

LEAKED=$(printf '%s\n' "$ZIP_LIST" | grep -E '(^|/)\.env$|(^|/)\.env\.[^e]|/node_modules/|(^|/)\.git/' || true)

if [ -n "$LEAKED" ]; then
  echo "❌ 들어가면 안 되는 파일이 포함됐습니다:"
  echo "$LEAKED" | sed 's/^/    /'
  rm -f "$OUT"
  echo "   ZIP 을 삭제했습니다. .gitignore 를 확인하세요."
  exit 1
fi

# 필수 파일이 빠지지 않았는지
MISSING=""
for required in README.md LICENSE server/package.json Proje/package.json; do
  printf '%s\n' "$ZIP_LIST" | grep -Fxq "$required" || MISSING="$MISSING $required"
done
if [ -n "$MISSING" ]; then
  echo "⚠️  다음 필수 파일이 ZIP 에 없습니다:$MISSING"
  exit 1
fi

SIZE=$(du -h "$OUT" | cut -f1)
echo
echo "✅ 제출용 ZIP 생성 완료"
echo "   파일: $OUT"
echo "   크기: $SIZE"
echo "   개수: ${COUNT}개"
echo
echo "   .env / node_modules / .git 미포함 확인됨"
