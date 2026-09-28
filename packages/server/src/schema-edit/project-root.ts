/**
 * Where a project's generated artifacts belong, relative to its repository.
 *
 * `DEFAULT_COMMIT_PATHS` names `backend/src/schema.generated.ts`, which is
 * correct read from the **project** root and wrong read from anywhere else. The repository resolves what it is
 * given against its own root, and those two coincide only when the project is
 * the whole repository.
 *
 * A `rebase init` project is exactly that, so this was invisible. A project in
 * a subdirectory — an app inside a monorepo, this repository's own `app/` —
 * is not: the commit created `backend/` beside `.git`, left the real generated
 * file untouched, and committed a source change alongside a
 * stale schema. That is the failure the commit-the-whole-change design exists
 * to prevent, arriving through the design itself.
 *
 * ## Why `rebase.json`
 *
 * Because the codebase already treats it as the project marker: it is the file
 * the CLI validates as the manifest and the file `rebase resources --write`
 * writes `rebase.resources.json` beside. Using the same anchor means one answer
 * to "where does this project start", not two that can disagree.
 */
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_COMMIT_PATHS, type SchemaCommitPaths } from "@rebasepro/types";

/**
 * The nearest ancestor of `startDir` holding a `rebase.json`.
 *
 * Bounded: an unbounded walk from a misconfigured path climbs to the filesystem
 * root and reads whatever it finds there. `undefined` when there is none, which
 * is a project that predates the file — the caller then keeps the historical
 * behaviour rather than guessing.
 */
/**
 * Where a scaffolded project keeps its collection source, project-relative.
 *
 * A bundle's own collections directory is compiled output, so nothing on the
 * running machine points at this. A deployment committing to a repository states
 * it, and this is the default it states nothing against.
 */
export const DEFAULT_COLLECTIONS_PATH = "config/collections";

export function findProjectRoot(startDir: string, levels = 5): string | undefined {
    let dir = path.resolve(startDir);
    for (let i = 0; i <= levels; i++) {
        if (fs.existsSync(path.join(dir, "rebase.json"))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
    return undefined;
}

/**
 * The generated-artifact paths for a project, expressed relative to the
 * repository that will hold the commit.
 *
 * Returns `undefined` when there is nothing to correct — no project marker, or
 * a project that *is* the repository — so the caller passes no override and the
 * defaults stand. Saying "no change needed" is different from saying
 * "the change is a no-op prefix", and only the first leaves the existing
 * behaviour untouched for every project that already worked.
 */
export function commitPathsFor(
    collectionsDir: string,
    repositoryRoot: string
): Partial<SchemaCommitPaths> | undefined {
    const projectRoot = findProjectRoot(collectionsDir);
    if (!projectRoot) return undefined;

    const prefix = path.relative(path.resolve(repositoryRoot), projectRoot);
    // Empty when the project is the repository — the case the defaults were
    // written for. `..` means the project sits *outside* the repository, which
    // is not a layout this can commit for; leaving the defaults alone lets the
    // repository's own write guard refuse it by path rather than inventing one.
    if (prefix === "" || prefix.startsWith("..")) return undefined;

    const relocate = (p: string) => path.posix.join(...prefix.split(path.sep), p);
    return { schemaFile: relocate(DEFAULT_COMMIT_PATHS.schemaFile) };
}

/**
 * Does this project keep versioned migrations?
 *
 * It matters because live schema editing does not write one, and cannot: a
 * migration is Atlas's format with an integrity file, minted by an external
 * binary against a throwaway database. A server process has neither.
 *
 * What it *does* write is the collection source, which is exactly what
 * `rebase db generate` renders its desired state from — so the migration is
 * one command away.
 * The hazard is nobody saying so. A project that deploys by replaying
 * migrations would build its next environment without this change, having been
 * told the change was applied.
 */
export function usesVersionedMigrations(collectionsDir: string): boolean {
    const projectRoot = findProjectRoot(collectionsDir);
    if (!projectRoot) return false;
    return MIGRATION_DIRS.some(relative => holdsMigrations(path.join(projectRoot, relative)));
}

/**
 * Where a project's migrations can be, project-relative.
 *
 * The driver writes `drizzle/migrations/` relative to the directory it runs in,
 * and every `rebase db` subcommand runs it from the backend, which the CLI takes
 * to be `backend/` — so that is where a scaffolded project keeps them. Looking
 * only at the project root answered "no migrations" for every one of those, and
 * the warning this feeds never appeared. The root stays on the list because the
 * driver run from there writes there.
 */
const MIGRATION_DIRS = [
    path.join("backend", "drizzle", "migrations"),
    path.join("drizzle", "migrations")
];

function holdsMigrations(dir: string): boolean {
    try {
        return fs.existsSync(dir) && fs.readdirSync(dir).some(f => f.endsWith(".sql"));
    } catch {
        // Unreadable is not "absent": staying quiet about a project that may
        // replay migrations is the failure this exists to prevent.
        return true;
    }
}
