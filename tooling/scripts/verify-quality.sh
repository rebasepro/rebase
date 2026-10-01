#!/usr/bin/env bash
# ============================================================
# verify-quality.sh — what CI runs, from a fresh clone
# Run from monorepo root:  ./tooling/scripts/verify-quality.sh
#
# This is the script CONTRIBUTING and the pull-request template point at, so
# it has to be true that passing it means the pipeline will pass. Three things
# used to make that false:
#
#   - it never type-checked anything. `pnpm build` is esbuild, which strips
#     types WITHOUT checking them, so a type error passed here and failed in
#     CI's first step;
#   - `npx fallow` named a tool declared in no package.json. On a fresh clone
#     npx tries to fetch it, and its result was a warning either way — a step
#     that could not fail, reporting on a tool nobody has;
#   - it ran a hand-picked handful of gates while CI ran twenty-five.
#
# So the static half is `pnpm ci:static` and the post-build half is
# `pnpm ci:build-gates` — the same two commands the workflow runs, with their
# lists living in one place each (tooling/scripts/ci-static.mjs,
# tooling/scripts/ci-build-gates.mjs, and docs/gates.md as the table over both).
# `ci:build-gates` was the last hole: eleven YAML steps this script never ran,
# `check:generated` — the gate CONTRIBUTING warns you about forgetting — among
# them. The end-to-end half was the last hole: this ran Playwright and nothing
# else, while CI ran the RLS enforcement suite, the CLI e2e, the scaffolds,
# self-host and the RLS scan. The CLI e2e failed on main for days after a
# commit verified "end to end" by hand. They are `pnpm ci:e2e` now, the same
# command the four e2e jobs run.
#
# `check:gates-doc` holds the claim: every root script verify.yml invokes has to
# be invoked here too.
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERROR_LOG=$(mktemp)

err()  { echo -e "${RED}✗ $1${NC}"; echo "1" >> "$ERROR_LOG"; }
ok()   { echo -e "${GREEN}✓ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
section() { echo -e "\n${YELLOW}━━━ $1 ━━━${NC}"; }
error_count() { wc -l < "$ERROR_LOG" | tr -d ' '; }

echo -e "${YELLOW}====================================================${NC}"
echo -e "${YELLOW}       Rebase Code Quality Verification Suite       ${NC}"
echo -e "${YELLOW}====================================================${NC}"

# 1. Monorepo Build Check
section "1. Monorepo Build Check"
echo "Running pnpm build..."
if pnpm run build; then
    ok "Monorepo compiled successfully."
else
    err "Monorepo build failed."
fi

# 2. The static gates — the same list, in the same order, as CI's `static` job.
#    Includes the type check, ESLint, the ratchets and the docs verifier, so
#    none of them needs a step of its own here.
section "2. Static Gates (pnpm ci:static)"
echo "Running the CI static gate list..."
if pnpm run ci:static; then
    ok "All static gates passed."
else
    err "One or more static gates failed. Each names the script to re-run."
fi

# 3. The post-build gates — the same list, in the same order, as CI's
#    `build-gates` job. They read what step 1 emitted: published .d.ts, the
#    scaffolded and ejected project typechecks, the API surface, the eager-JS
#    budget, the generated website artifacts.
section "3. Build Gates (pnpm ci:build-gates)"
echo "Running the CI post-build gate list..."
if pnpm run ci:build-gates; then
    ok "All build gates passed."
else
    err "One or more build gates failed. Each names the script to re-run."
fi

# 4. Unit Tests Check
#    In America/Los_Angeles, as CI's unit job runs them: a timezone test that
#    runs in the machine's own zone cannot fail in UTC, and the developer
#    machines are east of Greenwich — so the zone CI covers is the one that
#    would otherwise be covered nowhere. See the unit job in verify.yml.
section "4. Unit Tests Suite"
echo "Running unit tests (pnpm test, TZ=America/Los_Angeles)..."
if TZ=America/Los_Angeles pnpm test; then
    ok "All unit tests passed successfully."
else
    err "Some unit tests failed."
fi
echo "Running the agent harness's tests (pnpm test:harness)..."
if pnpm run test:harness; then
    ok "Harness tests passed."
else
    err "Harness tests failed."
fi

# The Cloud console's suite, which CI runs from this repository because the
# console resolves @rebasepro/* to this checkout. It needs saas/ beside the
# packages; CI skips it with a notice when it cannot check that repository out,
# and so does this.
if [ -d "./saas" ]; then
    echo "Running the Cloud console's suite (pnpm test:saas-console)..."
    if pnpm run test:saas-console; then
        ok "Console suite passed."
    else
        err "Console suite failed."
    fi
else
    warn "Skipped the Cloud console's suite: no saas/ checkout here (CI skips it the same way without the credential)."
fi

# 5. End-to-end suites — every lane CI's four e2e jobs run, through the same
#    runner. Each lane starts what it needs (Postgres containers, scaffolds)
#    and each suite runs whatever happened to the one before it. Needs Docker.
#    Playwright ships no browser with the npm package: on a fresh clone the
#    browser suites fail with "Executable doesn't exist" before running a single
#    test. Installing is idempotent and near-instant once the browser is there,
#    so it is a step rather than a precondition somebody has to have read about.
section "5. End-to-end suites (pnpm ci:e2e)"
echo "Ensuring the Chromium build Playwright expects is installed..."
if ! pnpm exec playwright install chromium; then
    err "Could not install Chromium for Playwright."
fi
echo "Running every e2e lane (vitest, cli, selfhost, admin)..."
if pnpm run ci:e2e; then
    ok "All end-to-end suites passed."
else
    err "End-to-end suites failed. The summary above names each one and how to re-run it."
fi

# 6. Build Health Check (Vite & Bundles)
section "6. Bundle ESM/CJS Health Check"
if [ -f "./tooling/scripts/check-packages.sh" ]; then
    echo "Running build-health package check..."
    if ./tooling/scripts/check-packages.sh; then
        ok "ESM / Package dependency configurations verified."
    else
        warn "Build health package checks found warning conditions (dependency or bundle issues)."
    fi
else
    warn "check-packages.sh not found, skipping."
fi

# Summary
section "Verification Summary"
TOTAL=$(error_count)
if [ "$TOTAL" = "0" ]; then
    echo -e "${GREEN}====================================================${NC}"
    echo -e "${GREEN}      ✓ SUCCESS: All quality checks passed!          ${NC}"
    echo -e "${GREEN}====================================================${NC}"
    rm -f "$ERROR_LOG"
    exit 0
else
    echo -e "${RED}====================================================${NC}"
    echo -e "${RED}      ✗ FAILURE: $TOTAL check group(s) failed.      ${NC}"
    echo -e "${RED}====================================================${NC}"
    rm -f "$ERROR_LOG"
    exit 1
fi
