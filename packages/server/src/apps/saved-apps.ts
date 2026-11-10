/**
 * EXPERIMENTAL. Apps saved to the project: the TSX a show_app call ran, kept
 * in `rebase.saved_apps` so it opens again — in the conversation
 * (`open_app`), in the admin panel, or as a Claude artifact — for whoever it
 * was saved for.
 *
 * Who sees one is its `visibility`: `personal` (its owner), `roles` (anyone
 * holding one of its `roles`), or `team` (everyone who signs in). Saving for
 * more than oneself takes the admin role, because a shared app is code an AI
 * wrote, running for other people. Seeing an app is not reaching its data:
 * an app reads and writes only through the data tools, as whoever opens it,
 * under their RLS.
 *
 * The table is not a collection and carries no RLS, so no end user is granted
 * anything on it; every read and write here filters by the viewer itself.
 *
 * @module
 */
import type { DataDriver } from "@rebasepro/types";
import { hasAdminRole, isSQLAdmin } from "@rebasepro/types";
import { revokeInternalTableSql } from "@rebasepro/common";
import { createDdlBootstrapper, type SqlExec } from "../boot/ddl-bootstrap.js";

export type AppVisibility = "personal" | "roles" | "team";

export const APP_VISIBILITIES: readonly AppVisibility[] = ["personal", "roles", "team"];

export interface SavedAppSummary {
    id: string;
    title: string;
    collections: string[];
    visibility: AppVisibility;
    roles: string[];
    ownerId: string;
    updatedAt: string;
}

export interface SavedApp extends SavedAppSummary {
    code: string;
    createdAt: string;
}

/** Who is asking: whose personal apps, which roles' apps, and whether they may share. */
export interface AppViewer {
    uid: string;
    roles: readonly string[];
}

export interface SaveAppInput {
    /** The app to replace, by its owner (or an admin); a new app without it. */
    id?: string;
    title: string;
    code: string;
    collections: string[];
    visibility: AppVisibility;
    /** For `roles`: who sees it. */
    roles?: string[];
}

/** A request the store refuses, with a reason the caller can show. */
export class SavedAppError extends Error {}

export interface SavedAppStore {
    list(viewer: AppViewer): Promise<SavedAppSummary[]>;
    get(id: string, viewer: AppViewer): Promise<SavedApp | undefined>;
    save(input: SaveAppInput, viewer: AppViewer): Promise<SavedApp>;
    remove(id: string, viewer: AppViewer): Promise<boolean>;
}

const TABLE = "rebase.saved_apps";

/** The rows a viewer may see: their own, their roles', and the team's. */
const VISIBLE = `(owner_id = $1 OR visibility = 'team' OR (visibility = 'roles' AND roles && $2::text[]))`;

/**
 * The dates as ISO 8601 text: a driver may hand a timestamptz back as
 * Postgres's own text (`2026-11-09 17:02:23.6+01`), which not every browser
 * parses; JSON's rendering of it is ISO in every driver.
 */
const COLUMNS = "id, title, collections, visibility, roles, owner_id, "
    + "to_json(created_at) #>> '{}' AS created_at, to_json(updated_at) #>> '{}' AS updated_at";

/** The most apps one person keeps: saved apps are a place to keep work, not storage. */
export const MAX_APPS_PER_OWNER = 200;

/** The longest app one person saves, in characters: any signed-in user may save, so the store is bounded per app too. */
export const MAX_APP_CODE_LENGTH = 256_000;

const stores = new WeakMap<DataDriver, SavedAppStore | undefined>();

/**
 * The store on `driver`'s database, made once per driver; `undefined` on a
 * driver with no SQL (saved apps need a table).
 */
export function savedAppStore(driver: DataDriver): SavedAppStore | undefined {
    if (stores.has(driver)) return stores.get(driver);
    const admin = driver.admin;
    const store = isSQLAdmin(admin)
        ? createSavedAppStore((sqlText, options) => admin.executeSql(sqlText, options?.params ? { params: options.params } : undefined))
        : undefined;
    stores.set(driver, store);
    return store;
}

export function createSavedAppStore(exec: SqlExec): SavedAppStore {
    const ddl = createDdlBootstrapper(exec, "saved-apps");
    let ready: Promise<void> | undefined;

    /** The table, made on first use, and closed to end users every time it is made ready. */
    const ensure = () => ready ??= (async () => {
        await ddl.ensureObject("Creating schema rebase", "CREATE SCHEMA IF NOT EXISTS rebase");
        await ddl.ensureObject(`Creating ${TABLE}`, `
            CREATE TABLE IF NOT EXISTS ${TABLE} (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                title TEXT NOT NULL,
                code TEXT NOT NULL,
                collections TEXT[] NOT NULL,
                visibility TEXT NOT NULL CHECK (visibility IN ('personal', 'roles', 'team')),
                roles TEXT[] NOT NULL DEFAULT '{}',
                owner_id TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )`);
        if (!await ddl.isReadable(TABLE)) {
            ready = undefined;
            throw new SavedAppError("Saved apps need the rebase.saved_apps table, and this backend could not create it "
                + "(is provisioning off?). Create it with the server's schema tooling, then try again.");
        }
        await ddl.step("Revoking end-user access to saved_apps", () => exec(revokeInternalTableSql("rebase", "saved_apps")));
    })();

    const visibleTo = (viewer: AppViewer) => [viewer.uid, [...viewer.roles]];

    return {
        async list(viewer) {
            await ensure();
            const rows = await exec(`SELECT ${COLUMNS} FROM ${TABLE} WHERE ${VISIBLE} ORDER BY updated_at DESC LIMIT 200`,
                { params: visibleTo(viewer) });
            return (rows ?? []).map(summaryOf);
        },

        async get(id, viewer) {
            if (!isUuid(id)) return undefined;
            await ensure();
            const rows = await exec(`SELECT ${COLUMNS}, code FROM ${TABLE} WHERE id = $3 AND ${VISIBLE}`,
                { params: [...visibleTo(viewer), id] });
            const row = rows?.[0];
            return row ? appOf(row) : undefined;
        },

        async save(input, viewer) {
            const roles = input.visibility === "roles" ? [...new Set(input.roles ?? [])] : [];
            if (input.visibility === "roles" && roles.length === 0) {
                throw new SavedAppError("An app saved for roles names at least one role.");
            }
            if (input.visibility !== "personal" && !hasAdminRole(viewer.roles)) {
                throw new SavedAppError("Saving an app for other people takes the admin role. Save it as personal instead.");
            }
            if (input.code.length > MAX_APP_CODE_LENGTH) {
                throw new SavedAppError(`An app's code is at most ${MAX_APP_CODE_LENGTH} characters; this one is ${input.code.length}.`);
            }
            await ensure();
            if (input.id !== undefined) {
                if (!isUuid(input.id)) throw new SavedAppError(`No saved app with id "${input.id}".`);
                // Its owner, or an admin, replaces it; nobody else, whoever can see it.
                const rows = await exec(`
                    UPDATE ${TABLE} SET title = $1, code = $2, collections = $3::text[], visibility = $4, roles = $5::text[], updated_at = now()
                    WHERE id = $6 AND (owner_id = $7 OR $8)
                    RETURNING ${COLUMNS}, code`,
                { params: [input.title, input.code, input.collections, input.visibility, roles, input.id, viewer.uid, hasAdminRole(viewer.roles)] });
                const row = rows?.[0];
                if (!row) throw new SavedAppError(`No saved app with id "${input.id}" that you may change.`);
                return appOf(row);
            }
            const [{ n } = { n: 0 }] = await exec(`SELECT count(*)::int AS n FROM ${TABLE} WHERE owner_id = $1`, { params: [viewer.uid] });
            if (Number(n) >= MAX_APPS_PER_OWNER) {
                throw new SavedAppError(`You have ${MAX_APPS_PER_OWNER} saved apps, the most one person keeps. Delete one to save another.`);
            }
            const rows = await exec(`
                INSERT INTO ${TABLE} (title, code, collections, visibility, roles, owner_id)
                VALUES ($1, $2, $3::text[], $4, $5::text[], $6)
                RETURNING ${COLUMNS}, code`,
            { params: [input.title, input.code, input.collections, input.visibility, roles, viewer.uid] });
            const row = rows?.[0];
            if (!row) throw new SavedAppError("The app was not saved.");
            return appOf(row);
        },

        async remove(id, viewer) {
            if (!isUuid(id)) return false;
            await ensure();
            const rows = await exec(`DELETE FROM ${TABLE} WHERE id = $1 AND (owner_id = $2 OR $3) RETURNING id`,
                { params: [id, viewer.uid, hasAdminRole(viewer.roles)] });
            return (rows ?? []).length > 0;
        }
    };
}

function isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function texts(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function iso(value: unknown): string {
    return value instanceof Date ? value.toISOString() : String(value ?? "");
}

function visibilityOf(value: unknown): AppVisibility {
    return APP_VISIBILITIES.find(visibility => visibility === value) ?? "personal";
}

function summaryOf(row: Record<string, unknown>): SavedAppSummary {
    return {
        id: String(row.id),
        title: String(row.title ?? ""),
        collections: texts(row.collections),
        visibility: visibilityOf(row.visibility),
        roles: texts(row.roles),
        ownerId: String(row.owner_id ?? ""),
        updatedAt: iso(row.updated_at)
    };
}

function appOf(row: Record<string, unknown>): SavedApp {
    return { ...summaryOf(row), code: String(row.code ?? ""), createdAt: iso(row.created_at) };
}
