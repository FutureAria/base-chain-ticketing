#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${ROOT_DIR}/deploy/oracle-demo/out"
STAGE_DIR="${OUT_DIR}/basechain-demo"
ARTIFACT="${OUT_DIR}/basechain-demo.tar.gz"

rm -rf "${STAGE_DIR}" "${ARTIFACT}"
mkdir -p "${STAGE_DIR}/Proje" "${STAGE_DIR}/server" "${STAGE_DIR}/deploy/oracle-demo" "${STAGE_DIR}/docs"

: "${VITE_API_URL:=https://juyoung-basechain.duckdns.org}"
: "${VITE_DEMO_ALLOW_MOCK_SIGNATURE:=true}"
export VITE_API_URL
export VITE_DEMO_ALLOW_MOCK_SIGNATURE

echo "[basechain-demo] Building frontend..."
(cd "${ROOT_DIR}/Proje" && npm run build)

echo "[basechain-demo] Copying lightweight runtime files..."
cp -R "${ROOT_DIR}/Proje/dist" "${STAGE_DIR}/Proje/dist"
cp "${ROOT_DIR}/Proje/package.json" "${STAGE_DIR}/Proje/package.json"
cp "${ROOT_DIR}/Proje/.env.example" "${STAGE_DIR}/Proje/.env.example"

rsync -a \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude 'logs' \
  --exclude '*.log' \
  --exclude 'coverage' \
  --exclude '.DS_Store' \
  "${ROOT_DIR}/server/" "${STAGE_DIR}/server/"

cp -R "${ROOT_DIR}/deploy/oracle-demo/"*.example "${STAGE_DIR}/deploy/oracle-demo/"
cp "${ROOT_DIR}/deploy/oracle-demo/preflight.js" "${STAGE_DIR}/deploy/oracle-demo/preflight.js"
cp "${ROOT_DIR}/deploy/oracle-demo/README.md" "${STAGE_DIR}/deploy/oracle-demo/README.md"
cp "${ROOT_DIR}/docs/ORACLE_DEMO_DEPLOYMENT.md" "${STAGE_DIR}/docs/ORACLE_DEMO_DEPLOYMENT.md"
cp "${ROOT_DIR}/README.md" "${STAGE_DIR}/README.md"

echo "[basechain-demo] Checking artifact contents..."
if find "${STAGE_DIR}" -name '.env' -o -name 'node_modules' -o -name '*.log' | grep -q .; then
  echo "Unsafe or heavy files were copied into the artifact." >&2
  find "${STAGE_DIR}" -name '.env' -o -name 'node_modules' -o -name '*.log' >&2
  exit 1
fi

echo "[basechain-demo] Running preflight..."
node "${ROOT_DIR}/deploy/oracle-demo/preflight.js" \
  --env "${ROOT_DIR}/deploy/oracle-demo/basechain-demo.env.example" \
  --frontend-env "${ROOT_DIR}/Proje/.env.example" \
  --dist "${ROOT_DIR}/Proje/dist"

echo "[basechain-demo] Creating tarball..."
(cd "${OUT_DIR}" && tar -czf "${ARTIFACT}" basechain-demo)

du -sh "${ARTIFACT}" "${STAGE_DIR}"
echo "[basechain-demo] Artifact ready: ${ARTIFACT}"
