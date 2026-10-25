/**
 * `rebase cloud tokens` — API tokens for CI and agents.
 *
 * A token is a personal API key on the control plane (`/api/auth/keys`): it
 * acts as the account that created it, holds only the scopes it was minted
 * with, and never more than that account can do at the moment it is used. With
 * `REBASE_TOKEN` set, every `rebase cloud` command authenticates with it
 * instead of the `cloud login` session — see `requireClient`.
 *
 * What a token may do is asked for as capabilities (`--can deploy,logs`) on one
 * project, and turned into scopes by `token-capabilities.ts`, the map the
 * console reads too. Three capabilities act on one organization instead —
 * `billing`, `audit`, `notifications` — and are given only when `--can` names
 * them: on `--org`, else the project's organization, else the selected one.
 *
 * Managing tokens takes the signed-in session, never a token: the control
 * plane refuses every key on these routes, because a key that could mint keys
 * could mint its own successor.
 */
import chalk from "chalk";
import type arg from "arg";
import type { ApiKeyMasked, ApiKeyWithSecret } from "@rebasepro/types";
import {
    ALWAYS_SCOPES,
    capabilitiesInScopes,
    isOrgCapability,
    isTokenCapability,
    ORG_CAPABILITY_NAMES,
    orgCapabilitiesInScopes,
    scopesForCapabilities,
    scopesForOrgCapabilities,
    TOKEN_CAPABILITY_NAMES,
    type OrgCapability,
    type TokenCapability
} from "./token-capabilities";
import {
    confirmDestructive,
    displayProjectRef,
    emit,
    fail,
    getContextOrg,
    keyValues,
    parseCloudArgs,
    reportError,
    requireKnownAction,
    requireProject,
    requireSessionClient,
    success,
    TOKEN_ENV,
    type CloudClient
} from "./context";

/** Every action the group dispatches. */
export const TOKENS_ACTIONS = ["list", "create", "revoke"] as const;

/** What `rebase cloud tokens create` parses, beside the global flags (`--project` among them). */
export const CREATE_TOKEN_FLAGS = {
    "--can": [String],
    "--name": String,
    "--expires-in": String,
    "--org": String
} satisfies arg.Spec;

export async function tokensCommand(action: string | undefined, rawArgs: string[]): Promise<void> {
    requireKnownAction("tokens", action, TOKENS_ACTIONS);
    switch (action ?? "list") {
        case "create":
            await createToken(rawArgs);
            break;
        case "revoke":
            await revokeToken(rawArgs);
            break;
        default:
            await listTokens(rawArgs);
    }
}

/* ─── create ───────────────────────────────────────────────────── */

const DAY_MS = 86_400_000;

/** Every word `--can` takes, project capabilities first. */
const CAN_WORDS = [...TOKEN_CAPABILITY_NAMES, ...ORG_CAPABILITY_NAMES].join(", ");

/** What `--can` names: capabilities on one project, and on one organization. */
export interface RequestedCapabilities {
    project: TokenCapability[];
    org: OrgCapability[];
}

/**
 * The capabilities `--can` names, comma-separated or repeated, each once —
 * split into the project's and the organization's.
 *
 * Exported so its tests can drive it without a session.
 */
export function parseCapabilities(values: readonly string[] | undefined): RequestedCapabilities {
    const words = [...new Set((values ?? []).flatMap(value => value.split(/[\s,]+/)).filter(Boolean))];
    if (words.length === 0) {
        fail(
            "Say what the token may do: --can deploy,logs.",
            `Capabilities: ${CAN_WORDS}.`,
            "usage"
        );
    }
    const unknown = words.filter(word => !isTokenCapability(word) && !isOrgCapability(word));
    if (unknown.length > 0) {
        fail(
            `--can takes capabilities, and ${unknown.map(word => `"${word}"`).join(", ")} is not one.`,
            `Capabilities: ${CAN_WORDS}.`,
            "usage"
        );
    }
    return { project: words.filter(isTokenCapability), org: words.filter(isOrgCapability) };
}

/** The organization a project belongs to, or undefined when its row does not say. */
async function projectOrganization(client: CloudClient, projectId: string): Promise<string | undefined> {
    try {
        const row = (await client.data.collection("projects").findById(projectId)) as Record<string, unknown> | undefined;
        const raw = row?.organization ?? row?.organizationId ?? row?.organization_id;
        if (raw && typeof raw === "object" && "id" in raw) return String((raw as { id: unknown }).id);
        return raw == null || raw === "" ? undefined : String(raw);
    } catch {
        return undefined;
    }
}

/**
 * `--expires-in <days>` as an ISO timestamp, or null for a token that does not
 * expire.
 *
 * Exported so its tests can drive it without a session.
 */
export function resolveTokenExpiry(value: string | undefined, now: Date = new Date()): string | null {
    if (value === undefined) return null;
    const days = /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
    if (!Number.isSafeInteger(days) || days < 1) {
        fail(`--expires-in takes a whole number of days, e.g. --expires-in 90 (got "${value}").`, undefined, "usage");
    }
    return new Date(now.getTime() + days * DAY_MS).toISOString();
}

async function createToken(rawArgs: string[]): Promise<void> {
    const { flags } = parseCloudArgs({
        spec: CREATE_TOKEN_FLAGS,
        rawArgs,
        commandWords: 3, // cloud tokens create
        command: "cloud tokens create",
        maxPositionals: 0
    });
    // Both refused before the session is asked for: an unusable line is
    // unusable whoever is signed in.
    const { project: capabilities, org: orgCapabilities } = parseCapabilities(flags["--can"]);
    const expiresAt = resolveTokenExpiry(flags["--expires-in"]);

    const { client, url } = await requireSessionClient(rawArgs);
    // A project only when a project capability asks for one: a token for an
    // organization's billing alone needs none.
    const projectId = capabilities.length > 0 ? await requireProject(rawArgs, client) : undefined;
    const projectRef = projectId ? displayProjectRef(rawArgs) || projectId : undefined;
    // The organization: --org, else the project's own, else the selected one.
    let organizationId: string | undefined;
    if (orgCapabilities.length > 0) {
        organizationId = flags["--org"]?.trim()
            || (projectId ? await projectOrganization(client, projectId) : undefined)
            || getContextOrg(url);
        if (!organizationId) {
            fail(
                `Say which organization ${orgCapabilities.join(", ")} ${orgCapabilities.length === 1 ? "is" : "are"} for.`,
                "Pass --org <id>, or select one with `rebase cloud use`.",
                "no_org"
            );
        }
    }
    const reach = projectRef ?? `org ${organizationId}`;
    const name = flags["--name"]?.trim() || `${reach} ${[...capabilities, ...orgCapabilities].join("+")}`;
    const scopes = [...new Set([
        ...(projectId ? scopesForCapabilities(projectId, capabilities) : ALWAYS_SCOPES),
        ...(organizationId ? scopesForOrgCapabilities(organizationId, orgCapabilities) : [])
    ])];

    let created: ApiKeyWithSecret;
    try {
        ({ key: created } = await client.personalKeys.createKey({ name, scopes, expires_at: expiresAt }));
    } catch (e) {
        reportError(e, "Failed to create the token");
    }

    success(`Token created: ${chalk.bold(created.name)}`);
    emit(
        () => {
            keyValues([
                ["ID", created.id],
                ["Project", !projectId ? undefined : projectRef === projectId ? projectId : `${projectRef} (${projectId})`],
                ["Organization", organizationId],
                ["Can", [...capabilities, ...orgCapabilities].join(", ")],
                ["Expires", created.expires_at ? new Date(created.expires_at).toLocaleDateString() : "never"]
            ]);
            console.log("");
            console.log(chalk.bold.yellow("  ⚠ Copy it now — it is not shown again:"));
            console.log("");
            console.log(`    export ${TOKEN_ENV}=${chalk.cyan(created.key)}`);
            console.log("");
            console.log(chalk.gray(`  With ${TOKEN_ENV} set, every \`rebase cloud\` command uses the token instead of your login.`));
            console.log(chalk.gray("  In CI, store it as a secret and expose it under that name."));
            console.log("");
        },
        {
            success: true,
            id: created.id,
            name: created.name,
            token: created.key,
            env: TOKEN_ENV,
            projectId: projectId ?? null,
            capabilities,
            organizationId: organizationId ?? null,
            orgCapabilities,
            scopes: created.scopes,
            expiresAt: created.expires_at
        }
    );
}

/* ─── list ─────────────────────────────────────────────────────── */

function tokenStatus(key: ApiKeyMasked, now: Date): "revoked" | "expired" | "active" {
    if (key.revoked_at) return "revoked";
    if (key.expires_at && new Date(key.expires_at) < now) return "expired";
    return "active";
}

/**
 * What a token was created for, read back from its scopes:
 * `deploy, logs on proj_1; billing on organization org_1`. Undefined when no
 * capability explains them.
 *
 * Exported for `whoami`, which reads a token back the same way.
 */
export function describeGrants(scopes: readonly string[]): string | undefined {
    const parts = [
        ...capabilitiesInScopes(scopes)
            .filter(grant => grant.capabilities.length > 0)
            .map(grant => `${grant.capabilities.join(", ")} on ${grant.projectId}`),
        ...orgCapabilitiesInScopes(scopes)
            .filter(grant => grant.capabilities.length > 0)
            .map(grant => `${grant.capabilities.join(", ")} on organization ${grant.organizationId}`)
    ];
    return parts.length > 0 ? parts.join("; ") : undefined;
}

function describeGrant(scopes: readonly string[]): string {
    return describeGrants(scopes) ?? `${scopes.length} scope${scopes.length === 1 ? "" : "s"}`;
}

async function listTokens(rawArgs: string[]): Promise<void> {
    parseCloudArgs({ spec: {}, rawArgs, commandWords: 3, command: "cloud tokens list", maxPositionals: 0 });
    const { client } = await requireSessionClient(rawArgs);

    let keys: ApiKeyMasked[];
    try {
        ({ keys } = await client.personalKeys.listKeys());
    } catch (e) {
        reportError(e, "Failed to list tokens");
    }

    const now = new Date();
    emit(
        () => {
            console.log("");
            console.log(chalk.bold("  🔑 Tokens"));
            console.log("");
            if (keys.length === 0) {
                console.log(chalk.gray("  None yet. Create one with `rebase cloud tokens create --can deploy`."));
                console.log("");
                return;
            }
            for (const key of keys) {
                const status = tokenStatus(key, now);
                const colored = status === "active" ? chalk.green(status) : status === "expired" ? chalk.yellow(status) : chalk.red(status);
                console.log(`  ${chalk.bold(key.name)} ${chalk.gray(`[${key.key_prefix}•••]`)} ${colored}`);
                keyValues([
                    ["ID", key.id],
                    ["Can", describeGrant(key.scopes)],
                    ["Expires", key.expires_at ? new Date(key.expires_at).toLocaleDateString() : "never"],
                    ["Last used", key.last_used_at ? new Date(key.last_used_at).toLocaleString() : "never"]
                ]);
                console.log("");
            }
        },
        {
            tokens: keys.map(key => ({
                id: key.id,
                name: key.name,
                prefix: key.key_prefix,
                status: tokenStatus(key, now),
                grants: capabilitiesInScopes(key.scopes),
                orgGrants: orgCapabilitiesInScopes(key.scopes),
                scopes: key.scopes,
                expiresAt: key.expires_at,
                lastUsedAt: key.last_used_at,
                createdAt: key.created_at
            }))
        }
    );
}

/* ─── revoke ───────────────────────────────────────────────────── */

async function revokeToken(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parseCloudArgs({
        spec: {},
        rawArgs,
        commandWords: 3, // cloud tokens revoke
        command: "cloud tokens revoke",
        maxPositionals: 1
    });
    const id = positionals[0];
    if (!id) fail("Usage: rebase cloud tokens revoke <id>", "`rebase cloud tokens list` shows the ids.", "usage");

    const { client } = await requireSessionClient(rawArgs);
    await confirmDestructive({
        yes: Boolean(flags["--yes"]),
        prompt: `Revoke token ${id}? Anything using it stops working.`
    });

    try {
        await client.personalKeys.revokeKey(id);
    } catch (e) {
        reportError(e, "Failed to revoke the token");
    }

    success(`Token ${chalk.bold(id)} revoked`);
    emit(() => {}, { success: true, id });
}
