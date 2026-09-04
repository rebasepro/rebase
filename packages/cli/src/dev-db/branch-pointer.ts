/**
 * Which database branch this checkout is working on.
 *
 * `rebase db branch create` made a full copy of the database in about a second
 * and then stopped one step short of being a feature: there was no `switch`, no
 * `--branch` on `rebase dev`, and nothing wrote the branch anywhere a command
 * would read it. The only way to *use* a branch was to hand-edit
 * `DATABASE_URL`, and the documentation claimed otherwise — "the CLI updates
 * your local development configuration" — which it did not; the `.env` was
 * byte-identical afterwards.
 *
 * This is that missing step, and the shape of it is chosen to avoid three
 * things:
 *
 * 1. **It does not touch `.env`.** That file holds secrets, comments and the
 *    developer's own ordering, and a command that rewrites it in place will
 *    eventually lose something that was not its business. The branch is
 *    recorded beside the other per-checkout state in `.rebase/`, which is
 *    already gitignored — a branch is a fact about one machine, never about
 *    the project.
 *
 * 2. **It stores a name, not a connection string.** The credentials stay in
 *    exactly one place; the URL is derived by swapping the database name on
 *    the base one at resolution time. A stored URL would be a second copy of
 *    the password, and would go stale the moment `.env` changed.
 *
 * 3. **It does not outrank an explicit instruction.** `--database-url` and a
 *    `DATABASE_URL` in the shell are more immediate and more specific than a
 *    switch made yesterday, so they still win. The pointer sits directly above
 *    the project's `.env`: it is a deliberate, persistent choice, and `.env` is
 *    the project default it is meant to override. Anything less and `switch`
 *    would silently do nothing on every project that sets `DATABASE_URL` —
 *    which is every project not using the managed database.
 */

import fs from "fs";
import path from "path";

/** Where the pointer lives, next to the rest of the per-checkout state. */
export function branchPointerPath(projectRoot: string): string {
    return path.join(projectRoot, ".rebase", "branch.json");
}

export interface ActiveBranch {
    /** The name the developer typed. */
    name: string;
    /** The PostgreSQL database that name refers to. */
    database: string;
}

/**
 * The prefix `BranchService` puts on every branch database.
 *
 * Duplicated from the driver rather than imported because the CLI must answer
 * "which database" without loading a database driver — `rebase dev` reads this
 * before it knows which plugin the project uses. It is covered by a test that
 * fails if the driver's prefix moves.
 */
export const BRANCH_DB_PREFIX = "rb_";

export function branchDatabaseName(name: string): string {
    return `${BRANCH_DB_PREFIX}${name}`;
}

/** Read the active branch, or null when the checkout is on the main database. */
export function readActiveBranch(projectRoot: string): ActiveBranch | null {
    try {
        const raw = fs.readFileSync(branchPointerPath(projectRoot), "utf-8");
        const parsed = JSON.parse(raw) as Partial<ActiveBranch>;
        if (typeof parsed.name !== "string" || typeof parsed.database !== "string") return null;
        if (!parsed.name || !parsed.database) return null;

        return { name: parsed.name, database: parsed.database };
    } catch {
        // Absent is the common case and is not an error. A corrupt file is
        // treated the same way: the answer is "no branch", which is the state
        // the developer can always get back to with `branch switch --off`.
        return null;
    }
}

export function writeActiveBranch(projectRoot: string, branch: ActiveBranch): void {
    const file = branchPointerPath(projectRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(branch, null, 2)}\n`, "utf-8");
}

/** Return to the main database. Absent is success — this is idempotent. */
export function clearActiveBranch(projectRoot: string): void {
    fs.rmSync(branchPointerPath(projectRoot), { force: true });
}

/**
 * The base connection string with its database swapped for the branch's.
 *
 * Everything else is carried across untouched — credentials, host, port, and
 * the query string, which is load-bearing here: `?sslmode=disable` is what a
 * local Docker Postgres needs, and dropping it turns a switch into a TLS error
 * that says nothing about branches.
 *
 * Returns null for a connection string that cannot be parsed, so the caller can
 * say so plainly rather than emitting a mangled URL that fails later.
 */
export function branchUrl(baseUrl: string, database: string): string | null {
    try {
        const url = new URL(baseUrl);
        // `pathname` keeps its leading slash; a URL with no database at all
        // still gets one, which is what connecting to a named branch means.
        url.pathname = `/${database}`;

        return url.toString();
    } catch {
        return null;
    }
}

/** The database name in a connection string, for reporting what you are on. */
export function databaseNameOf(connectionString: string): string | null {
    try {
        const name = new URL(connectionString).pathname.replace(/^\//, "");

        return name || null;
    } catch {
        return null;
    }
}
