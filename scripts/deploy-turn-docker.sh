#!/usr/bin/env bash
# Deploy Docker coturn TURN to GCP VM (live WebRTC relay for Cloud Run API).
# Does not touch Vercel or Cloud Run API.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${GCP_PROJECT_ID:-souqgate-b8d26}"
ZONE="${GCP_ZONE:-us-central1-a}"
VM="${TURN_VM_NAME:-holdpose-turn}"
TURN_USER="${TURN_USER:-snap}"
TURN_PASS="${TURN_PASS:-snapturn}"
TURN_REALM="${TURN_REALM:-holdpose.souqgate}"

export PATH="${HOME}/google-cloud-sdk-install/google-cloud-sdk/bin:${PATH}"

echo "==> Ensuring VM ${VM} exists in ${PROJECT}/${ZONE}"
if ! gcloud compute instances describe "${VM}" --zone="${ZONE}" --project="${PROJECT}" >/dev/null 2>&1; then
  echo "VM missing — create holdpose-turn first (or set TURN_VM_NAME)."
  exit 1
fi

EXTERNAL_IP="$(gcloud compute instances describe "${VM}" \
  --zone="${ZONE}" --project="${PROJECT}" \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)')"
echo "==> EXTERNAL_IP=${EXTERNAL_IP}"

echo "==> Uploading compose reference"
gcloud compute scp \
  "${ROOT}/docker-compose.turn.yml" \
  "${VM}:~/docker-compose.turn.yml" \
  --zone="${ZONE}" --project="${PROJECT}" --quiet

echo "==> Starting coturn Docker container on VM"
gcloud compute ssh "${VM}" --zone="${ZONE}" --project="${PROJECT}" --quiet --command="
set -e
sudo apt-get update -y >/dev/null
sudo apt-get install -y docker.io >/dev/null
sudo systemctl enable --now docker
sudo docker pull instrumentisto/coturn:latest
sudo docker rm -f holdpose-coturn snap-coturn 2>/dev/null || true
sudo docker run -d \\
  --name holdpose-coturn \\
  --restart=unless-stopped \\
  --network=host \\
  instrumentisto/coturn:latest \\
  -n \\
  --log-file=stdout \\
  --external-ip=${EXTERNAL_IP} \\
  --listening-ip=0.0.0.0 \\
  --listening-port=3478 \\
  --min-port=49160 \\
  --max-port=49300 \\
  --fingerprint \\
  --lt-cred-mech \\
  --user=${TURN_USER}:${TURN_PASS} \\
  --realm=${TURN_REALM} \\
  --no-cli \\
  --no-tls \\
  --no-dtls \\
  --verbose \\
  --allowed-peer-ip=0.0.0.0-255.255.255.255
sleep 3
sudo docker ps --filter name=holdpose-coturn --format '{{.Names}} {{.Status}} {{.Image}}'
sudo docker logs holdpose-coturn 2>&1 | tail -15
sudo ss -ulnp | grep 3478 || true
"

echo ""
echo "==> TURN ready (Docker)"
echo "    turn:${EXTERNAL_IP}:3478 (udp/tcp)"
echo "    user/pass: ${TURN_USER} / ${TURN_PASS}"
echo "${EXTERNAL_IP}" > /tmp/holdpose-turn-ip.txt
