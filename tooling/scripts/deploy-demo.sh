#!/bin/bash
set -euo pipefail

# ─── Deploy Rebase Demo to Cloud Run ─────────────────────────────────
# This script builds the Docker image via Cloud Build, pushes it to
# Artifact Registry, and deploys (or updates) the Cloud Run service.
#
# Usage:
#   pnpm deploy:demo          # full build + deploy
#   pnpm deploy:demo --only-deploy   # skip build, just update the service image

# ─── Configuration ───────────────────────────────────────────────────
PROJECT="rebase-578f2"
# The demo moved to europe-west1 on 2026-08-20: demo.rebase.pro is a Cloud Run
# *domain mapping*, and europe-west3 does not offer them. The old west3 service
# was deleted; deploying there now creates a dead service nothing routes to.
REGION="europe-west1"
SERVICE="rebase-demo"
# Artifact Registry stays in west3 — the repo is regional, the deploy is not.
IMAGE="europe-west3-docker.pkg.dev/${PROJECT}/rebase-demo/rebase-backend:latest"
# DATABASE_URL is `...@localhost/rebase_demo?host=/cloudsql/<instance>`, i.e. a
# unix socket that only exists if the revision has the instance attached. This
# used to be invisible: the flag persists across updates of an existing service,
# so the hand-created west3 service carried it for 112 revisions while the
# script never passed it. Recreating the service exposed it — the first boot
# query failed, node exit(1)'d, and Cloud Run reported the generic "failed to
# start and listen on PORT" error.
SQL_INSTANCE="${PROJECT}:europe-west3:rebase-578f2-instance"

# ─── Colors ──────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { echo -e "${CYAN}ℹ ${NC} $*"; }
ok()    { echo -e "${GREEN}✅${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠️ ${NC} $*"; }
fail()  { echo -e "${RED}❌${NC} $*"; exit 1; }

# ─── Pre-flight checks ──────────────────────────────────────────────
command -v gcloud >/dev/null 2>&1 || fail "gcloud CLI not found. Install it: https://cloud.google.com/sdk/docs/install"

CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null)
if [ "$CURRENT_PROJECT" != "$PROJECT" ]; then
  warn "Active gcloud project is '${CURRENT_PROJECT}', expected '${PROJECT}'."
  info "Switching to project ${PROJECT}..."
  gcloud config set project "$PROJECT"
fi

# ─── Parse flags ─────────────────────────────────────────────────────
SKIP_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --only-deploy) SKIP_BUILD=true ;;
    --help|-h)
      echo "Usage: deploy-demo.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --only-deploy   Skip Cloud Build, just update the Cloud Run service image"
      echo "  --help, -h      Show this help message"
      exit 0
      ;;
    *) fail "Unknown flag: $arg" ;;
  esac
done

# ─── Step 1: Build & Push via Cloud Build ────────────────────────────
if [ "$SKIP_BUILD" = false ]; then
  info "Building Docker image via Cloud Build..."
  info "Image: ${IMAGE}"
  echo ""

  # `git archive HEAD`, not `.`.
  #
  # Submitting the working tree means submitting whatever is in it, filtered
  # only by `.gcloudignore` — and the presence of that file is exactly what
  # stops gcloud consulting `.gitignore`, so every ignored file is uploaded
  # unless someone remembered to name it twice. That is a rule nobody can hold
  # in their head, and it did not hold: `saas/.env.prod` went to the build
  # bucket on every demo deploy, carrying the production control-plane database
  # password, along with the private control-plane source tree.
  #
  # An archive of HEAD cannot carry an untracked or ignored file at all, which
  # makes the property structural instead of a list to maintain. It is also
  # what the control-plane deploy already does, so the two agree.
  #
  # The cost is real and worth stating: an uncommitted change is not deployed.
  # That is the correct default for a deploy — see "deploys use the working
  # tree as context" for what the other way costs.
  CONTEXT_TARBALL="$(mktemp -t rebase-demo-context)".tar.gz
  trap 'rm -f "$CONTEXT_TARBALL"' EXIT
  git archive --format=tar.gz -o "$CONTEXT_TARBALL" HEAD

  gcloud builds submit \
    --config=infra/cloudbuild.yaml \
    --project="$PROJECT" \
    "$CONTEXT_TARBALL"

  ok "Image built and pushed to Artifact Registry."
  echo ""
else
  warn "Skipping build (--only-deploy). Using existing image."
  echo ""
fi

# ─── Step 2: Deploy to Cloud Run ────────────────────────────────────
info "Deploying to Cloud Run service '${SERVICE}' in ${REGION}..."
echo ""

# ALLOW_REGISTRATION is not optional here. `--set-env-vars` replaces the whole
# env block on every deploy, and the server defaults the flag to false when it
# is absent — which left the demo advertising "Sign in with Google" while
# refusing to create the account behind it (403 REGISTRATION_DISABLED). Visitors
# land on `defaultRole: viewer`, so an open demo is the intent.

gcloud run deploy "$SERVICE" \
  --image="$IMAGE" \
  --region="$REGION" \
  --project="$PROJECT" \
  --port=3001 \
  --allow-unauthenticated \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=1 \
  --max-instances=3 \
  --add-cloudsql-instances="$SQL_INSTANCE" \
  --set-env-vars="NODE_ENV=production,CORS_ORIGINS=*,FORCE_LOCAL_STORAGE=true,ALLOW_LOCALHOST_IN_PRODUCTION=true,REBASE_CRON_ALWAYS_ON=1,ALLOW_REGISTRATION=true" \
  --set-secrets="DATABASE_URL=DATABASE_URL:latest,JWT_SECRET=JWT_SECRET:latest,ADMIN_CONNECTION_STRING=ADMIN_CONNECTION_STRING:latest,GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID:latest,GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest"

echo ""
ok "Deployment complete!"

# ─── Print service URL ──────────────────────────────────────────────
SERVICE_URL=$(gcloud run services describe "$SERVICE" --region="$REGION" --project="$PROJECT" --format='value(status.url)' 2>/dev/null || true)
if [ -n "$SERVICE_URL" ]; then
  echo ""
  info "🌍 Service URL: ${GREEN}${SERVICE_URL}${NC}"
fi
