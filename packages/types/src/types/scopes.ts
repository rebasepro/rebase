/**
 * Scopes — what a credential may do, named `resource:action`.
 *
 * One vocabulary for every way of reaching a Rebase backend: a person's
 * session, a service key, a personal key and an OAuth token for `/mcp` all
 * answer "may this caller do X?" with the same strings, so a grant reads the
 * same on a key, on a role and on a consent screen.
 *
 * A scope may carry a target — `data:read:posts` is `data:read` on the `posts`
 * collection only. The unqualified scope covers every target. Only the data
 * plane and app scopes take targets; see {@link SCOPE_TARGETS}.
 *
 * Two planes, held differently:
 *
 * - **The data plane** (`data:*`, `storage:*`, `functions:invoke`). Every
 *   signed-in person holds all of it, because what a person may do with data
 *   is decided row by row by the collection's `securityRules` and by storage
 *   policies, never by a scope. On a key or a token these scopes narrow: a key
 *   holding `data:read:posts` reaches nothing else, whatever RLS would allow.
 * - **The admin plane** (everything else). Nobody holds it implicitly. The
 *   `admin` role holds all of it; any other role holds what the app declares
 *   for it under `auth.roles` on the users collection.
 *
 * Apps declare their own scopes too (`auth.scopes`), named the same way —
 * `project:deploy`. Every signed-in person holds every app scope: like the data
 * plane, the function behind it decides whether the person may act, and the
 * scope exists so a key can be narrowed to that one action.
 *
 * @module
 */

/** @group Auth */
export const DATA_PLANE_SCOPES = [
    "data:read",
    "data:write",
    "data:delete",
    "storage:read",
    "storage:write",
    "storage:delete",
    "functions:invoke"
] as const;

/** @group Auth */
export const ADMIN_SCOPES = [
    "users:read",
    "users:write",
    "schema:read",
    "schema:write",
    "database:read",
    "database:write",
    "backups:read",
    "cron:read",
    "cron:write",
    "logs:read",
    "keys:read",
    "keys:write"
] as const;

/** @group Auth */
export type DataPlaneScope = (typeof DATA_PLANE_SCOPES)[number];
/** @group Auth */
export type AdminScope = (typeof ADMIN_SCOPES)[number];
/** @group Auth */
export type BuiltInScope = DataPlaneScope | AdminScope;

/** Every scope Rebase itself defines, in display order. @group Auth */
export const BUILT_IN_SCOPES: readonly BuiltInScope[] = [...DATA_PLANE_SCOPES, ...ADMIN_SCOPES];

/**
 * Scopes no key may hold.
 *
 * A key that could manage keys could mint its own successor, widen itself, or
 * revoke the keys other integrations run on — and revoking it would undo none
 * of that. Managing keys is for a person (or the service key).
 *
 * @group Auth
 */
export const KEY_MANAGEMENT_SCOPES: readonly AdminScope[] = ["keys:read", "keys:write"];

/** The one built-in role. It holds every scope and is the RLS `admin` role. @group Auth */
export const ADMIN_ROLE = "admin";

/** What a scope's target names. @group Auth */
export type ScopeTargetKind = "collection" | "bucket" | "function";

/**
 * The built-in scopes that accept a target, and what the target names.
 *
 * - `data:*` — a collection slug
 * - `storage:*` — a storage source id (`(default)` for the default source)
 * - `functions:invoke` — a custom function's name
 *
 * @group Auth
 */
export const SCOPE_TARGETS: Readonly<Partial<Record<BuiltInScope, ScopeTargetKind>>> = {
    "data:read": "collection",
    "data:write": "collection",
    "data:delete": "collection",
    "storage:read": "bucket",
    "storage:write": "bucket",
    "storage:delete": "bucket",
    "functions:invoke": "function"
};

/** A scope's wording, for the screens that ask a person to grant it. @group Auth */
export interface ScopeDescription {
    /** Short, imperative: what a holder may do. */
    label: string;
    /** One sentence on what that reaches, including anything surprising. */
    description: string;
}

/** @group Auth */
export const BUILT_IN_SCOPE_DESCRIPTIONS: Readonly<Record<BuiltInScope, ScopeDescription>> = {
    "data:read": {
        label: "Read data",
        description: "Read rows from collections, through the caller's row-level security."
    },
    "data:write": {
        label: "Create and update data",
        description: "Create and update rows in collections, through the caller's row-level security."
    },
    "data:delete": {
        label: "Delete data",
        description: "Delete rows from collections, through the caller's row-level security."
    },
    "storage:read": {
        label: "Read files",
        description: "List and download stored files."
    },
    "storage:write": {
        label: "Upload files",
        description: "Upload files and create folders."
    },
    "storage:delete": {
        label: "Delete files",
        description: "Delete stored files."
    },
    "functions:invoke": {
        label: "Call functions",
        description: "Call the backend's custom functions. A function can do anything its code does."
    },
    "users:read": {
        label: "See users",
        description: "List user accounts and their roles."
    },
    "users:write": {
        label: "Manage users",
        description: "Create, edit and delete accounts, reset passwords and second factors, and assign roles up to the holder's own."
    },
    "schema:read": {
        label: "See the schema",
        description: "Read the collection schema, plan schema changes and run the RLS audit."
    },
    "schema:write": {
        label: "Change the schema",
        description: "Apply schema changes: edits collection files and alters the database."
    },
    "database:read": {
        label: "Inspect the database",
        description: "List databases, tables, Postgres roles and branches."
    },
    "database:write": {
        label: "Run SQL",
        description: "Run SQL as the database owner, outside row-level security, and create or delete branches."
    },
    "backups:read": {
        label: "Download backups",
        description: "List and download database backups — every row, outside row-level security."
    },
    "cron:read": {
        label: "See cron jobs",
        description: "List cron jobs and read their run history."
    },
    "cron:write": {
        label: "Run cron jobs",
        description: "Trigger cron jobs and switch them on or off."
    },
    "logs:read": {
        label: "Read server logs",
        description: "Read the server's request and application logs."
    },
    "keys:read": {
        label: "See service keys",
        description: "List the project's service keys. Never grantable to a key."
    },
    "keys:write": {
        label: "Manage service keys",
        description: "Create, change and revoke the project's service keys. Never grantable to a key."
    }
};

/**
 * An app-declared scope, under `auth.scopes` on the users collection.
 *
 * @example
 * ```ts
 * auth: {
 *     enabled: true,
 *     scopes: {
 *         "project:deploy": { label: "Deploy projects", target: "project" }
 *     }
 * }
 * ```
 *
 * @group Auth
 */
export interface ScopeDefinition {
    /** Short, imperative: what a holder may do. Shown wherever the scope is granted. */
    label: string;
    /** One sentence on what that reaches. */
    description?: string;
    /**
     * What a target names, when the scope accepts one — `"project"` lets a
     * key hold `project:deploy:<id>`. Unset, the scope takes no target.
     */
    target?: string;
}

/**
 * An app-declared role, under `auth.roles` on the users collection.
 *
 * A role is a name the database sees (RLS policies match it) and a bundle of
 * admin-plane and app scopes. Data-plane scopes are not role scopes: what a
 * person may do with data is the collection's `securityRules`, so listing
 * `data:write` here would read as a grant it is not, and is refused.
 *
 * @example
 * ```ts
 * auth: {
 *     enabled: true,
 *     roles: {
 *         support: { name: "Support", scopes: ["users:read", "users:write", "logs:read"] },
 *         developer: { name: "Developer", scopes: ["schema:read", "database:read", "logs:read", "cron:read"] }
 *     }
 * }
 * ```
 *
 * @group Auth
 */
export interface RoleDefinition {
    /** Display name. Defaults to the role id. */
    name?: string;
    /** One sentence on who holds it. */
    description?: string;
    /** Admin-plane and app scopes the role holds. */
    scopes: readonly string[];
}

/**
 * The declared access model: the app's own scopes and roles beside the
 * built-in ones. What `scopesForRoles` and `validateScopes` read.
 *
 * @group Auth
 */
export interface AccessModel {
    roles: Readonly<Record<string, RoleDefinition>>;
    scopes: Readonly<Record<string, ScopeDefinition>>;
}

/** The access model of an app that declares nothing: built-ins only. @group Auth */
export const EMPTY_ACCESS_MODEL: AccessModel = { roles: {}, scopes: {} };

/** A scope string split into its scope and optional target. @group Auth */
export interface ParsedScope {
    /** `resource:action`. */
    scope: string;
    /** The one collection, bucket, function or app resource it is narrowed to. */
    target?: string;
}

const SCOPE_PART = /^[a-z][a-z0-9-]*$/;

/**
 * Split `resource:action[:target]`. Returns null for anything else.
 *
 * The target is everything after the second colon, so a target may itself
 * contain colons. Resource and action are lower-case words.
 *
 * @group Auth
 */
export function parseScope(value: string): ParsedScope | null {
    if (typeof value !== "string") return null;
    const first = value.indexOf(":");
    if (first < 0) return null;
    const second = value.indexOf(":", first + 1);
    const resource = value.slice(0, first);
    const action = second < 0 ? value.slice(first + 1) : value.slice(first + 1, second);
    if (!SCOPE_PART.test(resource) || !SCOPE_PART.test(action)) return null;
    if (second < 0) return { scope: `${resource}:${action}` };
    const target = value.slice(second + 1);
    if (target.length === 0 || /\s/.test(target)) return null;
    return { scope: `${resource}:${action}`, target };
}

/** @group Auth */
export function isBuiltInScope(scope: string): scope is BuiltInScope {
    return (BUILT_IN_SCOPES as readonly string[]).includes(scope);
}

/** @group Auth */
export function isDataPlaneScope(scope: string): scope is DataPlaneScope {
    return (DATA_PLANE_SCOPES as readonly string[]).includes(scope);
}

/** @group Auth */
export function isAdminScope(scope: string): scope is AdminScope {
    return (ADMIN_SCOPES as readonly string[]).includes(scope);
}

/** Does this list of roles include the built-in `admin` role? @group Auth */
export function hasAdminRole(roles: readonly string[] | null | undefined): boolean {
    return !!roles?.includes(ADMIN_ROLE);
}

/**
 * Does a set of held scopes grant `scope`, optionally on one `target`?
 *
 * The unqualified grant covers every target. A qualified grant covers its own
 * target only, and never answers an unqualified question: a key holding
 * `data:read:posts` is not asked "may you read data?" and told yes.
 *
 * @group Auth
 */
export function scopeGrants(held: readonly string[], scope: string, target?: string): boolean {
    for (const entry of held) {
        if (entry === scope) return true;
        if (target !== undefined && entry === `${scope}:${target}`) return true;
    }
    return false;
}

/**
 * Does a set of held scopes grant `scope` on at least one target?
 *
 * For a surface that lists what is reachable — the collections an MCP client
 * may query — and filters per item afterwards.
 *
 * @group Auth
 */
export function scopeGrantsAny(held: readonly string[], scope: string): boolean {
    const prefix = `${scope}:`;
    return held.some(entry => entry === scope || entry.startsWith(prefix));
}

/**
 * The targets a held set narrows `scope` to: `"all"` when it holds the
 * unqualified scope, otherwise the listed targets (possibly none).
 *
 * @group Auth
 */
export function scopeTargets(held: readonly string[], scope: string): "all" | string[] {
    const prefix = `${scope}:`;
    const targets: string[] = [];
    for (const entry of held) {
        if (entry === scope) return "all";
        if (entry.startsWith(prefix)) targets.push(entry.slice(prefix.length));
    }
    return targets;
}

/**
 * Every scope a person holding `roles` has.
 *
 * The data plane and every app scope always; the whole admin plane with the
 * `admin` role; otherwise each declared role's scopes. A role nobody declared
 * adds nothing — it may still mean something to an RLS policy.
 *
 * @group Auth
 */
export function scopesForRoles(roles: readonly string[] | null | undefined, model: AccessModel = EMPTY_ACCESS_MODEL): string[] {
    const held = new Set<string>([...DATA_PLANE_SCOPES, ...Object.keys(model.scopes)]);
    if (hasAdminRole(roles)) {
        for (const scope of ADMIN_SCOPES) held.add(scope);
        return [...held];
    }
    for (const role of roles ?? []) {
        const definition = Object.prototype.hasOwnProperty.call(model.roles, role) ? model.roles[role] : undefined;
        for (const scope of definition?.scopes ?? []) held.add(scope);
    }
    return [...held];
}

/**
 * Every scope this access model knows, unqualified: the built-ins, then the
 * app's own.
 *
 * @group Auth
 */
export function knownScopes(model: AccessModel = EMPTY_ACCESS_MODEL): string[] {
    return [...BUILT_IN_SCOPES, ...Object.keys(model.scopes)];
}

/** Does this scope accept a target? @group Auth */
export function scopeAcceptsTarget(scope: string, model: AccessModel = EMPTY_ACCESS_MODEL): boolean {
    if (isBuiltInScope(scope)) return SCOPE_TARGETS[scope] !== undefined;
    const definition = Object.prototype.hasOwnProperty.call(model.scopes, scope) ? model.scopes[scope] : undefined;
    return definition?.target !== undefined;
}

/** How a scope string failed to validate. @group Auth */
export interface ScopeProblem {
    scope: string;
    reason: "malformed" | "unknown" | "target-not-accepted";
}

/**
 * Check a list of scope strings against an access model. Returns the
 * problems, empty when every entry is a known scope with an acceptable target.
 *
 * @group Auth
 */
export function validateScopes(values: readonly unknown[], model: AccessModel = EMPTY_ACCESS_MODEL): ScopeProblem[] {
    const known = new Set(knownScopes(model));
    const problems: ScopeProblem[] = [];
    for (const value of values) {
        const text = typeof value === "string" ? value : String(value);
        const parsed = typeof value === "string" ? parseScope(value) : null;
        if (!parsed) {
            problems.push({ scope: text, reason: "malformed" });
        } else if (!known.has(parsed.scope)) {
            problems.push({ scope: text, reason: "unknown" });
        } else if (parsed.target !== undefined && !scopeAcceptsTarget(parsed.scope, model)) {
            problems.push({ scope: text, reason: "target-not-accepted" });
        }
    }
    return problems;
}

/**
 * The entries of `requested` that `held` does not cover — what a credential
 * would hold beyond its minter. Empty means the request is within reach.
 *
 * `data:read:posts` is covered by `data:read`; `data:read` is not covered by
 * `data:read:posts`.
 *
 * @group Auth
 */
export function scopesBeyond(requested: readonly string[], held: readonly string[]): string[] {
    return requested.filter(entry => {
        const parsed = parseScope(entry);
        if (!parsed) return true;
        return !scopeGrants(held, parsed.scope, parsed.target);
    });
}

/**
 * Narrow `requested` to what `held` covers, entry by entry. What a personal
 * key holds today when its owner has lost a role since it was minted.
 *
 * @group Auth
 */
export function intersectScopes(requested: readonly string[], held: readonly string[]): string[] {
    const beyond = new Set(scopesBeyond(requested, held));
    return requested.filter(entry => !beyond.has(entry));
}

/**
 * How a scope is worded for a person: the built-in description, the app's
 * declared label, or the raw string when nothing describes it. A target is
 * named after the label.
 *
 * @group Auth
 */
export function describeScope(value: string, model: AccessModel = EMPTY_ACCESS_MODEL): ScopeDescription {
    const parsed = parseScope(value);
    if (!parsed) return { label: value, description: "" };
    let base: ScopeDescription | undefined;
    if (isBuiltInScope(parsed.scope)) {
        base = BUILT_IN_SCOPE_DESCRIPTIONS[parsed.scope];
    } else if (Object.prototype.hasOwnProperty.call(model.scopes, parsed.scope)) {
        const definition = model.scopes[parsed.scope];
        base = { label: definition.label, description: definition.description ?? "" };
    }
    const label = base?.label ?? parsed.scope;
    return {
        label: parsed.target !== undefined ? `${label}: ${parsed.target}` : label,
        description: base?.description ?? ""
    };
}

/** A role as a person managing access sees it. @group Auth */
export interface RoleSummary {
    id: string;
    name: string;
    description?: string;
    /** Admin-plane and app scopes. The `admin` role lists every admin-plane scope. */
    scopes: string[];
    /** True for `admin`, which the app does not declare. */
    builtIn: boolean;
}

/** A scope as a screen that grants it lists it. @group Auth */
export interface ScopeSummary {
    scope: string;
    label: string;
    description: string;
    /** What a target names, when the scope takes one. */
    target?: string;
    /** `data`, `admin` or `app`: which plane the scope belongs to. */
    plane: "data" | "admin" | "app";
}

/** The roles of an access model, `admin` first. @group Auth */
export function summarizeRoles(model: AccessModel = EMPTY_ACCESS_MODEL): RoleSummary[] {
    return [
        { id: ADMIN_ROLE, name: "Admin", description: "Holds every scope and reads every row.", scopes: [...ADMIN_SCOPES], builtIn: true },
        ...Object.entries(model.roles).map(([id, definition]) => ({
            id,
            name: definition.name ?? id,
            ...(definition.description ? { description: definition.description } : {}),
            scopes: [...definition.scopes],
            builtIn: false
        }))
    ];
}

/** Every scope of an access model, described, in display order. @group Auth */
export function summarizeScopes(model: AccessModel = EMPTY_ACCESS_MODEL): ScopeSummary[] {
    const builtIn: ScopeSummary[] = BUILT_IN_SCOPES.map(scope => ({
        scope,
        ...BUILT_IN_SCOPE_DESCRIPTIONS[scope],
        ...(SCOPE_TARGETS[scope] ? { target: SCOPE_TARGETS[scope] } : {}),
        plane: isDataPlaneScope(scope) ? "data" : "admin"
    }));
    const app: ScopeSummary[] = Object.entries(model.scopes).map(([scope, definition]) => ({
        scope,
        label: definition.label,
        description: definition.description ?? "",
        ...(definition.target ? { target: definition.target } : {}),
        plane: "app"
    }));
    return [...builtIn, ...app];
}
