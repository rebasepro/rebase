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
        if (!mainJournal?.entries?.length) {
            // Say so. This comparison was silently unavailable for the saas
            // journal for its entire existence, and the check still reported
            // "strictly ordered, including against main" — a green line for work
            // that never happened. A gate that cannot run must not read as one
            // that ran and passed.
            found.push(
                finding(
                    id,
                    WARN,
                    `${rel}: could not read main's journal, so merge safety was NOT checked. ` +
                        "Only ordering within this branch was verified.",
                    "Ensure the repository tracking this journal has a `main` branch and shares history with HEAD.",
                ),
            );
        } else {
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

/**
 * The journal as main has it, so we can tell "new on this branch" from "already shipped".
 *
 * The path has to be resolved against the repository that actually TRACKS the
 * journal, which is not always the one this check is running in. `saas/` is
 * gitignored in the monorepo and is its own repository, so
 * `git show <base>:saas/backend/drizzle/meta/_journal.json` at the monorepo root
 * fails with "exists on disk, but not in HEAD" — `sh` swallows that into `""`,
 * this returned null, and the entire merge-safety half of the check was skipped
 * while the summary line still read "including against main". The half that had
 * never once run is the half the check exists for: a lone journal is trivially
 * monotonic, and two branches racing is the failure mode.
 *
 * So: find the enclosing repository from the journal's own directory and ask
 * that one, with a path relative to it. For a journal the monorepo does track,
 * this resolves to the monorepo and behaves exactly as before.
 */
function mainVersionOf(root, rel) {
    // Both sides are realpath'd before being compared. `--show-toplevel` reports
    // a resolved path, so on macOS — where /tmp and /var are symlinks — pairing
    // it with an unresolved `abs` yields a `path.relative` full of `..`, `git
    // show` fails, and this silently returns null: the exact failure mode being
    // fixed here, reintroduced one layer down.
    let abs = path.join(root, rel);
    try {
        abs = fs.realpathSync(abs);
    } catch {
        return null;
    }

    const repoRoot = sh("git", ["rev-parse", "--show-toplevel"], path.dirname(abs));
    if (!repoRoot) return null;

    const relToRepo = path.relative(repoRoot, abs);
    const base = sh("git", ["merge-base", "HEAD", "main"], repoRoot);
    if (!base) return null;
    const raw = sh("git", ["show", `${base}:${relToRepo}`], repoRoot);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}
