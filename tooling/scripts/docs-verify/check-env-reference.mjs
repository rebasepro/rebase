/**
 * Every environment variable the runtime validates is named on the page that
 * claims to list them.
 *
 * `getting-started/configuration.md` opens by promising that the reference
 * below it is "the union of every table" the schema owns. It was not: twelve
 * keys the two Zod schemas declare appeared nowhere on it, including
 * `AUTH_MAGIC_LINK` and `AUTH_EMAIL_OTP` (whole authentication flows), the
 * `CAPTCHA_*` trio, the GCS credentials, and the three storage switches that
 * decide whether a deployment boots at all.
 *
 * That page is the one a platform team reads twice — once to write a Helm
 * values file and once when something will not start — so a page that says
 * "every" and means "most" teaches them not to trust it.
 *
 * Checked in one direction only, deliberately. A key on the page that is in no
 * schema is usually correct: `BACKUP_SCHEDULE` and friends are read by a cron
 * outside the boot schema, and `VITE_*` belongs to the frontend. Flagging those
 * would make the guard noisy, and a noisy guard gets switched off.
 *
 * Run: node tooling/scripts/docs-verify/check-env-reference.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, "..", "..", "..");
const SCHEMAS = ["packages/server/src/env.ts", "packages/server/src/boot/env.ts"];
const PAGE = "website/src/content/docs/docs/getting-started/configuration.md";

const GREEN = "[0;32m";
const RED = "[0;31m";
const DIM = "[2m";
const NC = "[0m";

/**
 * Keys that are genuinely not this page's job.
 *
 * `REBASE_ROLE` and the function-selection variables split one deployment into
 * several processes, which has its own page; naming them here as well would put
 * the same table in two places and let them disagree.
 */
const ELSEWHERE = new Map([
    ["REBASE_ROLE", "docs/deployment/split-processes"],
    ["REBASE_FUNCTIONS_ONLY", "docs/deployment/split-processes"],
    ["REBASE_FUNCTIONS_EXCLUDE", "docs/deployment/split-processes"],
    ["REBASE_FUNCTIONS_UPSTREAM", "docs/deployment/split-processes"]
]);

/**
 * @param {string} root
 * @returns {{ findings: string[], scanned: number }}
 */
export function checkEnvReference(root = DEFAULT_ROOT) {
    const declared = new Set();
    for (const file of SCHEMAS) {
        const source = readFileSync(path.join(root, file), "utf8");
        // A zod field at one indent level inside the schema object: `NAME: z.…`.
        for (const m of source.matchAll(/^\s{4}([A-Z][A-Z0-9_]{2,}):\s/gm)) declared.add(m[1]);
    }

    if (declared.size === 0) {
        throw new Error("Read no keys out of the env schemas — the guard is checking nothing.");
    }

    const page = readFileSync(path.join(root, PAGE), "utf8");
    const documented = new Set([...page.matchAll(/`([A-Z][A-Z0-9_]{2,})`/g)].map(m => m[1]));

    const findings = [...declared]
        .filter(key => !documented.has(key))
        .filter(key => !(ELSEWHERE.has(key) && page.includes(ELSEWHERE.get(key))))
        .sort();

    return { findings, scanned: declared.size };
}

// Runnable on its own, so the check can be reproduced without the whole verifier.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    let result;
    try {
        result = checkEnvReference();
    } catch (error) {
        console.error(`${RED}✗ ${error.message}${NC}`);
        process.exit(2);
    }

    if (result.findings.length === 0) {
        console.log(`${GREEN}✓ All ${result.scanned} validated environment variables are documented.${NC}`);
        process.exit(0);
    }

    console.error(`${RED}✗ ${result.findings.length} validated environment variable(s) missing from the reference:${NC}\n`);
    for (const key of result.findings) console.error(`  ${RED}${key}${NC}`);
    console.error(
        `\n${DIM}Declared in ${SCHEMAS.join(" or ")}, absent from ${PAGE}.\n`
        + "That page promises it lists every variable the schema validates, so a key\n"
        + `missing from it is a promise broken to whoever is writing a deployment.${NC}`
    );
    process.exit(1);
}
