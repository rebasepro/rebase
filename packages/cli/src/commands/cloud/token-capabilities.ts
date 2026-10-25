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
 *                build follow, `--preview`), `rebase cloud deployments` and
 *                `rebase cloud previews`.
 * - `logs`     — `rebase cloud logs` (build, `--follow`, `--runtime`,
 *                `--preview`),
 *                `rebase cloud metrics`, `rebase cloud usage` and
 *                `rebase cloud cron` — whose `runtime-token` call is how a
 *                token reads the app's own cron history.
 * - `env`      — `rebase cloud env list|set|unset|reveal|pull`, and the
 *                same with `--preview` (and `env reset --preview`).
 * - `database` — `rebase cloud db list|info|connect`.
 * - `backups`  — `rebase cloud db backup list|create|status|download` and
 *                `db pitr status`. Restoring takes `project:restore`, which no
 *                capability grants: putting old data over a live database is
 *                for a signed-in person.
 *
 * Three more capabilities act on one ORGANIZATION rather than a project, and a
 * token holds one only when it is asked for ({@link ORG_CAPABILITIES}):
 *
 * - `billing`       — `rebase cloud billing`, `billing invoices|upcoming`.
 * - `audit`         — `rebase cloud activity`.
 * - `notifications` — `rebase cloud notifications` on the organization's
 *                     projects (adding and removing one still takes the
 *                     owner or admin role).
 *
 * Each holds its `org:*` scope narrowed to the organization
 * (`org:billing:<organizationId>`).
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
 * by its slug, reading the deployment a command follows (a production one, or
 * a preview's), the organization a project belongs to, and the control plane's
 * public description of itself.
 */
export const ALWAYS_SCOPES: string[] = [
    "data:read:projects",
    "data:read:deployments",
    "data:read:preview-deployments",
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
            "functions:invoke:deploy",
            // `deploy --preview` triggers, and `cloud previews` lists and
            // deletes, through the `previews` function.
            "functions:invoke:previews"
        ]
    },
    logs: {
        label: "Read build and runtime logs, cron history, live metrics and usage",
        scopes: (projectId) => [
            `project:read:${projectId}`,
            `project:logs:${projectId}`,
            "functions:invoke:runtime-logs",
            "functions:invoke:metrics",
            "functions:invoke:runtime-token",
            // `logs --preview <name>` finds the preview through `previews`.
            "functions:invoke:previews",
            // `rebase cloud usage`: the route asks `project:read` per project.
            "functions:invoke:usage"
        ]
    },
    env: {
        label: "Read and change environment variables, secrets included",
        scopes: (projectId) => [
            `project:env:${projectId}`,
            "functions:invoke:env-vars",
            // `env … --preview`: previews' own overrides live in `previews`.
            "functions:invoke:previews"
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

/**
 * Whether a token's scopes reach one project: a project scope narrowed to it,
 * or an unnarrowed one, which reaches every project.
 *
 * What decides, in a directory `rebase cloud init --claim` linked, whether
 * `REBASE_TOKEN` or the token stored for that project acts on it: a
 * `REBASE_TOKEN` made for other projects would be refused on this one.
 */
export function scopesReachProject(scopes: readonly string[], projectId: string): boolean {
    return scopes.some(scope => {
        const match = /^project:[a-z][a-z0-9-]*(?::(.+))?$/.exec(scope);
        return match !== null && (match[1] === undefined || match[1] === projectId);
    });
}

/* ─── organization capabilities ──────────────────────────────────── */

/** A capability on one organization. A token holds one only when asked for. */
export type OrgCapability = "billing" | "audit" | "notifications";

/** Every organization capability, in the order they are offered. */
export const ORG_CAPABILITY_NAMES: readonly OrgCapability[] = ["billing", "audit", "notifications"];

/** Each organization capability: what it lets a token do, and the scopes that does on one organization. */
export const ORG_CAPABILITIES: Record<OrgCapability, { label: string; scopes: (organizationId: string) => string[] }> = {
    billing: {
        label: "Read the organization's billing: card on file, invoices and the next invoice (owners and admins)",
        scopes: (organizationId) => [
            `org:billing:${organizationId}`,
            "functions:invoke:stripe-billing",
            // `rebase cloud billing` shows the billing account row.
            "data:read:billing-accounts"
        ]
    },
    audit: {
        label: "Read the organization's activity log (owners and admins)",
        scopes: (organizationId) => [
            `org:audit:${organizationId}`,
            "functions:invoke:audit"
        ]
    },
    notifications: {
        label: "Manage notifications: your own email choices, and its projects' webhooks",
        scopes: (organizationId) => [
            `org:notifications:${organizationId}`,
            "functions:invoke:notifications"
        ]
    }
};

/** Whether a word names an organization capability. */
export function isOrgCapability(value: string): value is OrgCapability {
    return (ORG_CAPABILITY_NAMES as readonly string[]).includes(value);
}

/**
 * The scopes `capabilities` hold on one organization, each once — added to a
 * token's project scopes, so not {@link ALWAYS_SCOPES}.
 *
 * Throws on an organization id a scope cannot carry, and on an unknown
 * capability.
 */
export function scopesForOrgCapabilities(organizationId: string, capabilities: readonly OrgCapability[]): string[] {
    if (organizationId.length === 0 || /\s/.test(organizationId)) {
        throw new Error(`"${organizationId}" is not an organization id a scope can be narrowed to.`);
    }
    const scopes = new Set<string>();
    for (const capability of capabilities) {
        if (!isOrgCapability(capability)) {
            throw new Error(`"${String(capability)}" is not an organization capability. Capabilities: ${ORG_CAPABILITY_NAMES.join(", ")}.`);
        }
        for (const scope of ORG_CAPABILITIES[capability].scopes(organizationId)) scopes.add(scope);
    }
    return [...scopes];
}

/**
 * Read a token's `org:*` scopes back as organization capabilities: the
 * organizations they name, and, for each, the capabilities it holds every
 * scope of.
 */
export function orgCapabilitiesInScopes(scopes: readonly string[]): Array<{ organizationId: string; capabilities: OrgCapability[] }> {
    const held = new Set(scopes);
    const organizationIds: string[] = [];
    for (const scope of scopes) {
        const match = /^org:[a-z][a-z0-9-]*:(.+)$/.exec(scope);
        if (match && !organizationIds.includes(match[1])) organizationIds.push(match[1]);
    }
    return organizationIds.map(organizationId => ({
        organizationId,
        capabilities: ORG_CAPABILITY_NAMES.filter(capability =>
            ORG_CAPABILITIES[capability].scopes(organizationId).every(scope => held.has(scope)))
    }));
}
