/**
 * Which database a command should talk to, decided in one place.
 *
 * Before this existed every command that needed Postgres read `DATABASE_URL`
 * for itself, which was fine while there was exactly one answer. Introducing a
 * managed database makes the question real: a project may have no
 * `DATABASE_URL` at all and still expect `rebase db push` to work, and a
 * project that *does* set one must never be quietly redirected somewhere else.
 *
 * So the rule is ordered and boring, and the order is the promise:
 *
 *   1. `--database-url <url>`   — said on this command line, wins over everything
 *   2. `DATABASE_URL` in the shell environment
 *   3. the database branch this checkout is switched to
 *   4. `DATABASE_URL` in the project's `.env`
 *   5. `--docker` / a manifest preference of `docker`
 *   6. the managed PGlite database
 *
 * An explicit connection string always wins. That is the whole point of the
 * override: someone pointing Rebase at their own Postgres — a colleague's
 * staging box, a Neon branch, a container they manage — must get exactly that,
 * with no cleverness in between. The managed database is what fills the vacuum
 * when nobody has said anything, and it is the only case where the CLI picks.
 *
 * The branch at (3) is the one addition that is not an explicit connection
 * string, and it sits where it does deliberately. It has to outrank `.env` or
 * `rebase db branch switch` would silently do nothing on every project that
 * sets `DATABASE_URL` — which is every project not on the managed database.
 * It must not outrank (1) or (2), because a flag on this command line and a
 * variable in this shell are more immediate than a switch made yesterday.
 *
 * {@link resolveDevDatabase} is pure: inputs in, decision out, no filesystem
 * and no process. Reading `.env`, reading the branch pointer and starting a
 * daemon happen elsewhere, so the ordering above can be tested without any of
 * them.
 */

/** Where the answer came from. Carried so diagnostics can name it. */
export type DevDatabaseSource =
    /** `--database-url` on the command line. */
    | "flag"
    /** `DATABASE_URL` in the shell environment. */
    | "environment"
    /** `DATABASE_URL` in the project's `.env`. */
    | "env-file"
    /** The branch this checkout is switched to, over the base connection. */
    | "branch"
    /** `--docker`, or `devDatabase: "docker"` in the manifest. */
    | "docker"
    /** Nobody said anything, so the managed database fills in. */
    | "managed";

export type DevDatabase =
    | {
        kind: "external";
        /** The connection string, exactly as given. Never rewritten. */
        url: string;
        source: Extract<DevDatabaseSource, "flag" | "environment" | "env-file" | "branch">;
        /** The branch name, when this checkout is switched to one. */
        branch?: string;
    }
    | {
        kind: "docker";
        source: "docker";
    }
    | {
        kind: "managed";
        source: "managed";
    };

export interface ResolveDevDatabaseInput {
    /** `--database-url <url>`, if given. */
    flagUrl?: string | null;
    /** `--docker`, if given. */
    flagDocker?: boolean;
    /** The shell environment. Only `DATABASE_URL` is read. */
    env?: Record<string, string | undefined>;
    /** Parsed `.env` from the project root. Only `DATABASE_URL` is read. */
    envFile?: Record<string, string> | null;
    /** `devDatabase` from `rebase.json`, if the project recorded a preference. */
    manifestPreference?: "managed" | "docker" | null;
    /**
     * The branch this checkout is switched to, already resolved to a URL.
     *
     * Resolved by the caller rather than here so this stays pure: deriving it
     * needs the base connection string, which needs the `.env` this function is
     * handed rather than reads.
     */
    branch?: { name: string; url: string } | null;
}

/**
 * A value that is present but empty is treated as absent.
 *
 * `DATABASE_URL=` in a `.env` is what a developer writes when they mean "not
 * this one" — honouring it literally would hand an empty connection string to
 * libpq and produce an error about a missing host, which explains nothing.
 */
function present(value: string | undefined | null): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();

    return trimmed.length > 0 ? trimmed : null;
}

export function resolveDevDatabase(input: ResolveDevDatabaseInput = {}): DevDatabase {
    const flagUrl = present(input.flagUrl);
    if (flagUrl) return { kind: "external", url: flagUrl, source: "flag" };

    const fromEnvironment = present(input.env?.DATABASE_URL);
    if (fromEnvironment) return { kind: "external", url: fromEnvironment, source: "environment" };

    // Above `.env`, below anything said explicitly — see the ordering note at
    // the top of this file.
    const fromBranch = present(input.branch?.url);
    if (fromBranch && input.branch) {
        return { kind: "external", url: fromBranch, source: "branch", branch: input.branch.name };
    }

    const fromEnvFile = present(input.envFile?.DATABASE_URL);
    if (fromEnvFile) return { kind: "external", url: fromEnvFile, source: "env-file" };

    // Only consulted once every explicit connection string is exhausted: asking
    // for Docker is a choice about *how to get* a database, not which one, so a
    // DATABASE_URL that already names one outranks it.
    if (input.flagDocker || input.manifestPreference === "docker") {
        return { kind: "docker", source: "docker" };
    }

    return { kind: "managed", source: "managed" };
}

/** One line for the startup banner, naming both the database and why. */
export function describeDevDatabase(database: DevDatabase): string {
    switch (database.kind) {
        case "external":
            switch (database.source) {
                case "flag":
                    return "your database (--database-url)";
                case "environment":
                    return "your database (DATABASE_URL in the environment)";
                case "env-file":
                    return "your database (DATABASE_URL in .env)";
                case "branch":
                    return `branch "${database.branch}" (rebase db branch switch)`;
            }
            break;
        case "docker":
            return "Postgres in Docker";
        case "managed":
            return "the managed development database (PGlite)";
    }

    // Unreachable while the union is exhaustive; kept so a future variant fails
    // loudly in review rather than printing "undefined" to a user.
    throw new Error(`Unhandled dev database: ${JSON.stringify(database)}`);
}
