/**
 * What a Rebase Cloud token may do, named the way a person asks for it.
 *
 * A token is a personal API key on the control plane: it acts as the account
 * that created it, and holds only the scopes it was given. Nobody should have
 * to know that `rebase cloud deploy` reads the `deployments` collection, uploads
 * through the `deploy` function and needs `project:deploy` on one project — so
 * `rebase cloud tokens create --can deploy` and the console's token screen both
 * ask for a capability, and this module turns capabilities into scopes.
 *
 * One map, read by the CLI and by the console. Each capability covers exactly
 * the control-plane calls its commands make, traced from the commands
 * themselves and held there by `token-capabilities.test.ts`, which runs them
 * against a stand-in control plane that refuses everything a token does not
 * hold:
 *
 * - `deploy`   — `rebase cloud deploy` (bundle and source paths, uploads, the
 *                build follow) and `rebase cloud deployments`.
 * - `logs`     — `rebase cloud logs` (build, `--follow`, `--runtime`) and
 *                `rebase cloud metrics`.
 * - `env`      — `rebase cloud env list|set|unset|reveal|pull`.
 * - `database` — `rebase cloud db list|info|connect`.
 * - `backups`  — `rebase cloud db backup list|create|status|download` and
 *                `db pitr status`. Restoring takes `project:restore`, which no
 *                capability grants: putting old data over a live database is
 *                for a signed-in person.
 *
 * Every project-level scope is narrowed to the one project the token is for
 * (`project:deploy:<projectId>`). The data and function scopes cannot be: they
 * name a collection or a function, not a row, and the control plane's
 * row-level security keeps the token to what its owner can see.
 *
 * Deliberately free of imports, so the control plane's console can read the
 * same file.
 *
 * @module
 */

/** A capability a token can be given. */
export type TokenCapability = "deploy" | "logs" | "env" | "database" | "backups";

/** Every capability, in the order they are offered. */
export const TOKEN_CAPABILITY_NAMES: readonly TokenCapability[] = ["deploy", "logs", "env", "database", "backups"];

/**
 * Scopes every token holds, whatever it was created for: resolving a project
 * by its slug, reading the deployment a command follows, the organization a
 * project belongs to, and the control plane's public description of itself.
 */
export const ALWAYS_SCOPES: string[] = [
    "data:read:projects",
    "data:read:deployments",
    "data:read:organizations",
    "functions:invoke:platform-config"
];

/** Each capability: what it lets a token do, and the scopes that does on one project. */
export const TOKEN_CAPABILITIES: Record<TokenCapability, { label: string; scopes: (projectId: string) => string[] }> = {
    deploy: {
        label: "Deploy the project and follow its builds",
        scopes: (projectId) => [
            `project:read:${projectId}`,
            `project:deploy:${projectId}`,
            "functions:invoke:deploy"
        ]
    },
    logs: {
        label: "Read build and runtime logs, and live metrics",
        scopes: (projectId) => [
            `project:read:${projectId}`,
            `project:logs:${projectId}`,
            "functions:invoke:runtime-logs",
            "functions:invoke:metrics"
        ]
    },
    env: {
        label: "Read and change environment variables, secrets included",
        scopes: (projectId) => [
            `project:env:${projectId}`,
            "functions:invoke:env-vars"
        ]
    },
    database: {
        label: "Connect to the database and read its password",
        scopes: (projectId) => [
            `project:read:${projectId}`,
            `project:database:${projectId}`,
            "functions:invoke:db-info",
            "data:read:databases"
        ]
    },
    backups: {
        label: "List, create and download backups (restoring needs a signed-in person)",
        scopes: (projectId) => [
            `project:read:${projectId}`,
            `project:backups:${projectId}`,
            "functions:invoke:backup"
        ]
    }
};

/** Whether a word names a capability. */
export function isTokenCapability(value: string): value is TokenCapability {
    return (TOKEN_CAPABILITY_NAMES as readonly string[]).includes(value);
}

/**
 * The scopes a token for `capabilities` on one project holds: {@link ALWAYS_SCOPES}
 * first, then each capability's, each scope once.
 *
 * Throws on a project id a scope cannot carry — empty, or with whitespace — and
 * on an unknown capability, both of which are a caller's mistake rather than
 * something to mint a token from.
 */
export function scopesForCapabilities(projectId: string, capabilities: readonly TokenCapability[]): string[] {
    if (projectId.length === 0 || /\s/.test(projectId)) {
        throw new Error(`"${projectId}" is not a project id a scope can be narrowed to.`);
    }
    const scopes = new Set<string>(ALWAYS_SCOPES);
    for (const capability of capabilities) {
        if (!isTokenCapability(capability)) {
            throw new Error(`"${String(capability)}" is not a token capability. Capabilities: ${TOKEN_CAPABILITY_NAMES.join(", ")}.`);
        }
        for (const scope of TOKEN_CAPABILITIES[capability].scopes(projectId)) scopes.add(scope);
    }
    return [...scopes];
}

/**
 * Read a token's scopes back as capabilities: the projects its project scopes
 * name, and, for each, the capabilities it holds every scope of.
 *
 * For showing a token — `rebase cloud tokens list`, `rebase cloud whoami` — so
 * a list of fifteen scope strings reads as "deploy, logs on <project>".
 */
export function capabilitiesInScopes(scopes: readonly string[]): Array<{ projectId: string; capabilities: TokenCapability[] }> {
    const held = new Set(scopes);
    const projectIds: string[] = [];
    for (const scope of scopes) {
        const match = /^project:[a-z][a-z0-9-]*:(.+)$/.exec(scope);
        if (match && !projectIds.includes(match[1])) projectIds.push(match[1]);
    }
    return projectIds.map(projectId => ({
        projectId,
        capabilities: TOKEN_CAPABILITY_NAMES.filter(capability =>
            TOKEN_CAPABILITIES[capability].scopes(projectId).every(scope => held.has(scope)))
    }));
}
