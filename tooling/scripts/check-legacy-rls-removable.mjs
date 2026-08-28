#!/usr/bin/env node
/**
 * Whether the pre-1.0 RLS constants can be deleted yet.
 *
 * ## What this is guarding
 *
 * `LEGACY_RLS_SCHEMA` / `_UID_SQL` / `_ROLES_SQL` / `_JWT_SQL` in
 * `packages/types/src/types/rls-functions.ts` name the `auth.uid()` form that
 * Rebase wrote before the schema rename (`d9da841ec`, released in 0.14.0).
 * Anything that reads a policy back has to recognise both eras, or it reports
 * the framework's own output as foreign drift.
 *
 * They look like dead compatibility code. On 2026-08-27 they were not:
 *
 *     dadaki                64 of 64 policies in the pre-1.0 form
 *     prospector           159 of 160
 *     unfeigned-loyalty     70 of 75
 *     boot-rls-acceptance   40 of 44
 *     rebase-growth          0 of 60   (rebuilt against a 0.16 driver)
 *
 * Deleting them then would have broken RLS interpretation for the whole fleet
 * bar one, including a live customer whose every policy is the old form.
 *
 * ## Why a script and not a note
 *
 * A note in a docblock is read by whoever is already looking at the file. The
 * person who deletes these will be doing a legacy sweep months from now, will
 * grep for usages, will find only the drift checker and the parser, and will
 * conclude — reasonably, from the code alone — that nothing depends on them.
 * The dependency is not in the code. It is in five databases.
 *
 * ## The exit condition
 *
 * `saas/backend/scripts/fleet-rls-report.sh` reports zero legacy policies for
 * every managed tenant. That happens one tenant at a time, and only by
 * rebuilding its bundle against `@rebasepro/server-postgres >= 0.14.0` and
 * redeploying: the runtime image supplies `@rebasepro/server` and NOT the
 * driver, so no rollout changes it, and boot provisioning is additive — it may
 * create a missing table and may never rewrite an existing policy.
 *
 * This script does not read the fleet; it has no credentials and CI has none
 * either. It asserts the constants are still present and still referenced, so
 * that removing them is a deliberate act that has to delete this file too — at
 * which point the deleter meets the paragraph above.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RED = "\x1b[0;31m", GREEN = "\x1b[0;32m", DIM = "\x1b[2m", NC = "\x1b[0m";

const CONSTANTS = "packages/types/src/types/rls-functions.ts";
/**
 * Each reader with the token that PROVES it still understands the old form.
 *
 * A loose "does the file mention auth.uid" match is not enough, and this script
 * proved it on itself: a mutation that stripped every real reference still
 * passed, because a regex literal elsewhere in the file — `auth\.(uid|jwt|roles)`
 * — kept matching. Name the symbol each file must actually use.
 */
const READERS = [
    { file: "packages/server-postgres/src/schema/rls-bootstrap-sql.ts", needs: "LEGACY_RLS_SCHEMA" },
    { file: "packages/common/src/util/policy/sqlToPolicy.ts", needs: "auth.uid" }
];

const problems = [];
const src = fs.existsSync(path.join(ROOT, CONSTANTS))
    ? fs.readFileSync(path.join(ROOT, CONSTANTS), "utf8")
    : null;

if (src === null) {
    problems.push(`${CONSTANTS} is gone. If the fleet is migrated, delete this script in the same commit.`);
} else {
    for (const name of ["LEGACY_RLS_SCHEMA", "LEGACY_RLS_UID_SQL", "LEGACY_RLS_ROLES_SQL", "LEGACY_RLS_JWT_SQL"]) {
        if (!new RegExp(`export const ${name}\\b`).test(src)) {
            problems.push(`${name} was removed from ${CONSTANTS}.`);
        }
    }
}

// A constant nothing reads is not compatibility, it is litter — and if the
// readers go, the constants should go with them rather than linger.
for (const { file, needs } of READERS) {
    const abs = path.join(ROOT, file);
    if (!fs.existsSync(abs)) {
        problems.push(`${file} is gone; the legacy form may no longer be understood on read.`);
        continue;
    }
    if (!fs.readFileSync(abs, "utf8").includes(needs)) {
        problems.push(`${file} no longer references \`${needs}\`, so it has stopped recognising the pre-1.0 form.`);
    }
}

if (problems.length === 0) {
    console.log(`${DIM}Pre-1.0 RLS constants present and still read.${NC}`);
    console.log(`${GREEN}✓ nothing has removed compatibility the fleet still depends on.${NC}`);
    process.exit(0);
}

console.error(`\n${RED}✗ pre-1.0 RLS compatibility has been weakened:${NC}\n`);
for (const p of problems) console.error(`    ${p}`);
console.error(`
  These are not dead. On 2026-08-27 five of six managed tenants wrote every or
  nearly every policy in the \`auth.uid()\` form — dadaki 64 of 64. Removing the
  constants makes the drift checker report the framework's own output as foreign
  and the policy parser fail on policies that are live right now.

  Before removing them, all of these must hold:

    1. saas/backend/scripts/fleet-rls-report.sh shows LEGACY=0 for every tenant.
    2. Each tenant reached that by a bundle rebuilt against
       @rebasepro/server-postgres >= 0.14.0 and redeployed — a rollout cannot do
       it, because the image does not supply the driver.
    3. The \`auth\` schema is dropped everywhere. dropLegacyAuthSchema does that
       by itself at the next boot once nothing references it.

  When all three hold, delete the constants, their readers, and this file
  together — in one commit, so the reasoning and its removal are the same diff.
`);
process.exit(1);
