#!/usr/bin/env bash
#
# Let the release workflow push the fleet image, without a key to leak.
#
# ## What this is for
#
# `publish.yml` pushes `rebasepro/server` to two registries: Docker Hub, which
# self-hosters pull, and a private Artifact Registry repository, which is the
# only place Rebase Cloud looks. The Docker Hub half authenticates with a token
# in a repository secret. The Artifact Registry half cannot: a service-account
# key is a long-lived credential with push rights to the registry the production
# fleet pulls from, and putting one in GitHub means it exists somewhere it can be
# copied out of.
#
# Workload Identity Federation replaces it with a trade GitHub already makes.
# Every workflow run can mint a short-lived OIDC token describing itself — which
# repository, which ref, which workflow. This script teaches Google to accept
# those tokens from THIS repository and no other, and to hand back an access
# token for a service account that can do exactly one thing: write to
# `rebase-saas-images`. Nothing durable is stored on the GitHub side; the two
# secrets it prints are names, not credentials.
#
# ## Usage
#
#   ./tooling/scripts/setup-release-wif.sh              # say what would be created
#   ./tooling/scripts/setup-release-wif.sh --apply      # create it
#
# Idempotent: every step checks for what it is about to create, so a re-run after
# a partial failure completes the setup rather than erroring on the first
# resource that already exists.
#
# Requires `gcloud` authenticated as someone who can administer IAM in the
# project — `roles/iam.workloadIdentityPoolAdmin` and
# `roles/iam.serviceAccountAdmin`, or owner.
#
# ## Deleting it again
#
# A workload identity pool is soft-deleted for 30 days and its name stays
# reserved for that period, so tearing this down and rebuilding it under the same
# name is not a same-day operation. That is the one thing here that is awkward to
# undo; everything else (the service account, the two IAM bindings) deletes
# cleanly.
set -euo pipefail

PROJECT="${PROJECT:-rebase-578f2}"
REPO="${REPO:-rebasepro/rebase}"
POOL="${POOL:-github-actions}"
PROVIDER="${PROVIDER:-rebasepro-rebase}"
SA_NAME="${SA_NAME:-github-release}"
AR_LOCATION="${AR_LOCATION:-europe-west1}"
AR_REPO="${AR_REPO:-rebase-saas-images}"

SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"

APPLY=false
[ "${1:-}" = "--apply" ] && APPLY=true

if [ "$APPLY" = false ]; then
    echo "DRY RUN — nothing will be created. Add --apply to act."
    echo
fi

echo "project      $PROJECT"
echo "repository   $REPO"
echo "pool         $POOL"
echo "provider     $PROVIDER"
echo "account      $SA_EMAIL"
echo "registry     ${AR_LOCATION}-docker.pkg.dev/${PROJECT}/${AR_REPO}"
echo

run() {
    if [ "$APPLY" = true ]; then
        "$@"
    else
        printf '  would run: %s\n' "$*"
    fi
}

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format="value(projectNumber)")

# ── 1. The pool ───────────────────────────────────────────────────────────────
if gcloud iam workload-identity-pools describe "$POOL" \
        --location=global --project="$PROJECT" &>/dev/null; then
    echo "✅ pool $POOL exists"
else
    echo "→ create pool $POOL"
    run gcloud iam workload-identity-pools create "$POOL" \
        --location=global --project="$PROJECT" \
        --display-name="GitHub Actions"
fi

# ── 2. The provider ───────────────────────────────────────────────────────────
#
# The attribute condition is the security boundary, and it is the whole reason
# this is safe: without it the provider accepts a token from ANY repository on
# GitHub, and any one of them could then impersonate the service account. With
# it, a token whose `repository` claim is not this repository is rejected by
# Google before the service account is ever reached.
if gcloud iam workload-identity-pools providers describe "$PROVIDER" \
        --workload-identity-pool="$POOL" --location=global --project="$PROJECT" &>/dev/null; then
    echo "✅ provider $PROVIDER exists"
else
    echo "→ create provider $PROVIDER, restricted to $REPO"
    run gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
        --workload-identity-pool="$POOL" --location=global --project="$PROJECT" \
        --display-name="rebasepro/rebase releases" \
        --issuer-uri="https://token.actions.githubusercontent.com" \
        --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
        --attribute-condition="assertion.repository == '${REPO}'"
fi

# ── 3. The service account ────────────────────────────────────────────────────
if gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT" &>/dev/null; then
    echo "✅ service account $SA_EMAIL exists"
else
    echo "→ create service account $SA_EMAIL"
    run gcloud iam service-accounts create "$SA_NAME" --project="$PROJECT" \
        --display-name="GitHub release (runtime image push)"
fi

# ── 4. What it may do ─────────────────────────────────────────────────────────
#
# `artifactregistry.writer` on ONE repository, not on the project. A release
# needs to push the runtime image and nothing else; the deploy pipeline's own
# builder account is separate and keeps its own rights.
echo "→ grant artifactregistry.writer on $AR_REPO"
run gcloud artifacts repositories add-iam-policy-binding "$AR_REPO" \
    --location="$AR_LOCATION" --project="$PROJECT" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/artifactregistry.writer" \
    --condition=None

# ── 5. Who may become it ──────────────────────────────────────────────────────
#
# Scoped to `attribute.repository`, so the binding says "workflows in this
# repository" rather than "anything that got through the provider". Belt and
# braces with the attribute condition above: either one alone would do, and
# neither is the one you want to have got wrong.
PRINCIPAL="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${REPO}"
echo "→ let $REPO impersonate $SA_NAME"
run gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
    --project="$PROJECT" \
    --member="$PRINCIPAL" \
    --role="roles/iam.workloadIdentityUser"

PROVIDER_RESOURCE="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"

echo
if [ "$APPLY" = false ]; then
    echo "Nothing was created. Re-run with --apply."
    echo
fi
echo "Then set the two repository secrets — neither is a credential, they only"
echo "name what was created above:"
echo
echo "  gh secret set GCP_WORKLOAD_IDENTITY_PROVIDER -R ${REPO} --body '${PROVIDER_RESOURCE}'"
echo "  gh secret set GCP_RELEASE_SERVICE_ACCOUNT    -R ${REPO} --body '${SA_EMAIL}'"
