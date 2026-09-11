# Deploy HoldPose backend to GCP Cloud Run (project: souqgate).
# Vercel deploy stays unchanged — this is an additional host for WebRTC/Socket.IO.
#
# Prerequisites:
#   gcloud auth login
#   gcloud config set project souqgate   # or the exact project id
#
# Usage:
#   ./scripts/deploy-cloud-run.sh
#   PUBLIC_SHARE_BASE_URL=https://YOUR-SERVICE-xxx.run.app ./scripts/deploy-cloud-run.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PROJECT_ID="${GCP_PROJECT_ID:-souqgate-b8d26}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${CLOUD_RUN_SERVICE:-holdpose-api}"
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE}:$(date +%Y%m%d%H%M%S)"

echo "==> Project: ${PROJECT_ID}"
echo "==> Region:  ${REGION}"
echo "==> Service: ${SERVICE}"
echo "==> Image:   ${IMAGE}"

gcloud config set project "${PROJECT_ID}"

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  containerregistry.googleapis.com \
  --project="${PROJECT_ID}"

echo "==> Building container with Cloud Build..."
gcloud builds submit --tag "${IMAGE}" --project="${PROJECT_ID}"

# Env vars — override with env before running, or edit here.
# Prefer Secret Manager in production; plain env is fine for first bring-up.
MONGO_URI="${MONGO_URI:?Set MONGO_URI}"
JWT_SECRET="${JWT_SECRET:?Set JWT_SECRET}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@snapapp.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin@123}"
FIREBASE_STORAGE_BUCKET="${FIREBASE_STORAGE_BUCKET:-snap-app-8c28d.firebasestorage.app}"
PUBLIC_SHARE_BASE_URL="${PUBLIC_SHARE_BASE_URL:-}"

ENV_VARS="JWT_SECRET=${JWT_SECRET}"
ENV_VARS+=",MONGO_URI=${MONGO_URI}"
ENV_VARS+=",ADMIN_EMAIL=${ADMIN_EMAIL}"
ENV_VARS+=",ADMIN_PASSWORD=${ADMIN_PASSWORD}"
ENV_VARS+=",FIREBASE_STORAGE_BUCKET=${FIREBASE_STORAGE_BUCKET}"
ENV_VARS+=",NODE_ENV=production"

if [[ -n "${PUBLIC_SHARE_BASE_URL}" ]]; then
  ENV_VARS+=",PUBLIC_SHARE_BASE_URL=${PUBLIC_SHARE_BASE_URL}"
fi

if [[ -n "${FIREBASE_SERVICE_ACCOUNT:-}" ]]; then
  # Pass as a Cloud Run secret/env separately if too large for --set-env-vars
  echo "==> FIREBASE_SERVICE_ACCOUNT will be set via --update-env-vars file"
fi

echo "==> Deploying to Cloud Run..."
# session-affinity helps Socket.IO sticky sessions for WebRTC signaling
gcloud run deploy "${SERVICE}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --cpu 1 \
  --memory 1Gi \
  --timeout 3600 \
  --concurrency 80 \
  --min-instances 0 \
  --max-instances 5 \
  --session-affinity \
  --set-env-vars "${ENV_VARS}" \
  --project "${PROJECT_ID}"

SERVICE_URL="$(gcloud run services describe "${SERVICE}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --format='value(status.url)')"

echo ""
echo "==> Deployed: ${SERVICE_URL}"
echo "==> Health:   ${SERVICE_URL}/api/health"
echo "==> Share:    set PUBLIC_SHARE_BASE_URL=${SERVICE_URL} and redeploy once if empty"
echo "==> Vercel remains untouched."
