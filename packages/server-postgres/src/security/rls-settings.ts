import { adminRequestRoleFor, ANONYMOUS_USER_IDS, declaredDatabaseRls, REBASE_ADMIN_ROLE } from "@rebasepro/types";
import { REBASE_USER_ROLE } from "@rebasepro/common";
import type { AuthContext } from "./rls-enforcement";

/**
 * The escape hatches for the request role — every choice Rebase makes about
 * the roles, grants, policy targets and session settings that row-level
 * security runs on, as a setting.
 *
 * Each one defaults to what Rebase did before it existed, so a project that
 * sets nothing gets exactly that. The point is the other values: a database
 * someone already runs has its own roles, its own grants and sometimes its own
 * policies, and Rebase should fit them rather than demand a database of its
 * own. See docs/design/rebase-user-on-existing-databases.md.
 *
 * Set in code on the driver (`rls`), and — for the ones an operator may need to
 * change per deployment — from the environment, which wins, as it does for the
 * realtime settings. Function-valued settings are code only.
 */
export interface PostgresRlsConfig {
    /**
     * The role signed-in and anonymous requests run as. Default `"rebase_user"`.
     *
     * - A name: every request runs as it. Give each project on a shared cluster
     *   its own, because a role belongs to the whole cluster and any login that
     *   can switch into it passes this database's policies.
     * - `{ anonymous, signedIn }`: a caller with no session runs as one, anyone
     *   signed in (guests and `rebase.dataAsAdmin` included) as the other —
     *   the `anon` / `authenticated` split of Supabase and PostgREST.
     * - A function of the request's identity, for anything else. Declare every
     *   name it can return in {@link requestRoles}; a name outside that list
     *   fails the request.
     *
     * Env: `REBASE_RLS_REQUEST_ROLE` (a name).
     */
    requestRole?: string | RequestRoleMap | ((auth: AuthContext) => string);
    /**
     * Every role a function-valued {@link requestRole} can return, so they can
     * be provisioned, granted, recorded and checked. Derived for the other forms.
     */
    requestRoles?: readonly string[];
    /**
     * Whether Rebase creates the request role and the membership that lets the
     * connection switch into it. `"auto"` (default) does; `"never"` leaves both
     * to the operator — roles managed in Terraform, a DBA who creates every role
     * by hand — and only checks them, failing the boot with the SQL to run.
     *
     * Env: `REBASE_RLS_PROVISION_ROLE`.
     */
    provisionRole?: ProvisionRoleMode;
    /**
     * What Rebase grants the request role.
     *
     * - `"schema"` (default): every table and sequence in the schemas it serves
     *   that the connection may grant on, plus default privileges so tables
     *   created later are covered.
     * - `"managed"`: only the tables Rebase serves — collections, junctions, its
     *   own row-secured tables — and their sequences; no default privileges.
     *   For a schema shared with tables Rebase should not reach.
     * - `"none"`: nothing. Grants are yours; a table you have not granted is
     *   refused, never widened.
     *
     * Env: `REBASE_RLS_GRANTS`.
     */
    grants?: GrantsMode;
    /**
     * Whom permissive policies apply to. `"public"` (default) is every role
     * with a grant on the table. `"requestRole"` narrows them to the request
     * role(s), so another application's role reading the same table gets
     * nothing from Rebase's policies. Restrictive policies always apply to
     * everyone: they can only take access away.
     *
     * Env: `REBASE_RLS_POLICY_TARGET`.
     */
    policyTarget?: PolicyTargetMode;
    /**
     * Whom the policies that only the server context or an admin can pass apply
     * to — the injected `<table>_default_admin_*` baseline, and any permissive
     * rule whose every clause needs one of the two, such as `roles: ["admin"]`.
     *
     * - `"adminRole"` (default): `TO rebase_admin`, a role that holds nothing
     *   and cannot log in. Admin requests run as `<request role>_admin`, which
     *   inherits the request role and `rebase_admin`; a signed-in user's plan
     *   never sees those policies, so an owner-scoped list or count uses the
     *   owner index instead of scanning the table.
     * - `"public"`: `TO public`, every request as the request role — what
     *   Rebase did before. For a database where `rebase_admin` cannot be
     *   created, or a connection that is subject to RLS and cannot be granted it.
     *
     * Env: `REBASE_RLS_ADMIN_POLICIES`.
     */
    adminPolicies?: AdminPoliciesMode;
    /**
     * `false` drops the injected server-or-admin baseline from every
     * collection, as `disableDefaultPolicies` does for one. Default `true`.
     * A collection's own `disableDefaultPolicies` still decides for it.
     */
    defaultPolicies?: boolean;
    /**
     * Roles whose policies should apply to requests: each is granted to the
     * request role(s) `WITH INHERIT TRUE`, so a policy written `TO
     * authenticated` applies. PostgreSQL 16 and newer only — before 16 the only
     * way is to make the request role inherit from every role it belongs to,
     * which this refuses to do.
     */
    inheritRoles?: readonly string[];
    /**
     * The session settings a request carries its identity in, besides the
     * `app.*` settings Rebase's own policies read (always set).
     *
     * - `"rebase"` (default): nothing more.
     * - `"supabase"`: also `request.jwt.claims`, `request.jwt.claim.sub` and
     *   `request.jwt.claim.role`, so policies written with Supabase's
     *   `auth.uid()` / `auth.jwt()` see the caller.
     * - A function returning `[name, value]` pairs, for any other convention.
     *
     * Env: `REBASE_RLS_IDENTITY` (a named form).
     */
    identity?: IdentityMode | ((auth: AuthContext, role: string) => readonly (readonly [string, string])[]);
    /**
     * What to do when a login other than this connection can switch into the
     * request role — which lets it pass this database's policies as anyone.
     * `"warn"` (default), `"refuse"` to fail the boot, `"ignore"` for a role
     * shared on purpose.
     *
     * Env: `REBASE_RLS_SHARED_ROLE`.
     */
    sharedRole?: SharedRoleMode;
}

export interface RequestRoleMap {
    /** The role a caller with no session runs as. */
    anonymous: string;
    /** The role every signed-in caller runs as, guests included. */
    signedIn: string;
}

export type ProvisionRoleMode = "auto" | "never";
export type GrantsMode = "schema" | "managed" | "none";
export type PolicyTargetMode = "public" | "requestRole";
export type AdminPoliciesMode = "adminRole" | "public";
export type IdentityMode = "rebase" | "supabase";
export type SharedRoleMode = "warn" | "refuse" | "ignore";

/**
 * How one request runs: the role to switch to, and any session settings beyond
 * `app.*`. What the driver and the realtime refetch hand to `applyAuthContext`.
 */
export interface RequestIdentity {
    roleFor(auth: AuthContext): string;
    settingsFor(auth: AuthContext, role: string): readonly (readonly [string, string])[];
    /**
     * The role a request holding the `admin` role runs as instead of `role`
     * (`<role>_admin`, under `adminPolicies: "adminRole"`), or `undefined` to
     * run it as `role`. Set by the boot once those roles are known to exist and
     * be switchable — see `settleAdminRequestRoles`. The identity settings are
     * still `role`'s: the switch changes which policies apply, not who asks.
     */
    adminRoleFor?(role: string): string | undefined;
}

/** {@link PostgresRlsConfig}, resolved: every setting decided, every name checked. */
export interface RlsSettings {
    /** Every role a request can run as, the default first. */
    roles: readonly string[];
    /** The role a request runs as when the setting is a single name — the first of {@link roles} otherwise. */
    defaultRole: string;
    request: RequestIdentity;
    provisionRole: ProvisionRoleMode;
    grants: GrantsMode;
    policyTarget: PolicyTargetMode;
    adminPolicies: AdminPoliciesMode;
    /**
     * Under `adminPolicies: "adminRole"`, each request role an admin request can
     * arrive as, mapped to the role it switches to instead — every role but the
     * anonymous one of a `{ anonymous, signedIn }` pair. Empty under `"public"`.
     */
    adminRoles: ReadonlyMap<string, string>;
    defaultPolicies: boolean;
    inheritRoles: readonly string[];
    /**
     * The request roles {@link inheritRoles} are granted to: the one role, or
     * only the signed-in one of a `{ anonymous, signedIn }` pair — granting
     * `authenticated` to `anon` would hand every caller with no session the
     * signed-in policies.
     */
    inheritTo: readonly string[];
    sharedRole: SharedRoleMode;
    /** Every setting that is not at its default, as `name=value`, for the boot line. */
    nonDefaults: readonly string[];
}

/**
 * Postgres role names this module will interpolate. Unquoted identifiers only:
 * a role name reaches `GRANT`, `SET ROLE` and policy SQL, and one that needs
 * quoting is one somebody will eventually forget to quote.
 */
const ROLE_NAME = /^[a-z_][a-z0-9_$]*$/;

function checkRoleName(name: string, setting: string): string {
    if (!ROLE_NAME.test(name) || Buffer.byteLength(name) > 63) {
        throw new Error(
            `${setting}: ${JSON.stringify(name)} is not a usable role name. Use lower-case letters, digits, ` +
            "`_` and `$`, starting with a letter or `_`, at most 63 bytes."
        );
    }
    return name;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], setting: string): T | undefined {
    if (value === undefined) return undefined;
    if ((allowed as readonly string[]).includes(value)) return value as T;
    throw new Error(`${setting}: ${JSON.stringify(value)} is not one of ${allowed.map(a => `"${a}"`).join(", ")}.`);
}

const isAnonymousCaller = (auth: AuthContext): boolean =>
    typeof auth.uid !== "string" || auth.uid.trim() === "" || ANONYMOUS_USER_IDS.includes(auth.uid);

/**
 * Supabase's request settings, as PostgREST sets them: `auth.uid()` reads
 * `request.jwt.claim.sub` (or `request.jwt.claims ->> 'sub'`), `auth.role()` the
 * role claim, `auth.jwt()` the claims. A caller with no session has no subject,
 * so `auth.uid()` is NULL for it, as it is for Supabase's `anon`.
 */
function supabaseSettings(auth: AuthContext, role: string): [string, string][] {
    const sub = isAnonymousCaller(auth) ? "" : auth.uid;
    const claims = {
        ...(auth.claims ?? {}),
        sub: sub || undefined,
        role,
        is_anonymous: auth.isAnonymous === true
    };
    return [
        ["request.jwt.claims", JSON.stringify(claims)],
        ["request.jwt.claim.sub", sub],
        ["request.jwt.claim.role", role]
    ];
}

/**
 * The driver's `rls` block with the environment applied over it — what
 * `postgresDriverConfigFromEnv` does for every other setting. A variable that
 * is set wins over the code; the rest of the block is kept as written.
 */
export function rlsConfigFromEnv(
    config: PostgresRlsConfig | undefined,
    read: (name: string) => string | undefined
): PostgresRlsConfig | undefined {
    const fromEnv: PostgresRlsConfig = {};
    const requestRole = read("REBASE_RLS_REQUEST_ROLE");
    if (requestRole) fromEnv.requestRole = requestRole;
    const provisionRole = read("REBASE_RLS_PROVISION_ROLE");
    if (provisionRole) fromEnv.provisionRole = oneOf(provisionRole, ["auto", "never"] as const, "REBASE_RLS_PROVISION_ROLE");
    const grants = read("REBASE_RLS_GRANTS");
    if (grants) fromEnv.grants = oneOf(grants, ["schema", "managed", "none"] as const, "REBASE_RLS_GRANTS");
    const policyTarget = read("REBASE_RLS_POLICY_TARGET");
    if (policyTarget) fromEnv.policyTarget = oneOf(policyTarget, ["public", "requestRole"] as const, "REBASE_RLS_POLICY_TARGET");
    const adminPolicies = read("REBASE_RLS_ADMIN_POLICIES");
    if (adminPolicies) fromEnv.adminPolicies = oneOf(adminPolicies, ["adminRole", "public"] as const, "REBASE_RLS_ADMIN_POLICIES");
    const identity = read("REBASE_RLS_IDENTITY");
    if (identity) fromEnv.identity = oneOf(identity, ["rebase", "supabase"] as const, "REBASE_RLS_IDENTITY");
    const defaultPolicies = read("REBASE_RLS_DEFAULT_POLICIES");
    if (defaultPolicies) fromEnv.defaultPolicies = oneOf(defaultPolicies.toLowerCase(), ["true", "false"] as const, "REBASE_RLS_DEFAULT_POLICIES") === "true";
    const sharedRole = read("REBASE_RLS_SHARED_ROLE");
    if (sharedRole) fromEnv.sharedRole = oneOf(sharedRole, ["warn", "refuse", "ignore"] as const, "REBASE_RLS_SHARED_ROLE");
    if (Object.keys(fromEnv).length === 0) return config;
    const merged = { ...config, ...fromEnv };
    // Checked now, so a mistyped variable fails the boot here.
    resolveRlsSettings(merged);
    return merged;
}

/**
 * Decide every setting from the driver's `rls` block (environment already
 * applied — {@link rlsConfigFromEnv}). Throws on a value it cannot use: a
 * mistyped mode or an unusable role name fails the boot, not the first request.
 */
export function resolveRlsSettings(config: PostgresRlsConfig | undefined): RlsSettings {
    const nonDefaults: string[] = [];
    const requestRole = config?.requestRole;

    let roles: string[];
    let roleFor: (auth: AuthContext) => string;
    let inheritTo: string[];
    /** The request roles an admin request can arrive as. */
    let adminFrom: string[];
    if (requestRole === undefined) {
        roles = [REBASE_USER_ROLE];
        roleFor = () => REBASE_USER_ROLE;
        inheritTo = roles;
        adminFrom = roles;
    } else if (typeof requestRole === "string") {
        const name = checkRoleName(requestRole, "rls.requestRole (REBASE_RLS_REQUEST_ROLE)");
        roles = [name];
        roleFor = () => name;
        inheritTo = roles;
        adminFrom = roles;
        if (name !== REBASE_USER_ROLE) nonDefaults.push(`requestRole=${name}`);
    } else if (typeof requestRole === "function") {
        const declared = (config?.requestRoles ?? []).map(r => checkRoleName(r, "rls.requestRoles"));
        if (declared.length === 0) {
            throw new Error(
                "rls.requestRole is a function, so rls.requestRoles must list every role it can return: they are " +
                "provisioned, granted and checked before any request runs."
            );
        }
        roles = Array.from(new Set(declared));
        // Any of them: which one an admin request gets is the function's call.
        adminFrom = roles;
        // Which of a function's roles should take on other roles' policies is
        // the function's business, not something to guess: all of them could
        // include an anonymous one.
        inheritTo = [];
        if (config?.inheritRoles?.length) {
            throw new Error(
                "rls.inheritRoles cannot be combined with a function-valued rls.requestRole: Rebase cannot tell which " +
                "of its roles are signed in. Grant the memberships yourself (GRANT <role> TO <request role> WITH INHERIT TRUE)."
            );
        }
        const allowed = new Set(roles);
        roleFor = (auth) => {
            const role = requestRole(auth);
            // Fails the request, closed: a role nobody provisioned or checked is
            // not one to run a user's statements as.
            if (!allowed.has(role)) {
                throw new Error(
                    `rls.requestRole returned ${JSON.stringify(role)}, which is not in rls.requestRoles ` +
                    `(${roles.join(", ")}). The request is refused.`
                );
            }
            return role;
        };
        nonDefaults.push(`requestRole=(function: ${roles.join(", ")})`);
    } else {
        const anonymous = checkRoleName(requestRole.anonymous, "rls.requestRole.anonymous");
        const signedIn = checkRoleName(requestRole.signedIn, "rls.requestRole.signedIn");
        roles = Array.from(new Set([signedIn, anonymous]));
        roleFor = (auth) => isAnonymousCaller(auth) ? anonymous : signedIn;
        inheritTo = [signedIn];
        adminFrom = [signedIn];
        nonDefaults.push(`requestRole={anonymous: ${anonymous}, signedIn: ${signedIn}}`);
    }

    const provisionRole = oneOf(config?.provisionRole, ["auto", "never"] as const, "rls.provisionRole") ?? "auto";
    const grants = oneOf(config?.grants, ["schema", "managed", "none"] as const, "rls.grants") ?? "schema";
    const policyTarget = oneOf(config?.policyTarget, ["public", "requestRole"] as const, "rls.policyTarget") ?? "public";
    const adminPolicies = oneOf(config?.adminPolicies, ["adminRole", "public"] as const, "rls.adminPolicies") ?? "adminRole";
    const adminRoles = new Map<string, string>();
    if (adminPolicies === "adminRole") {
        for (const role of adminFrom) {
            // The derived name reaches GRANT and SET ROLE like the role's own.
            const admin = checkRoleName(
                adminRequestRoleFor(role),
                `rls.adminPolicies "adminRole": the admin role for "${role}" (use a request role of at most 57 bytes, or adminPolicies "public")`
            );
            if (roles.includes(admin) || admin === REBASE_ADMIN_ROLE) {
                throw new Error(
                    `rls.adminPolicies "adminRole": admin requests for "${role}" would run as "${admin}", which is ` +
                    `${admin === REBASE_ADMIN_ROLE ? "the role the admin policies are written TO" : "also a request role"}. Rename the request role.`
                );
            }
            adminRoles.set(role, admin);
        }
    }
    const sharedRole = oneOf(config?.sharedRole, ["warn", "refuse", "ignore"] as const, "rls.sharedRole") ?? "warn";
    const defaultPolicies = config?.defaultPolicies ?? true;
    const inheritRoles = Array.from(new Set((config?.inheritRoles ?? []).map(r => checkRoleName(r, "rls.inheritRoles"))));

    const identity = config?.identity ?? "rebase";
    let settingsFor: RequestIdentity["settingsFor"];
    if (typeof identity === "function") {
        settingsFor = identity;
        nonDefaults.push("identity=(function)");
    } else {
        oneOf(identity, ["rebase", "supabase"] as const, "rls.identity");
        settingsFor = identity === "supabase" ? supabaseSettings : () => [];
        if (identity !== "rebase") nonDefaults.push(`identity=${identity}`);
    }

    if (provisionRole !== "auto") nonDefaults.push(`provisionRole=${provisionRole}`);
    if (grants !== "schema") nonDefaults.push(`grants=${grants}`);
    if (policyTarget !== "public") nonDefaults.push(`policyTarget=${policyTarget}`);
    if (adminPolicies !== "adminRole") nonDefaults.push(`adminPolicies=${adminPolicies}`);
    if (!defaultPolicies) nonDefaults.push("defaultPolicies=false");
    if (inheritRoles.length > 0) nonDefaults.push(`inheritRoles=${inheritRoles.join(",")}`);
    if (sharedRole !== "warn") nonDefaults.push(`sharedRole=${sharedRole}`);

    return {
        roles,
        defaultRole: roles[0],
        request: { roleFor, settingsFor },
        provisionRole,
        grants,
        policyTarget,
        adminPolicies,
        adminRoles,
        defaultPolicies,
        inheritRoles,
        inheritTo,
        sharedRole,
        nonDefaults
    };
}

/**
 * What each non-default setting hands to the operator, said once at boot. A
 * hatch that takes a safety job away from Rebase says which job it took.
 */
export function rlsHandoverNotes(settings: RlsSettings): string[] {
    const notes: string[] = [];
    if (settings.provisionRole === "never") {
        notes.push(`provisionRole=never: Rebase does not create ${settings.roles.join(", ")} or the membership to switch into ${settings.roles.length === 1 ? "it" : "them"}; boot checks both.`);
    }
    if (settings.grants === "none") {
        notes.push("grants=none: Rebase grants the request role nothing and revokes nothing; a table you have not granted is refused.");
    }
    if (settings.grants === "managed") {
        notes.push("grants=managed: tables Rebase does not serve get no grant and no default privilege; tables you create by hand need an explicit GRANT.");
    }
    if (settings.sharedRole === "ignore") {
        notes.push("sharedRole=ignore: other logins that can switch into the request role are not reported.");
    }
    if (!settings.defaultPolicies) {
        notes.push("defaultPolicies=false: no collection gets the server-or-admin baseline; each collection's own rules are its whole policy.");
    }
    return notes;
}

/**
 * The request settings for a command that runs outside the server — `db push`,
 * `db migrate`, a restore — which sees the database declaration and the
 * environment but not the backend's code. The roles are the environment's or
 * the declaration's when either names them; otherwise the ones a server boot
 * recorded in this database (which covers a role configured in code);
 * otherwise the default.
 */
export function cliRlsSettings(
    recordedRoles: readonly string[] | undefined,
    env: NodeJS.ProcessEnv = process.env
): RlsSettings {
    const read = (name: string): string | undefined => env[name]?.trim() || undefined;
    const declared = declaredDatabaseRls();
    const settings = resolveRlsSettings(rlsConfigFromEnv(declared, read));
    if (read("REBASE_RLS_REQUEST_ROLE") || declared.requestRole !== undefined || !recordedRoles?.length) return settings;
    const roles = recordedRoles.map((r) => checkRoleName(r, "rebase.schema_meta request_roles"));
    // Which recorded role is an anonymous one is not recorded, so each gets
    // its admin counterpart: a superset of what the boot provisions.
    const adminRoles = settings.adminPolicies === "adminRole"
        ? new Map(roles.map((r) => [r, adminRequestRoleFor(r)] as const))
        : settings.adminRoles;
    return { ...settings, roles, defaultRole: roles[0], adminRoles };
}
