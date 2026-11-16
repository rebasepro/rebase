import fs from "fs";
import os from "os";
import path from "path";

/**
 * The one-time "a star helps" line `rebase init` closes on.
 *
 * Shown once per machine, at the moment a project has just been created and
 * worked — never on every run, never from any other command. After the first
 * time, init prints the plain GitHub link it always printed. The record lives
 * beside the other per-machine state in `~/.rebase/` and holds nothing but the
 * date it was shown.
 *
 * Not shown, and not recorded, when nobody is there to read it: a non-TTY run
 * or CI. That way a scripted scaffold does not use up the one showing.
 */

export const REPO_URL = "https://github.com/rebasepro/rebase";

export function starNudgePath(home: string = os.homedir()): string {
    return path.join(home, ".rebase", "star-nudge.json");
}

export function hasSeenStarNudge(file: string = starNudgePath()): boolean {
    return fs.existsSync(file);
}

export function markStarNudgeSeen(file: string = starNudgePath(), now: Date = new Date()): void {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ shownAt: now.toISOString() }) + "\n");
    } catch {
        // A read-only home only means the line may show again next time.
    }
}

export interface StarNudgeContext {
    isTTY: boolean;
    env: NodeJS.ProcessEnv;
}

/**
 * The line to print where init lists its links, and whether it used up the
 * one showing. The caller records it with `markStarNudgeSeen` when `nudge` is true.
 */
export function initRepoLine(
    seen: boolean,
    context: StarNudgeContext
): { line: string; nudge: boolean } {
    const interactive = context.isTTY && !context.env.CI;
    if (!seen && interactive) {
        return {
            line: `⭐ If Rebase saves you time, a star helps: ${REPO_URL}`,
            nudge: true
        };
    }
    return {
        line: `GitHub: ${REPO_URL}`,
        nudge: false
    };
}
