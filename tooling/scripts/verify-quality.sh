#!/usr/bin/env bash
# ============================================================
# verify-quality.sh — Systematic code quality & testing verifier
# Run from monorepo root:  ./tooling/scripts/verify-quality.sh
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

# 2. ESLint Check
section "2. Code Style & Linting Check (ESLint)"
echo "Running ESLint..."
if npx eslint . --quiet; then
    ok "No ESLint warnings or errors found."
else
    err "ESLint checks failed. Please fix style or React rules violations."
fi

# 3. Fallow Dead Code & Structural Analysis
section "3. Dead Code & Structural Analysis (Fallow)"
echo "Running Fallow analysis..."
if npx fallow --quiet --fail-on-issues 2>/dev/null; then
    ok "No dead code or structural issues found."
else
    warn "Fallow found dead code or structural issues. Run 'npx fallow' for details."
fi

# 4. Unit Tests Check
section "4. Unit Tests Suite"
echo "Running unit tests (pnpm test)..."
if pnpm test; then
    ok "All unit tests passed successfully."
else
    err "Some unit tests failed."
fi

# 5. E2E Tests Check
section "5. Playwright E2E Integration Suite"
echo "Running Playwright E2E tests (including SQL Console and Collection Editor)..."
if pnpm run e2e; then
    ok "All E2E integration tests passed successfully."
else
    err "Playwright E2E tests failed."
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

# 7. Docs API Drift Check
section "7. Docs API Drift (snippets + all-locale identifiers)"
# Warn-first: the baseline is not yet clean, so a finding must not fail the
# build. Once `node tooling/scripts/verify-docs.mjs` reports zero, add --strict here
# and move this into the err() path to make it blocking.
if [ -f "./tooling/scripts/verify-docs.mjs" ]; then
    echo "Typechecking doc snippets against workspace source..."
    if node --max-old-space-size=8192 tooling/scripts/verify-docs.mjs; then
        ok "Docs verification passed."
    else
        warn "Docs verification reported findings (see above)."
    fi
else
    warn "verify-docs.mjs not found, skipping."
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
