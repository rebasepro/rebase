/**
 * Who may plan a schema change, and who may apply one.
 *
 * Being an admin is one privilege. Applying a schema change is two: it alters
 * the database, and it writes a commit into the project's repository under
 * somebody's name. `requireAdmin` in front of both routes answers the first
 * question and never asks the second.
 *
 * `admin-roles.ts` says the rest of it: `schema-admin` is administrative
 * "by any definition that matters", and "if a genuinely lesser role is added
 * later, it does not belong in this list — it belongs in a capability check of
 * its own". This is that check.
 *
 * ## The split that matters is not between roles
 *
 * It is between a person and a machine.
 *
 * `plan` has no side effects. It reads the collections, reads the database
 * catalogue, and answers what would happen. Anyone already through the admin
 * gate may do it, and a CI job that wants to know whether a proposed collection
 * change is applicable is a *good* use of this API.
 *
 * `apply` commits. The commit carries an author, and the author is the point —
 * the code that builds it says so: a schema change with an author and a diff in
 * the project's history is the thing worth having, and an anonymous one is just
 * a commit. A service key has no author. `api-key:7c3f…` has no author. Letting
 * either write to the project's source produces exactly the unattributable
 * history the feature exists to replace, and does it with a credential that is
 * likely to be sitting in a CI environment variable.
 *
 * So machines plan by default and do not apply. An operator who genuinely wants
 * an automated schema change — a migration pipeline, say — turns it on
 * deliberately and gets a commit that says plainly which key made it.
 */

/** What a caller is allowed to do with the live schema editor. */
export interface SchemaEditCapabilities {
    /** Preview a change. No side effects. */
    plan: boolean;
    /** Commit the change and run the DDL. */
    apply: boolean;
    /**
     * Why `apply` is denied, when it is and `plan` is not.
     *
     * Carried so the panel can grey out the button *and say why*, rather than
     * letting somebody read a plan, decide, press, and only then be refused.
     */
    reason?: string;
    /** A stable code for the refusal, for clients that branch rather than read. */
    code?: string;
}

/** The kind of caller, which is what the `apply` decision turns on. */
export type PrincipalKind = "person" | "machine" | "anonymous";

export interface SchemaEditPrincipal {
    kind: PrincipalKind;
    /** Empty for an anonymous caller. */
    uid: string;
    roles: string[];
    /** How the machine identified itself, for the refusal message. */
    machineKind?: "service-key" | "api-key";
}

/**
 * A caller whose identity is a credential rather than a person.
 *
 * Two shapes, both set by the auth middleware:
 *
 * - the service key resolves to `uid: "service"` with `roles: ["admin"]`;
 * - an API key resolves to `uid: "api-key:<id>"`, with `service` among its
 *   roles and `admin` too when the key is an admin key.
 *
 * Detected by uid rather than by role, because `service` is also a role a
 * person could be granted, and a person with an unfortunate role name should
 * not lose the ability to commit under their own name.
 */
function machineKindOf(uid: string): SchemaEditPrincipal["machineKind"] | undefined {
    if (uid === "service") return "service-key";
    if (uid.startsWith("api-key:")) return "api-key";
    return undefined;
}

/** Read the caller off the request context's `user`. */
export function classifyPrincipal(user: unknown): SchemaEditPrincipal {
    if (!user || typeof user !== "object") {
        return { kind: "anonymous", uid: "", roles: [] };
    }
    const { uid, roles } = user as { uid?: unknown; roles?: unknown };
    if (typeof uid !== "string" || uid.length === 0) {
        return { kind: "anonymous", uid: "", roles: [] };
    }
    const roleList = Array.isArray(roles) ? roles.filter((r): r is string => typeof r === "string") : [];
    const machineKind = machineKindOf(uid);
    return {
        kind: machineKind ? "machine" : "person",
        uid,
        roles: roleList,
        machineKind
    };
}

/**
 * A repository that is not on this machine.
 *
 * Configured by a deployment running built output — every Cloud tenant, and any
 * self-host serving a bundle. Without it, live schema editing needs the source
 * on disk and refuses when there is none.
 */
export interface RemoteRepositoryConfig {
    kind: "github";
    owner: string;
    repo: string;
    /** Defaults to `main`. */
    branch?: string;
    /**
     * Where the collection **source** lives in that repository, repo-relative.
     * Defaults to `config/collections`.
     *
     * Not derivable from the running bundle, whose collections directory holds
     * compiled output — a different directory with different files.
     */
    collectionsPath?: string;
    /**
     * A GitHub App installation, or a token.
     *
     * The app is for a control plane holding one key across many projects; the
     * token is for a single self-hoster who would otherwise have to stand one
     * up to let their own server commit to their own repository.
     */
    auth:
        | { kind: "app"; appId: string; privateKey: string; installationId: string }
        | { kind: "token"; token: string };
}

export interface SchemaEditPolicy {
    /**
     * Let a service key or an API key commit a schema change.
     *
     * Off by default. On, the commit is attributed to the credential rather
     * than to a person, and says so — see {@link machineCommitAuthor}.
     */
    allowMachineApply?: boolean;
}

const MACHINE_REFUSAL: Record<NonNullable<SchemaEditPrincipal["machineKind"]>, string> = {
    "service-key": "This request is authenticated with the server's service key, which identifies " +
        "the server rather than a person. Applying a schema change writes a commit to your " +
        "repository, and that commit needs an author.",
    "api-key": "This request is authenticated with an API key, which identifies a credential " +
        "rather than a person. Applying a schema change writes a commit to your repository, and " +
        "that commit needs an author."
};

/**
 * What this caller may do.
 *
 * Assumes the admin gate has already run — this refines that decision rather
 * than replacing it, and an anonymous caller should never have reached here.
 * Handled anyway, because a capability function that trusts its caller to have
 * checked is one bad refactor away from granting everything.
 */
export function schemaEditCapabilities(
    principal: SchemaEditPrincipal,
    policy: SchemaEditPolicy = {}
): SchemaEditCapabilities {
    if (principal.kind === "anonymous") {
        return {
            plan: false,
            apply: false,
            code: "UNAUTHORIZED",
            reason: "This request carries no identity."
        };
    }

    if (principal.kind === "machine" && !policy.allowMachineApply) {
        return {
            plan: true,
            apply: false,
            code: "SCHEMA_EDIT_REQUIRES_A_PERSON",
            reason: `${MACHINE_REFUSAL[principal.machineKind ?? "api-key"]} ` +
                "Sign in as a user to apply it, or set `liveSchema.allowMachineApply` if an " +
                "automated schema change is what you want."
        };
    }

    return { plan: true, apply: true };
}

/**
 * The git identity for a machine that has been allowed to apply.
 *
 * Named for what it is. An operator reading `git log` a month from now should
 * be able to tell a change somebody made from one a pipeline made, and a
 * credential wearing a person-shaped name is how that distinction is lost.
 */
export function machineCommitAuthor(
    principal: SchemaEditPrincipal
): { name: string; email: string } {
    const label = principal.machineKind === "service-key"
        ? "Rebase service key"
        : `Rebase API key (${principal.uid.replace(/^api-key:/, "")})`;
    return {
        name: label,
        // `noreply` because it is not an address and nothing should write to it.
        email: `${principal.uid.replace(/[^A-Za-z0-9._-]/g, "-")}@machines.noreply.rebase.pro`
    };
}
