/**
 * Drizzle silently skips migrations that arrive out of order.
 *
 * The migrator does not track which migrations ran — it tracks a high-water mark,
 * the `when` of the last one applied. A migration whose `when` is lower than that
 * mark is not "pending", it is invisible: never applied, never reported, no error.
 * The failure surfaces later as a missing column in production.
 *
 * Two branches each adding a migration is all it takes. Whichever merges second
 * carries a `when` below the other's, and if the first has already been applied to
 * an environment, the second never runs there. This check is therefore about the
 * *merge*, which is why it compares the branch's journal against main's rather than
 * only validating the file in isolation.
 */
import path from "node:path";
import fs from "node:fs";
import { context, readJson, sh } from "../lib/ctx.mjs";
import { finding, pass, FAIL, WARN } from "../lib/report.mjs";

export const id = "migration-order";
export const title = "Drizzle migration ordering";

/** Every drizzle journal that belongs to a deployable backend. */
function journals(root) {
    return ["saas/backend/drizzle/meta/_journal.json", "cloud-platform/backend/drizzle/meta/_journal.json"]
        .map((rel) => ({ rel, abs: path.join(root, rel) }))
        .filter((j) => fs.existsSync(j.abs));
}

export function run(ctx = context()) {
    const found = [];

    for (const { rel, abs } of journals(ctx.root)) {
        const journal = readJson(abs);
        if (!journal?.entries?.length) {
            found.push(finding(id, WARN, `${rel} is missing or unreadable — ordering not verified.`));
            continue;
        }

        const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);

        // 1. Local monotonicity: `when` must rise with idx inside this journal.
        for (let i = 1; i < entries.length; i++) {
            const prev = entries[i - 1];
            const cur = entries[i];
            if (cur.when <= prev.when) {
                found.push(
                    finding(
                        id,
                        FAIL,
                        `${rel}: ${cur.tag} has when=${cur.when}, not after ${prev.tag} (${prev.when}). ` +
                            `Drizzle will skip it on any DB that already applied ${prev.tag}.`,
                        `Raise ${cur.tag}'s "when" above ${prev.when} in the journal and re-verify against a prod replica.`,
                    ),
                );
            }
        }

        // 2. Merge safety: a migration this branch adds must sort after everything main has.
        const mainJournal = mainVersionOf(ctx.root, rel);
        if (mainJournal?.entries?.length) {
            const mainMax = Math.max(...mainJournal.entries.map((e) => e.when));
            const mainTags = new Set(mainJournal.entries.map((e) => e.tag));
            for (const entry of entries) {
                if (mainTags.has(entry.tag)) continue;
                if (entry.when <= mainMax) {
                    found.push(
                        finding(
                            id,
                            FAIL,
                            `${rel}: new migration ${entry.tag} (when=${entry.when}) sorts at or before main's latest (${mainMax}). ` +
                                `It will be skipped on every environment already migrated to main.`,
                            `Regenerate it on top of current main, or bump its "when" past ${mainMax}.`,
                        ),
                    );
                }
            }
        }
    }

    return found.length ? found : [pass(id, "Migration journals are strictly ordered, including against main.")];
}

/** The journal as main has it, so we can tell "new on this branch" from "already shipped". */
function mainVersionOf(root, rel) {
    const base = sh("git", ["merge-base", "HEAD", "main"], root);
    if (!base) return null;
    const raw = sh("git", ["show", `${base}:${rel}`], root);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}
