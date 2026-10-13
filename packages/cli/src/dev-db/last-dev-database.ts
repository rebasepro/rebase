/**
 * Which database the last `rebase dev` ran on, when nothing else records it.
 *
 * `rebase dev --docker` is a choice made on one command line, and every other
 * command resolved without it: while dev served the project from its compose
 * database, `rebase db url` printed a managed PGlite URL — and started that
 * daemon to print it — and `db push`, `console` and the rest would have used
 * the same empty database. Nothing said the two disagreed.
 *
 * So `rebase dev` records its choice here, and the other commands follow it
 * (`resolve.ts`, rule 5). Only Docker is recorded. Every other database is
 * already somewhere each command reads — `--database-url` aside, which is a
 * choice for one command line — or is the default, so the record holds
 * `docker` exactly when the last `rebase dev` ran on it, and any other start
 * of `rebase dev` removes it. That is also the way back: `rebase dev` without
 * `--docker`.
 *
 * Beside the branch pointer in `.rebase/`, which is gitignored: which database
 * this checkout last ran on is a fact about one machine, never the project.
 */

import fs from "fs";
import path from "path";

import type { DevDatabase } from "./resolve";

export function lastDevDatabasePath(projectRoot: string): string {
    return path.join(projectRoot, ".rebase", "dev-database.json");
}

/** Whether the last `rebase dev` ran on the compose database. */
export function readLastDevDocker(projectRoot: string): boolean {
    try {
        const parsed: unknown = JSON.parse(fs.readFileSync(lastDevDatabasePath(projectRoot), "utf8"));
        return typeof parsed === "object" && parsed !== null && "kind" in parsed && parsed.kind === "docker";
    } catch {
        // Absent is the common case; unreadable has the same answer.
        return false;
    }
}

/**
 * Record what this `rebase dev` runs on, and say what the last one ran on.
 *
 * Best effort: a checkout whose `.rebase/` cannot be written still runs, and
 * the other commands then resolve as they did before this existed.
 */
export function recordLastDevDatabase(
    projectRoot: string,
    kind: DevDatabase["kind"]
): { previous: "docker" | null } {
    const previous = readLastDevDocker(projectRoot) ? "docker" : null;
    const file = lastDevDatabasePath(projectRoot);
    try {
        if (kind === "docker") {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, `${JSON.stringify({ kind: "docker", recordedAt: new Date().toISOString() }, null, 2)}\n`);
        } else {
            fs.rmSync(file, { force: true });
        }
    } catch {
        // See above: not worth failing a dev start over.
    }

    return { previous };
}

/**
 * What `rebase dev` says when it leaves the Docker database the last run used.
 *
 * Said rather than left to be noticed: the data a developer was working with
 * is in the container, and the managed database this run is on is a different,
 * possibly empty, one.
 */
export function lastDevDatabaseNotice(previous: "docker" | null, kind: DevDatabase["kind"]): string | null {
    if (previous !== "docker" || kind === "docker") return null;

    return "The last `rebase dev` ran on Postgres in Docker; this one does not. "
        + "Pass --docker to stay on it — the other commands now follow this run.";
}
