/**
 * Advice a development server gives once per project, not once per boot.
 *
 * Some boot warnings describe the machine rather than the code: nothing the
 * developer does next will change them, so repeating one at every `rebase dev`
 * start and every hot restart only pushes the warnings that do change out of
 * the terminal. Such a notice is shown the first time and remembered in the
 * project's `.rebase/notices.json` (the gitignored directory that already holds
 * `state.json`), keyed by what it is about.
 *
 * The project is `REBASE_DEV_PROJECT_ROOT`, which `rebase dev` sets on the
 * backend it spawns. A process started any other way has no project to
 * remember in, so it remembers for its own lifetime only.
 *
 * @module
 */
import fs from "fs";
import path from "path";

const NOTICES_FILE = "notices.json";

/** Keys shown by this process, whatever the file said or could be written. */
const shownThisProcess = new Set<string>();

function noticesPath(projectRoot: string): string {
    return path.join(projectRoot, ".rebase", NOTICES_FILE);
}

function readShown(file: string): Record<string, string> {
    try {
        const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
        const shown: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === "string") shown[key] = value;
        }
        return shown;
    } catch {
        return {};
    }
}

/**
 * Whether the notice `key` should be shown now: `true` the first time for this
 * project (and records it), `false` after. A file that cannot be read or
 * written never hides a notice for good; at worst it repeats.
 */
export function firstTimeForProject(
    key: string,
    env: Record<string, string | undefined> = process.env
): boolean {
    if (shownThisProcess.has(key)) return false;
    shownThisProcess.add(key);

    const projectRoot = env.REBASE_DEV_PROJECT_ROOT;
    if (!projectRoot) return true;

    const file = noticesPath(projectRoot);
    const shown = readShown(file);
    if (key in shown) return false;
    shown[key] = new Date().toISOString();
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(shown, null, 2) + "\n", "utf-8");
    } catch {
        // Not remembered: shown again next boot, which is the old behaviour.
    }
    return true;
}

/** Forget what this process has shown. For tests. */
export function _resetDevNoticesForTests(): void {
    shownThisProcess.clear();
}
