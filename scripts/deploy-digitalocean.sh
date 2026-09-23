#!/usr/bin/env bash
# Deploy HoldPose API to DigitalOcean App Platform.
#
# Prerequisites:
#   export DIGITALOCEAN_ACCESS_TOKEN=dop_v1_...
#   Docker running (for image path) OR GitHub linked to your DO account (git path)
#
# Usage:
#   ./scripts/deploy-digitalocean.sh
#   ./scripts/deploy-digitalocean.sh --image   # build/push Container Registry (no GitHub OAuth)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DOCTL="${DOCTL:-$HOME/bin/doctl}"
if ! command -v "$DOCTL" >/dev/null 2>&1 && ! command -v doctl >/dev/null 2>&1; then
  echo "doctl not found. Install: https://docs.digitalocean.com/reference/doctl/how-to/install/"
  exit 1
fi
command -v doctl >/dev/null 2>&1 && DOCTL="$(command -v doctl)" || true
[[ -x "$DOCTL" ]] || DOCTL="$(command -v doctl)"

if [[ -z "${DIGITALOCEAN_ACCESS_TOKEN:-}" ]]; then
  echo "Set DIGITALOCEAN_ACCESS_TOKEN first (DigitalOcean → API → Tokens)."
  echo "  export DIGITALOCEAN_ACCESS_TOKEN=dop_v1_..."
  exit 1
fi

# Load .env without printing secrets
set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a

: "${MONGO_URI:?MONGO_URI missing in .env}"
: "${JWT_SECRET:?JWT_SECRET missing in .env}"

ADMIN_EMAIL="${ADMIN_EMAIL:-admin@snapapp.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin@123}"
FIREBASE_STORAGE_BUCKET="${FIREBASE_STORAGE_BUCKET:-snap-app-8c28d.firebasestorage.app}"
APP_NAME="${DO_APP_NAME:-holdpose-api}"
REGION="${DO_REGION:-nyc}"
MODE="${1:-}"

# Inline Firebase SA JSON if file exists and env not set
if [[ -z "${FIREBASE_SERVICE_ACCOUNT:-}" ]]; then
  SA_FILE="$(ls "$ROOT"/snap-app-*-firebase-adminsdk-*.json 2>/dev/null | head -1 || true)"
  if [[ -n "$SA_FILE" ]]; then
    FIREBASE_SERVICE_ACCOUNT="$(python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1]))))' "$SA_FILE")"
  fi
fi

"$DOCTL" auth init -t "$DIGITALOCEAN_ACCESS_TOKEN" --context holdpose >/dev/null
"$DOCTL" auth switch --context holdpose >/dev/null

echo "==> Account:"
"$DOCTL" account get --format Email,Status

SPEC_DIR="$(mktemp -d)"
SPEC="$SPEC_DIR/app.yaml"
trap 'rm -rf "$SPEC_DIR"' EXIT

if [[ "$MODE" == "--image" ]]; then
  REGISTRY_NAME="${DO_REGISTRY:-holdpose}"
  IMAGE_REPO="holdpose-api"
  IMAGE_TAG="$(date +%Y%m%d%H%M%S)"

  echo "==> Ensuring Container Registry: ${REGISTRY_NAME}"
  if ! "$DOCTL" registry get >/dev/null 2>&1; then
    "$DOCTL" registry create "$REGISTRY_NAME" --subscription-tier starter || true
  fi

  REGISTRY_HOST="$("$DOCTL" registry get --format Hostname --no-header)"
  FULL_IMAGE="${REGISTRY_HOST}/${IMAGE_REPO}:${IMAGE_TAG}"

  echo "==> Building ${FULL_IMAGE}"
  docker build -t "$FULL_IMAGE" -t "${REGISTRY_HOST}/${IMAGE_REPO}:latest" .

  echo "==> Logging into DOCR"
  "$DOCTL" registry login

  echo "==> Pushing image"
  docker push "$FULL_IMAGE"
  docker push "${REGISTRY_HOST}/${IMAGE_REPO}:latest"

  cat > "$SPEC" <<EOF
name: ${APP_NAME}
region: ${REGION}
services:
  - name: api
    http_port: 8080
    instance_count: 1
    instance_size_slug: apps-s-1vcpu-1gb-fixed
    image:
      registry_type: DOCR
      repository: ${IMAGE_REPO}
      tag: ${IMAGE_TAG}
    routes:
      - path: /
    health_check:
      http_path: /api/health
      initial_delay_seconds: 25
      period_seconds: 15
      timeout_seconds: 5
      success_threshold: 1
      failure_threshold: 6
    envs:
      - key: NODE_ENV
        value: "production"
      - key: PORT
        value: "8080"
      - key: MONGO_URI
        value: ${MONGO_URI}
        type: SECRET
      - key: JWT_SECRET
        value: ${JWT_SECRET}
        type: SECRET
      - key: ADMIN_EMAIL
        value: ${ADMIN_EMAIL}
        type: SECRET
      - key: ADMIN_PASSWORD
        value: ${ADMIN_PASSWORD}
        type: SECRET
      - key: FIREBASE_STORAGE_BUCKET
        value: ${FIREBASE_STORAGE_BUCKET}
      - key: PUBLIC_SHARE_BASE_URL
        value: "https://placeholder.ondigitalocean.app"
EOF

  if [[ -n "${FIREBASE_SERVICE_ACCOUNT:-}" ]]; then
    # YAML multiline via escaped JSON string
    python3 - "$SPEC" <<'PY'
import os, sys, yaml
path = sys.argv[1]
with open(path) as f:
    data = yaml.safe_load(f)
sa = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")
if sa:
    data["services"][0]["envs"].append({
        "key": "FIREBASE_SERVICE_ACCOUNT",
        "value": sa,
        "type": "SECRET",
    })
with open(path, "w") as f:
    yaml.safe_dump(data, f, default_flow_style=False, sort_keys=False)
PY
  fi
else
  # GitHub-linked deploy (requires DO ↔ GitHub connection in the control panel)
  cat > "$SPEC" <<EOF
name: ${APP_NAME}
region: ${REGION}
services:
  - name: api
    http_port: 8080
    instance_count: 1
    instance_size_slug: apps-s-1vcpu-1gb-fixed
    dockerfile_path: Dockerfile
    github:
      repo: rashidjatoi/snap-app-backend
      branch: feature/poseping-friends
      deploy_on_push: true
    routes:
      - path: /
    health_check:
      http_path: /api/health
      initial_delay_seconds: 25
      period_seconds: 15
      timeout_seconds: 5
      success_threshold: 1
      failure_threshold: 6
    envs:
      - key: NODE_ENV
        value: "production"
      - key: PORT
        value: "8080"
      - key: MONGO_URI
        value: ${MONGO_URI}
        type: SECRET
      - key: JWT_SECRET
        value: ${JWT_SECRET}
        type: SECRET
      - key: ADMIN_EMAIL
        value: ${ADMIN_EMAIL}
        type: SECRET
      - key: ADMIN_PASSWORD
        value: ${ADMIN_PASSWORD}
        type: SECRET
      - key: FIREBASE_STORAGE_BUCKET
        value: ${FIREBASE_STORAGE_BUCKET}
      - key: PUBLIC_SHARE_BASE_URL
        value: "https://placeholder.ondigitalocean.app"
EOF
fi

EXISTING="$("$DOCTL" apps list --format ID,Spec.Name --no-header 2>/dev/null | awk -v n="$APP_NAME" '$2==n{print $1; exit}')"

if [[ -n "$EXISTING" ]]; then
  echo "==> Updating existing app ${EXISTING}"
  "$DOCTL" apps update "$EXISTING" --spec "$SPEC"
  APP_ID="$EXISTING"
else
  echo "==> Creating app ${APP_NAME}"
  APP_ID="$("$DOCTL" apps create --spec "$SPEC" --format ID --no-header)"
fi

echo "==> Waiting for deployment (this can take several minutes)..."
for i in $(seq 1 60); do
  PHASE="$("$DOCTL" apps get "$APP_ID" --format ActiveDeployment.Phase --no-header 2>/dev/null || echo UNKNOWN)"
  URL="$("$DOCTL" apps get "$APP_ID" --format DefaultIngress --no-header 2>/dev/null || true)"
  echo "  [$i] phase=${PHASE} url=${URL}"
  case "$PHASE" in
    ACTIVE)
      break
      ;;
    ERROR|CANCELED|SUPERSEDED)
      echo "Deployment failed: $PHASE"
      "$DOCTL" apps get "$APP_ID"
      exit 1
      ;;
  esac
  sleep 15
done

URL="$("$DOCTL" apps get "$APP_ID" --format DefaultIngress --no-header)"
URL="${URL%/}"
if [[ -n "$URL" && "$URL" != "https://placeholder.ondigitalocean.app" ]]; then
  echo "==> Setting PUBLIC_SHARE_BASE_URL=${URL}"
  # Patch share URL to the real app host
  python3 - "$SPEC" "$URL" <<'PY'
import sys, yaml
path, url = sys.argv[1], sys.argv[2].rstrip("/")
with open(path) as f:
    data = yaml.safe_load(f)
for e in data["services"][0]["envs"]:
    if e.get("key") == "PUBLIC_SHARE_BASE_URL":
        e["value"] = url
with open(path, "w") as f:
    yaml.safe_dump(data, f, default_flow_style=False, sort_keys=False)
PY
  "$DOCTL" apps update "$APP_ID" --spec "$SPEC" >/dev/null || true
fi

echo ""
echo "==> Deployed"
echo "    App ID:  ${APP_ID}"
echo "    URL:     ${URL}"
echo "    Health:  ${URL}/api/health"
echo ""
echo "Point Flutter API_BASE_URL to: ${URL}/api"
