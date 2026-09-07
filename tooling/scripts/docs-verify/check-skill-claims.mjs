/**
 * Numbers, paths and names the agent skills state as fact, against source.
 *
 * The skills are the one documentation surface written *to be obeyed*. A doc a
 * person reads wrong costs them a minute; a skill an agent reads wrong becomes
 * code. And the drift here was all of the quiet kind — a default that changed,
 * a route that moved under `/api/admin`, a signature that stopped returning
 * `void`, a warning about an operator that had since been implemented:
 *
 *   - `rebase-api` documented the list default as 20 and the ceiling as 100.
 *     They are `DEFAULT_LIST_LIMIT` 50 and `MAX_LIST_LIMIT` 1000, and asking
 *     for more is a 400 rather than a clamp — so an agent that paged by 100
 *     silently got 50 and reported a short table as the whole one.
 *   - `rebase-api` and `rebase-sdk` both said "there is NO `like` operator".
 *     `like`, `ilike`, `not-like` and `not-ilike` are all in
 *     `WhereFilterOp`, and have been for as long as the REST alias table has
 *     had `nlike` in it.
 *   - `rebase-cron-jobs` mounted the cron API at `/api/cron`. The canonical
 *     path has been `/api/admin/cron` since the admin-surface convention; the
 *     old one answers with a `Deprecation` header.
 *   - `rebase-email` typed `send()` as `Promise<void>`. It has returned
 *     `EmailSendResult` since 0.17 — the change that made a message id
 *     reachable at all.
 *   - `rebase-admin` named a `<SideEntityProvider>`; the component is
 *     `SidePanelProvider`.
 *   - `rebase-studio` claimed 9 built-in tools over 11.
 *   - `rebase-basics` and `rebase-local-env-setup` asked for Node 20 while a
 *     scaffolded project declares `>=22.22.0` and fails at install below it,
 *     and `rebase-local-env-setup` started a stock `postgres:17` container, on
 *     which a `{ type: "vector" }` property fails with `type "vector" does not
 *     exist`.
 *
 * Every rule below reads its expected value out of the code rather than
 * carrying it, so the check goes red on the commit that changes the fact and
 * not on the day somebody reads the skill.
 */
import { readFileSync, globSync, existsSync } from "node:fs";
import path from "node:path";

const SKILLS = "tooling/rebase-agent-skills/skills";

/**
 * `<!-- docs-verify: ignore -->` on its own line, exempting the block that
 * follows it up to the next blank line.
 *
 * The same convention `check-doc-commands.mjs` uses, and for the same reason: a
 * skill that warns *against* a name has to spell the name out. Without an
 * opt-out this check would punish exactly the sentences that fix the problem —
 * "there is no `<Icon>` component" is the correction, not the drift.
 *
 * @returns {Set<number>} 1-based line numbers to skip.
 */
function ignoredLines(lines) {
    const ignored = new Set();
    for (let i = 0; i < lines.length; i++) {
        if (!/<!--\s*docs-verify:\s*ignore\s*-->/.test(lines[i])) continue;
        ignored.add(i + 1);
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === "") j++;
        for (; j < lines.length && lines[j].trim() !== ""; j++) ignored.add(j + 1);
    }
    return ignored;
}


/** Read a workspace file, or "" when it is not there. */
function read(root, rel) {
    try {
        return readFileSync(path.join(root, rel), "utf8");
    } catch {
        return "";
    }
}

/** `export const NAME = 42;` → "42". */
function constant(source, name) {
    return /** @type {string|null} */ (
        new RegExp(`export const ${name}\\s*(?::[^=]+)?=\\s*(\\d+)`).exec(source)?.[1] ?? null
    );
}

/**
 * The facts, each derived. A rule is `{ what, expected, forbid, hint }`:
 * `forbid` is a regex whose match in a skill is a finding, and `expected` is
 * what the source actually says, quoted back in the message.
 */
function rules(root) {
    const out = [];

    // ── List pagination bounds ─────────────────────────────────────────────
    const driver = read(root, "packages/types/src/controllers/data_driver.ts");
    const defaultLimit = constant(driver, "DEFAULT_LIST_LIMIT");
    const maxLimit = constant(driver, "MAX_LIST_LIMIT");
    if (defaultLimit && maxLimit) {
        out.push({
            what: "the default list limit",
            expected: defaultLimit,
            forbid: new RegExp(`default limit is \\*\\*(?!${defaultLimit}\\b)\\d+`, "i"),
            hint: `DEFAULT_LIST_LIMIT is ${defaultLimit}`
        });
        out.push({
            what: "the maximum list limit",
            expected: maxLimit,
            forbid: new RegExp(`max limit is \\*\\*(?!${maxLimit}\\b)\\d+`, "i"),
            hint: `MAX_LIST_LIMIT is ${maxLimit}`
        });
    }

    // ── Filter operators that exist ────────────────────────────────────────
    const operators = read(root, "packages/types/src/types/filter-operators.ts");
    for (const op of ["like", "ilike"]) {
        if (!new RegExp(`"${op}"\\s*:`).test(operators)) continue;
        out.push({
            what: `the \`${op}\` operator`,
            expected: "it exists",
            forbid: new RegExp(`(?:no|not|NO)\\s+\`${op}\`\\s+operator`, "i"),
            hint: `\`${op}\` is in the REST alias table in packages/types/src/types/filter-operators.ts`
        });
    }

    // ── Admin surfaces live under /api/admin ───────────────────────────────
    //
    // Every spelling of the legacy path, not just "mounted at": the narrow
    // version was green while `rebase-cron-jobs` still told an agent to mount
    // routes at `/api/cron` in one place and issue `POST /api/cron/:id/trigger`
    // in twelve others. The one sentence that has to name the legacy path — the
    // one calling it legacy — opts out with `<!-- docs-verify: ignore -->`.
    const init = read(root, "packages/server/src/init.ts");
    for (const surface of ["cron", "schema"]) {
        if (!init.includes(`/admin/${surface}\``)) continue;
        out.push({
            what: `the \`${surface}\` API path`,
            expected: `/api/admin/${surface}`,
            // `(?![\w-])` rather than `\b`: `/api/schema-editor` is its own
            // route and not the legacy spelling of this one.
            forbid: new RegExp(`/api/${surface}(?![\\w-])`),
            hint: `init.ts mounts it canonically at \`/api/admin/${surface}\`; \`/api/${surface}\` is a deprecated alias`
        });
    }

    // ── EmailService.send returns a result ─────────────────────────────────
    const email = read(root, "packages/types/src/controllers/email.ts");
    if (/send\(options: EmailSendOptions\): Promise<EmailSendResult>/.test(email)) {
        out.push({
            what: "`EmailService.send`",
            expected: "Promise<EmailSendResult>",
            forbid: /EmailSendOptions\)\s*=>\s*Promise<void>/,
            hint: "it has returned `EmailSendResult` since 0.17"
        });
    }

    // ── The scaffold's Node floor ──────────────────────────────────────────
    let floor = null;
    try {
        floor = JSON.parse(
            readFileSync(path.join(root, "packages/cli/templates/template/package.json"), "utf8")
        ).engines?.node;
    } catch { /* checked elsewhere */ }
    if (floor) {
        const major = /(\d+)/.exec(floor)?.[1];
        // Only sentences that state a *requirement*. "Node 20+ has global File"
        // is a true remark about Node's own history, and a check that reported
        // it would be teaching people to delete correct sentences.
        const states = /require|required|minimum|at least|nvm install|engines|\bLTS\b/i;
        out.push({
            what: "the Node floor",
            expected: floor,
            forbid: new RegExp(`Node(?:\\.js)?[^.\\n]{0,24}?\\bv?(?!${major})(?:1[0-9]|2[01])\\+?\\b`),
            requires: states,
            hint: `a scaffolded project declares \`node: "${floor}"\` and fails at install below it`
        });
    }

    // ── The Postgres image the scaffold actually uses ──────────────────────
    const compose = read(root, "packages/cli/templates/template/docker-compose.yml");
    const image = /image:\s*(pgvector\/pgvector:pg\d+)/.exec(compose)?.[1];
    if (image) {
        out.push({
            what: "the Postgres image",
            expected: image,
            forbid: /-d\s+postgres:\d+/,
            hint: `${image} is stock Postgres with \`vector\` built in; a \`{ type: "vector" }\` ` +
                'property fails on the stock image with `type "vector" does not exist`'
        });
    }

    return out;
}

/**
 * Component and type names a skill states in prose, against the packages that
 * export them. Narrower than `check-prose-types` on purpose: this one knows
 * about *near misses*, where the invented name is one word off a real one.
 */
function checkComponentNames(root, findings) {
    const cmsIndex = read(root, "packages/cms/src/index.ts");
    if (!cmsIndex) return;
    const exported = new Set([...cmsIndex.matchAll(/^\s{4}([A-Z][\w]*),?$/gm)].map((m) => m[1]));
    // The UI kit's barrel is `export * from "./Container"`, so the component
    // names are only readable from the filenames. Without these, every
    // `<Card>` and `<Container>` a skill writes looks invented.
    for (const rel of globSync("packages/*/src/components/**/*.tsx", { cwd: root })) {
        const base = path.basename(rel, ".tsx");
        if (/^[A-Z]/.test(base)) exported.add(base);
    }
    if (!exported.size) return;

    for (const rel of globSync(`${SKILLS}/**/*.md`, { cwd: root })) {
        const lines = read(root, rel).split("\n");
        const skip = ignoredLines(lines);
        lines.forEach((line, i) => {
            if (skip.has(i + 1)) return;
            for (const m of line.matchAll(/`<([A-Z][\w]*)>`/g)) {
                const name = m[1];
                if (exported.has(name)) continue;
                // Only report a name that looks like a near miss of a real one:
                // a skill may legitimately name a component from another package.
                const near = [...exported].find(
                    (e) => e.endsWith(name.slice(-8)) || name.endsWith(e.slice(-8))
                );
                if (!near) continue;
                findings.push({
                    file: `${rel}:${i + 1}`,
                    message: `\`<${name}>\` is not exported by @rebasepro/cms. Did you mean \`<${near}>\`?`
                });
            }
        });
    }
}

/**
 * Paths a skill tells an agent to `cd` into or `cp` from, against the scaffold.
 *
 * `rebase-local-env-setup` opened with the *framework's* monorepo — `app/`,
 * `packages/`, `app/generated/` — and told the agent to `cp app/.env.example
 * app/.env`. None of those exists in a project `rebase init` writes, which is
 * the only project an agent following that skill is ever standing in. The
 * instruction failed, and the agent's next move was to invent a layout.
 *
 * Scope is deliberately narrow, because a false positive here teaches people to
 * delete correct sentences:
 *
 *  - A `cp` **source** is always a claim that a file is there.
 *  - A `cd` target is checked only when it contains a `/`. A bare `cd my-app`
 *    is the directory `rebase init` just made, not a claim about the layout.
 *  - Anything holding a placeholder (`<`, `$`, `{`, `*`, `~`) or an absolute
 *    path is skipped: it is a shape, not a path.
 */
function checkScaffoldPaths(root, findings) {
    const TEMPLATE = "packages/cli/templates/template";
    if (!existsSync(path.join(root, TEMPLATE))) return;

    const placeholder = /[<>${}*~]/;
    for (const rel of globSync(`${SKILLS}/**/*.md`, { cwd: root })) {
        const lines = read(root, rel).split("\n");
        const skip = ignoredLines(lines);
        lines.forEach((line, i) => {
            if (skip.has(i + 1)) return;
            const claimed = [];
            const copy = /(?:^|[`;&|(]\s*|\s)cp\s+(?:-[\w-]+\s+)*([^\s`"']+)/.exec(line);
            if (copy) claimed.push(copy[1]);
            const enter = /(?:^|[`;&|(]\s*|\s)cd\s+([^\s`"';&|]+)/.exec(line);
            if (enter && enter[1].includes("/")) claimed.push(enter[1]);

            for (const claim of claimed) {
                const clean = claim.replace(/\/$/, "");
                if (!clean || clean === "." || clean === "..") continue;
                if (placeholder.test(clean) || clean.startsWith("/")) continue;
                if (existsSync(path.join(root, TEMPLATE, clean))) continue;
                findings.push({
                    file: `${rel}:${i + 1}`,
                    message:
                        `\`${claim}\` does not exist in the project \`rebase init\` writes ` +
                        `(${TEMPLATE}/). A skill's paths are the ones the agent will type.`
                });
            }
        });
    }
}

/** Counts a skill states about something this repository can count. */
function checkCounts(root, findings) {
    const studio = read(root, "packages/studio/src/components/RebaseStudio.tsx");
    const tools = [...studio.matchAll(/view:\s*suspense\(</g)].length;
    if (!tools) return;
    for (const rel of globSync(`${SKILLS}/rebase-studio/**/*.md`, { cwd: root })) {
        const lines = read(root, rel).split("\n");
        const skip = ignoredLines(lines);
        lines.forEach((line, i) => {
            if (skip.has(i + 1)) return;
            for (const m of line.matchAll(/(\d+)\s+built-in (?:dev )?tools/g)) {
                if (Number(m[1]) === tools) continue;
                findings.push({
                    file: `${rel}:${i + 1}`,
                    message:
                        `claims ${m[1]} built-in Studio tools; RebaseStudio.tsx registers ${tools}.`
                });
            }
        });
    }
}

export function checkSkillClaims(root) {
    const findings = [];
    const active = rules(root);
    let scanned = 0;

    // A rule set that resolved to nothing would pass every skill silently.
    if (!active.length) {
        return {
            findings: [{ file: SKILLS, message: "no rule resolved against source — this check is not running." }],
            scanned: 0
        };
    }

    for (const rel of globSync(`${SKILLS}/**/*.md`, { cwd: root })) {
        if (!existsSync(path.join(root, rel))) continue;
        scanned++;
        const lines = read(root, rel).split("\n");
        const skip = ignoredLines(lines);
        lines.forEach((line, i) => {
            if (skip.has(i + 1)) return;
            for (const rule of active) {
                if (!rule.forbid.test(line)) continue;
                if (rule.requires && !rule.requires.test(line)) continue;
                findings.push({
                    file: `${rel}:${i + 1}`,
                    message: `${rule.what} — ${rule.hint}. Source says: ${rule.expected}.`
                });
            }
        });
    }

    checkComponentNames(root, findings);
    checkCounts(root, findings);
    checkScaffoldPaths(root, findings);

    return { findings, scanned };
}
