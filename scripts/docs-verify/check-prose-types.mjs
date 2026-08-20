/**
 * Type and config names claimed in **prose**, rather than in a fence.
 *
 * Everything else in this directory reads fenced code: `check-api-names.mjs`
 * greps imports and member access, `typecheck-snippets.mjs` compiles the fences
 * outright. A markdown *table* is neither, and that is where the worst drift in
 * the agent skills lived — a reference table is exactly the shape nobody runs:
 *
 *   - `BackendHooks`, `UserHooks`, `DataHooks` and `BackendHookContext`, with a
 *     `hooks.data` config block, documented across two skills. None of the four
 *     types exists, and `RebaseBackendConfig` has no `hooks` key at all, so the
 *     config an agent wrote from it type-errored — or, in plain JavaScript, was
 *     silently ignored;
 *   - `EntityOverrides` as a collection option, for a key no config type has;
 *   - `AdminCollectionConfig`, deleted on purpose (`admin_collection.ts` says so
 *     in as many words) and still the annotation one skill told agents to write;
 *   - six `*Props` names in the component-override table that were never types.
 *
 * The filter is the suffix, and it is deliberately narrow: a bare capitalised
 * word in backticks is as likely to be a product name, an HTTP verb or a column
 * type as an identifier, but `SomethingConfig` / `SomethingProps` /
 * `SomethingHooks` is a claim about this repository's types nearly every time.
 * That keeps the false-positive rate low enough for the check to be blocking,
 * which a noisier one could never be.
 *
 * `<!-- docs-verify: ignore -->` exempts the block that follows, which is what a
 * paragraph *warning* that a type does not exist needs — the best sentence a
 * doc can write about `BackendHooks` has to spell it.
 */
import { readFileSync, globSync } from "node:fs";
import path from "node:path";
import { AGENT_INSTRUCTION_GLOBS } from "./extract.mjs";

const DOC_GLOBS = [
    "website/src/content/docs/**/*.md",
    "website/src/content/docs/**/*.mdx",
    "rebase-agent-skills/**/*.md",
    "examples/*/*.md",
    ...AGENT_INSTRUCTION_GLOBS
];

/**
 * Suffixes that make a capitalised word a claim about a declared type.
 *
 * `View`, `Client` and `Service` are deliberately absent: "the Collection View",
 * "an HTTP Client" and "the Email Service" are English, and including them would
 * flag prose rather than API claims.
 */
const CLAIM = /^[A-Z][A-Za-z0-9]*(Props|Config|Options|Hooks|Context|Payload|Registry|Controller|Adapter|Definition|Callbacks|Rules)$/;

/**
 * Names that are real but come from outside the workspace, so scanning our own
 * source will never find them. Kept short on purpose — a long list here is the
 * check quietly turning itself off.
 */
const EXTERNAL = new Set([
    "AbortController",
    "MouseEventHandler",
    "ChangeEventHandler",
    "CSSProperties",
    "RequestContext"
]);

/** Every identifier this workspace declares or imports under a name. */
function declaredNames(root) {
    const names = new Set();
    for (const rel of globSync("packages/*/src/**/*.{ts,tsx}", { cwd: root })) {
        if (rel.includes(`${path.sep}dist${path.sep}`)) continue;
        let src;
        try {
            src = readFileSync(path.join(root, rel), "utf8");
        } catch {
            continue;
        }
        for (const m of src.matchAll(/\b(?:interface|type|class|enum|function|const)\s+([A-Za-z_$][\w$]*)/g)) {
            names.add(m[1]);
        }
        // Imported names count as declared: a type this repo re-exports from a
        // dependency is still a name a reader can write.
        for (const m of src.matchAll(/\bimport\s+(?:type\s+)?\{([^}]*)\}/g)) {
            for (const part of m[1].split(",")) {
                const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop().trim();
                if (name) names.add(name);
            }
        }
    }
    return names;
}

/** `<!-- docs-verify: ignore -->` — the block that follows it is exempt. */
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

export function checkProseTypes(root) {
    const declared = declaredNames(root);
    const findings = [];
    let scanned = 0;

    for (const rel of new Set(DOC_GLOBS.flatMap(g => globSync(g, { cwd: root })))) {
        if (rel.split(path.sep).some(part => part === "node_modules" || part === "dist")) continue;
        // A changelog records names that were real when it was written.
        if (path.basename(rel) === "CHANGELOG.md") continue;
        scanned++;

        const text = readFileSync(path.join(root, rel), "utf8");
        const lines = text.split("\n");
        const skip = ignoredLines(lines);
        const seen = new Set();
        let inFence = false;

        lines.forEach((line, i) => {
            if (/^\s*```/.test(line)) {
                inFence = !inFence;
                return;
            }
            // Fenced code is covered by the compiler and by check-api-names.
            if (inFence || skip.has(i + 1)) return;

            for (const m of line.matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)) {
                const id = m[1];
                if (!CLAIM.test(id) || declared.has(id) || EXTERNAL.has(id)) continue;
                if (seen.has(id)) continue;
                seen.add(id);
                findings.push({
                    file: rel,
                    line: i + 1,
                    message:
                        `\`${id}\` is not declared anywhere in packages/*/src — a type or config name ` +
                        `that does not exist. If it is deliberate (a warning that it does not exist, ` +
                        `or a name from a dependency), mark the block \`<!-- docs-verify: ignore -->\`.`
                });
            }
        });
    }

    return { findings, scanned };
}
