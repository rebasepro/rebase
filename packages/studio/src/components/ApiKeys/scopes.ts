/**
 * The pure half of the API-key panel: reading a key's scopes back as groups a
 * person can scan, and turning the create dialog's picker into the scope list
 * the server mints.
 *
 * The vocabulary itself — what a scope is, which ones take a target, which
 * plane each belongs to — is `@rebasepro/types`' `scopes.ts`, the same module
 * the server enforces with. Nothing here re-derives it; this file only shapes
 * it for the screen, so it can be tested without rendering one.
 *
 * @module
 */

import {
    describeScope,
    isAdminScope,
    isDataPlaneScope,
    KEY_MANAGEMENT_SCOPES,
    parseScope,
    scopeGrantsAny,
    scopeTargets,
    summarizeScopes,
    type ScopeSummary
} from "@rebasepro/types";

/** Which plane a scope belongs to, as `GET /auth/scopes` names it. */
export type ScopePlane = ScopeSummary["plane"];

/** The planes in the order the panel shows them. */
export const SCOPE_PLANES: readonly ScopePlane[] = ["data", "admin", "app"];

/* ═══════════════════════════════════════════════════════════════
   Reading a key's scopes
   ═══════════════════════════════════════════════════════════════ */

/** One scope a key holds, with every target it holds it on. */
export interface HeldScope {
    /** `resource:action`, without a target. */
    scope: string;
    label: string;
    description: string;
    plane: ScopePlane;
    /** What a target names — `collection`, `bucket`, `function`, or an app's own word. */
    targetKind?: string;
    /** `"all"` for the unqualified grant, otherwise the targets it is narrowed to. */
    targets: "all" | string[];
}

export interface ScopeGroup {
    plane: ScopePlane;
    scopes: HeldScope[];
}

function planeOf(scope: string): ScopePlane {
    if (isDataPlaneScope(scope)) return "data";
    if (isAdminScope(scope)) return "admin";
    return "app";
}

/**
 * A key's scopes, grouped by plane and folded per scope: `data:read:posts` and
 * `data:read:authors` read as one "Read data" row narrowed to two collections,
 * and `data:read` beside them as the same row on every collection.
 *
 * Ordered the way the catalogue lists scopes; a scope the catalogue does not
 * know (an app scope removed since the key was minted) keeps its raw name and
 * lands at the end of the plane it would belong to.
 */
export function groupKeyScopes(
    scopes: readonly string[],
    catalogue: readonly ScopeSummary[] = summarizeScopes()
): ScopeGroup[] {
    const bases: string[] = [];
    for (const entry of scopes) {
        const base = parseScope(entry)?.scope ?? entry;
        if (!bases.includes(base)) bases.push(base);
    }

    const position = (base: string): number => {
        const index = catalogue.findIndex(summary => summary.scope === base);
        return index < 0 ? catalogue.length + bases.indexOf(base) : index;
    };
    bases.sort((a, b) => position(a) - position(b));

    const held: HeldScope[] = bases.map(base => {
        const summary = catalogue.find(entry => entry.scope === base);
        const parsed = parseScope(base);
        const fallback = describeScope(base);
        return {
            scope: base,
            label: summary?.label ?? fallback.label,
            description: summary?.description ?? fallback.description,
            plane: summary?.plane ?? planeOf(base),
            ...(summary?.target ? { targetKind: summary.target } : {}),
            targets: parsed ? scopeTargets(scopes, base) : "all"
        };
    });

    return SCOPE_PLANES
        .map(plane => ({ plane, scopes: held.filter(entry => entry.plane === plane) }))
        .filter(group => group.scopes.length > 0);
}

/* ═══════════════════════════════════════════════════════════════
   What the create dialog may offer
   ═══════════════════════════════════════════════════════════════ */

/** Never offered: a key that manages keys could mint its own successor. */
export function isKeyManagementScope(scope: string): boolean {
    return (KEY_MANAGEMENT_SCOPES as readonly string[]).includes(scope);
}

/**
 * The catalogue entries a caller may put on a key: the ones they hold, on at
 * least one target, minus key management. The server refuses anything else
 * (`SCOPE_EXCEEDS_CREATOR`, `KEY_MANAGEMENT_SCOPE`), so offering it would only
 * be a way to fail.
 */
export function grantableScopes(catalogue: readonly ScopeSummary[], held: readonly string[]): ScopeSummary[] {
    return catalogue.filter(summary => !isKeyManagementScope(summary.scope) && scopeGrantsAny(held, summary.scope));
}

/* ═══════════════════════════════════════════════════════════════
   Picker state
   ═══════════════════════════════════════════════════════════════ */

/** For one chosen scope: every target, or only the listed ones. */
export type TargetChoice =
    | { mode: "all" }
    | { mode: "some"; targets: string[] };

/** The chosen scopes, keyed by `resource:action`. A scope absent here is not chosen. */
export type ScopeSelection = Readonly<Record<string, TargetChoice>>;

/** `data:read` on everything — the narrowest useful key, and what the dialog opens with. */
export function defaultSelection(grantable: readonly ScopeSummary[]): ScopeSelection {
    return grantable.some(summary => summary.scope === "data:read") ? { "data:read": { mode: "all" } } : {};
}

function cleanTargets(targets: readonly string[]): string[] {
    const out: string[] = [];
    for (const raw of targets) {
        const target = raw.trim();
        if (target && !/\s/.test(target) && !out.includes(target)) out.push(target);
    }
    return out;
}

/**
 * The scope strings a selection mints, in catalogue order when one is given.
 *
 * A scope on every target is sent unqualified; one narrowed to targets is sent
 * once per target. A scope narrowed to no target at all grants nothing and is
 * left out — {@link incompleteScopes} is how the dialog says so.
 */
export function buildScopeList(selection: ScopeSelection, order: readonly string[] = []): string[] {
    const chosen = Object.keys(selection);
    const rank = (scope: string): number => {
        const index = order.indexOf(scope);
        return index < 0 ? order.length + chosen.indexOf(scope) : index;
    };
    const out: string[] = [];
    for (const scope of [...chosen].sort((a, b) => rank(a) - rank(b))) {
        const choice = selection[scope];
        if (choice.mode === "all") {
            out.push(scope);
        } else {
            for (const target of cleanTargets(choice.targets)) out.push(`${scope}:${target}`);
        }
    }
    return out;
}

/** Scopes switched to "only some" with nothing chosen yet. */
export function incompleteScopes(selection: ScopeSelection): string[] {
    return Object.entries(selection)
        .filter(([, choice]) => choice.mode === "some" && cleanTargets(choice.targets).length === 0)
        .map(([scope]) => scope);
}

/** Free text in a target field: commas or whitespace separate entries. */
export function splitList(text: string): string[] {
    return cleanTargets(text.split(/[\s,]+/));
}

/* ═══════════════════════════════════════════════════════════════
   The roles a service key runs as
   ═══════════════════════════════════════════════════════════════ */

/**
 * The roles a service key runs as beside `service`: the picked ones, then any
 * typed ones, deduplicated. `service` itself is every service key's identity
 * already, so listing it adds nothing and is dropped, as the server does.
 */
export function combineRoles(picked: readonly string[], typed: string): string[] {
    const out: string[] = [];
    for (const role of [...picked, ...splitList(typed)]) {
        const id = role.trim();
        if (id && id !== "service" && !out.includes(id)) out.push(id);
    }
    return out;
}

/* ═══════════════════════════════════════════════════════════════
   Limits
   ═══════════════════════════════════════════════════════════════ */

export const EXPIRY_CHOICES = ["never", "7d", "30d", "90d", "1y"] as const;
export type ExpiryChoice = (typeof EXPIRY_CHOICES)[number];

const EXPIRY_DAYS: Record<Exclude<ExpiryChoice, "never">, number> = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };

export function isExpiryChoice(value: string): value is ExpiryChoice {
    return (EXPIRY_CHOICES as readonly string[]).includes(value);
}

/** The `expires_at` an expiry choice sends: an ISO instant, or null for never. */
export function expiresAtFor(choice: ExpiryChoice, now: number = Date.now()): string | null {
    if (choice === "never") return null;
    return new Date(now + EXPIRY_DAYS[choice] * 86_400_000).toISOString();
}

/** The `rate_limit` a rate-limit field sends: a positive integer, or null for the server default. */
export function rateLimitFrom(text: string): number | null {
    const digits = text.replace(/\D/g, "");
    if (!digits) return null;
    const value = parseInt(digits, 10);
    return value >= 1 ? value : null;
}

/* ═══════════════════════════════════════════════════════════════
   What the server answers
   ═══════════════════════════════════════════════════════════════ */

/** The minting refusals the dialog names, beside the server's own message. */
export const KEY_ERROR_CODES = [
    "INVALID_SCOPES",
    "SCOPE_EXCEEDS_CREATOR",
    "ROLE_EXCEEDS_CREATOR",
    "UNKNOWN_SCOPE_TARGET",
    "KEY_MANAGEMENT_SCOPE"
] as const;
export type KeyErrorCode = (typeof KEY_ERROR_CODES)[number];

export interface KeyError {
    /** One of {@link KEY_ERROR_CODES}, or null for anything else. */
    code: KeyErrorCode | null;
    /** The server's message, never re-worded. */
    message: string;
}

function codeOf(error: unknown): string | null {
    if (typeof error !== "object" || error === null || !("code" in error)) return null;
    return typeof error.code === "string" ? error.code : null;
}

function isKeyErrorCode(code: string | null): code is KeyErrorCode {
    return code !== null && (KEY_ERROR_CODES as readonly string[]).includes(code);
}

export function readKeyError(error: unknown): KeyError {
    const code = codeOf(error);
    return {
        code: isKeyErrorCode(code) ? code : null,
        message: error instanceof Error ? error.message : String(error)
    };
}

/** The backend answered `403 PERSONAL_KEYS_DISABLED`: the app has not switched them on. */
export function isPersonalKeysDisabled(error: unknown): boolean {
    return codeOf(error) === "PERSONAL_KEYS_DISABLED";
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(entry => typeof entry === "string");
}

function isPlane(value: unknown): value is ScopePlane {
    return value === "data" || value === "admin" || value === "app";
}

function readScopeSummary(value: unknown): ScopeSummary | null {
    if (typeof value !== "object" || value === null) return null;
    if (!("scope" in value) || typeof value.scope !== "string") return null;
    if (!("plane" in value) || !isPlane(value.plane)) return null;
    const label = "label" in value && typeof value.label === "string" ? value.label : value.scope;
    const description = "description" in value && typeof value.description === "string" ? value.description : "";
    const target = "target" in value && typeof value.target === "string" ? value.target : undefined;
    return { scope: value.scope, label, description, plane: value.plane, ...(target ? { target } : {}) };
}

/** What `GET /auth/scopes` answers. */
export interface ScopeListing {
    scopes: ScopeSummary[];
    held: string[];
}


/**
 * Read `GET /auth/scopes`. Null for anything that is not that shape — a backend
 * older than scopes answers this route with something else, and offering a
 * picker built from it would offer scopes the server does not know.
 */
export function readScopeListing(body: unknown): ScopeListing | null {
    if (typeof body !== "object" || body === null) return null;
    if (!("scopes" in body) || !Array.isArray(body.scopes)) return null;
    if (!("held" in body) || !isStringArray(body.held)) return null;
    const scopes: ScopeSummary[] = [];
    for (const entry of body.scopes) {
        const summary = readScopeSummary(entry);
        if (summary) scopes.push(summary);
    }
    return { scopes, held: body.held };
}

/** Function names out of `GET /functions` — `{ functions: [{ name }] }`. */
export function functionNamesFrom(body: unknown): string[] {
    if (typeof body !== "object" || body === null || !("functions" in body) || !Array.isArray(body.functions)) return [];
    const names: string[] = [];
    for (const entry of body.functions) {
        if (typeof entry === "object" && entry !== null && "name" in entry && typeof entry.name === "string" && entry.name) {
            names.push(entry.name);
        }
    }
    return names;
}
