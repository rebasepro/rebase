/**
 * The RLS simulator's admin surface, under `/api/admin/rls-simulator`.
 *
 * The data API answers one collection at a time for a simulated identity
 * (`auth/simulation.ts`). This answers the questions the admin panel's
 * "Simulate access" bar asks about all of them at once:
 *
 * - `GET /options` — what can be simulated: the roles the project names (the
 *   access model's, the ones its row and field rules mention, and `anon`) and
 *   the API keys that are live.
 * - `POST /preview` — for `{ role?, userId?, apiKeyId? }`, each collection's
 *   rows as that identity sees them against the caller's own view, whether a
 *   key's scopes shut it out, and which fields its roles cannot read.
 *
 * The same decision as the data API: only an administrator's own session, a
 * 403 for anyone else.
 *
 * @module
 */

import { Hono, type Context } from "hono";
import {
    scopeGrants,
    summarizeRoles,
    type AccessSimulation,
    type CollectionConfig,
    type DataDriver,
    type Property
} from "@rebasepro/types";
import type { HonoEnv } from "../api/types";
import { ApiError, errorHandler } from "../api/errors";
import { scopeDataDriver } from "./rls-scope";
import { accessOf } from "./access";
import type { ApiKeyStore } from "./api-keys/api-key-store";
import type { ImpersonationCredential, ImpersonationUserResolver } from "./impersonation";
import { callerOf, decideSimulation, maskedFieldsFor } from "./simulation";

export interface RlsSimulatorRouteConfig {
    /** The collections this backend serves, as they are now. */
    collections(): readonly CollectionConfig[];
    /** The unscoped driver a collection's rows live in. */
    driverFor(slug: string): DataDriver;
    resolveUser?: ImpersonationUserResolver;
    apiKeyStore?: ApiKeyStore;
}

/** One collection, as the simulated identity reaches it. */
export interface SimulatedCollectionView {
    slug: string;
    name: string;
    /**
     * Why the identity sees nothing here: its key's scopes, row policies
     * hiding every row, or a read that fails for it (`error` says why).
     */
    hiddenBy?: "scope" | "rls" | "error";
    /** Rows the simulated identity reads. Absent when not counted. */
    visibleRows?: number;
    /** Rows the administrator asking reads. */
    totalRows?: number;
    /** Fields the identity's roles cannot read. */
    maskedColumns: string[];
    /** Why the rows could not be counted. */
    error?: string;
}

/** How the caller authenticated, read off what the admin gate left on the context. */
function credentialOf(c: Context<HonoEnv>): ImpersonationCredential {
    const caller = callerOf(c);
    if (!caller) return "none";
    if (c.get("apiKey") || c.get("scopes") !== undefined) return "api-key";
    if (caller.uid === "service") return "service-key";
    return "session";
}

function readSimulation(body: unknown): AccessSimulation {
    if (typeof body !== "object" || body === null) {
        throw ApiError.badRequest("Send { role?, userId?, apiKeyId? } naming what to simulate.", "SIMULATION_INVALID");
    }
    const field = (name: string): string | undefined => {
        if (!(name in body)) return undefined;
        const value: unknown = Reflect.get(body, name);
        if (value === undefined || value === null) return undefined;
        if (typeof value !== "string") throw ApiError.badRequest(`${name} must be a string.`, "SIMULATION_INVALID");
        return value;
    };
    const role = field("role");
    const userId = field("userId");
    const apiKeyId = field("apiKeyId");
    if (role === undefined && userId === undefined && apiKeyId === undefined) {
        throw ApiError.badRequest("Name a role, a user id or an API key id to simulate.", "SIMULATION_INVALID");
    }
    return {
        ...(role !== undefined ? { role } : {}),
        ...(userId !== undefined ? { userId } : {}),
        ...(apiKeyId !== undefined ? { apiKeyId } : {})
    };
}

/** Every role the project's rules name, beyond the access model's own. */
function rolesNamedByRules(collections: readonly CollectionConfig[]): string[] {
    const named = new Set<string>();
    for (const collection of collections) {
        for (const rule of collection.securityRules ?? []) {
            for (const role of rule.roles ?? []) named.add(role);
        }
        for (const property of Object.values(collection.properties ?? {})) {
            const access = (property as Property).access;
            for (const role of [...(access?.read ?? []), ...(access?.write ?? [])]) named.add(role);
        }
    }
    return [...named];
}

async function countRows(driver: DataDriver, collection: CollectionConfig): Promise<number> {
    if (driver.count) return driver.count({ path: collection.slug, collection });
    return (await driver.fetchCollection({ path: collection.slug, collection })).length;
}

export function createRlsSimulatorRoutes(config: RlsSimulatorRouteConfig): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    router.onError(errorHandler);

    /** The caller, refused unless an administrator's own session. */
    const decide = async (c: Context<HonoEnv>, simulation: AccessSimulation) => {
        const decision = await decideSimulation({
            simulation,
            credential: credentialOf(c),
            caller: callerOf(c),
            resolveUser: config.resolveUser,
            apiKeyStore: config.apiKeyStore,
            access: accessOf(c),
            audit: { door: "rls-simulator", method: c.req.method, path: c.req.path, requestId: c.get("requestId") }
        });
        if ("refused" in decision) throw decision.refused;
        return decision;
    };

    router.get("/options", async (c) => {
        // The same gate as a preview, with a role that is always there.
        await decide(c, { role: "anon" });
        const declared = summarizeRoles(accessOf(c).model).map(role => ({ id: role.id, name: role.name }));
        const seen = new Set(declared.map(role => role.id));
        const roles = [
            { id: "anon", name: "anon" },
            ...declared,
            ...rolesNamedByRules(config.collections())
                .filter(role => !seen.has(role) && role !== "anon")
                .map(role => ({ id: role, name: role }))
        ];
        const now = Date.now();
        const apiKeys = config.apiKeyStore
            ? (await config.apiKeyStore.listApiKeys({ kind: "service" }))
                .filter(key => !key.revoked_at && !(key.expires_at && new Date(key.expires_at).getTime() < now))
                .map(key => ({ id: key.id, name: key.name, keyPrefix: key.key_prefix, roles: key.roles, scopes: key.scopes }))
            : [];
        return c.json({ roles, apiKeys });
    });

    router.post("/preview", async (c) => {
        const simulation = readSimulation(await c.req.json().catch(() => undefined));
        const { granted: identity, simulator } = await decide(c, simulation);
        const callerIdentity = { uid: simulator, roles: callerOf(c)?.roles ?? [] };

        const collections: SimulatedCollectionView[] = [];
        for (const collection of config.collections()) {
            const view: SimulatedCollectionView = {
                slug: collection.slug,
                name: collection.name ?? collection.slug,
                maskedColumns: maskedFieldsFor(collection, identity.roles)
            };
            if (identity.scopes && !scopeGrants(identity.scopes, "data:read", collection.slug)) {
                view.hiddenBy = "scope";
                collections.push(view);
                continue;
            }
            try {
                const driver = config.driverFor(collection.slug);
                const [visible, total] = await Promise.all([
                    scopeDataDriver(driver, {
                        uid: identity.uid,
                        roles: identity.roles,
                        isAnonymous: identity.isAnonymous,
                        ...(identity.claims ? { claims: identity.claims } : {})
                    }).then(scoped => countRows(scoped, collection)),
                    scopeDataDriver(driver, callerIdentity).then(scoped => countRows(scoped, collection))
                ]);
                view.visibleRows = visible;
                view.totalRows = total;
                if (total > 0 && visible === 0) view.hiddenBy = "rls";
            } catch (error: unknown) {
                // A read that fails for this identity — a policy that casts
                // its uid, a grant it lacks — shows it nothing either.
                view.hiddenBy = "error";
                view.error = error instanceof Error ? error.message : String(error);
            }
            collections.push(view);
        }

        return c.json({
            simulation: {
                role: identity.role,
                sub: identity.uid,
                roles: identity.roles,
                ...(identity.apiKey
                    ? { apiKey: { id: identity.apiKey.id, name: identity.apiKey.name, keyPrefix: identity.apiKey.key_prefix } }
                    : {})
            },
            collections,
            summary: {
                hiddenCollections: collections.filter(view => view.hiddenBy).length,
                maskedColumns: collections.reduce((sum, view) => sum + view.maskedColumns.length, 0)
            }
        });
    });

    return router;
}
