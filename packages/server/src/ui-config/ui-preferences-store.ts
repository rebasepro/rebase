/**
 * Persistence for UI preferences: how the panel presents each table, for the
 * whole workspace or for one user (`rebase.ui_preferences`).
 *
 * A row is one table's {@link UiTablePreferences} delta — labels, column
 * order and widths, hidden columns, view modes, enum labels — for one scope:
 * `workspace` (owner `''`), written by an admin from the collection editor,
 * or `user` (owner = the user's id), written by the views as somebody resizes
 * a column or switches a view. The schema is not here: column types, rules
 * and the rest live in `backend/schema/*.ts`.
 *
 * One table in the `rebase` schema, revoked from `rebase_user` like every
 * other internal table: the server reads and writes it on the caller's
 * behalf, after checking who they are; the role RLS scopes never touches it.
 *
 * A write merges the delta into what is stored (`mergeUiTablePreferences`):
 * read, merge, upsert. Two writes to one row racing keep the later one's keys
 * — a preference, not a ledger.
 *
 * @module
 */
import type { DataDriver, UiPreferenceScope, UiPreferences, UiTablePreferences } from "@rebasepro/types";
import { isSQLAdmin, isUiTablePreferences, mergeUiTablePreferences } from "@rebasepro/types";
import { revokeInternalTableSql } from "@rebasepro/common";
import { createDdlBootstrapper, provisioningExec, type SqlExec } from "../boot/ddl-bootstrap";
import { logger } from "../utils/logger";
import { ApiError } from "../api/errors";
import { UI_PREFERENCES_MAX_BYTES } from "./ui-config-bounds";

const TABLE = "rebase.ui_preferences";

/** Whose preferences: the workspace's, or one user's. */
export interface UiPreferenceOwner {
    scope: UiPreferenceScope;
    /** The user's id for `user`; ignored for `workspace`. */
    uid?: string;
}

/** The store behind `/api/admin/ui-config`. */
export interface UiPreferencesStore {
    ensureTables(): Promise<void>;
    /** Every table's preferences for an owner. */
    list(owner: UiPreferenceOwner): Promise<UiPreferences>;
    /**
     * Merge `delta` into an owner's preferences for `slug` (or replace them,
     * with `replace`), and return what is now stored.
     */
    save(owner: UiPreferenceOwner, slug: string, delta: UiTablePreferences, options: { updatedBy: string; replace?: boolean }): Promise<UiTablePreferences>;
    /** Forget an owner's preferences for `slug`. */
    remove(owner: UiPreferenceOwner, slug: string): Promise<void>;
}

const ownerKey = (owner: UiPreferenceOwner): string => {
    if (owner.scope === "workspace") return "";
    if (!owner.uid) throw new Error("A user preference needs the user's id.");
    return owner.uid;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** A stored document, parsed: drivers hand `jsonb` back parsed or as text. */
function storedPreferences(value: unknown, where: string): UiTablePreferences | undefined {
    let parsed: unknown = value;
    if (typeof value === "string") {
        try {
            parsed = JSON.parse(value);
        } catch {
            parsed = undefined;
        }
    }
    if (isRecord(parsed) && isUiTablePreferences(parsed)) return parsed;
    // A row written by an older server, or by hand, that is no longer a valid
    // preference: skipped rather than served, so no view renders from it.
    logger.warn(`[ui-config] Ignoring the stored preferences of ${where}: they are not valid table preferences.`);
    return undefined;
}

/**
 * A store backed by the driver's SQL escape hatch, or null when the driver
 * cannot run SQL: the routes then answer that preferences are not stored on
 * this backend, and the panel keeps them in the browser.
 */
export function createUiPreferencesStore(
    /** Only its SQL escape hatch is read. */
    driver: Pick<DataDriver, "admin">,
    options: {
        /**
         * Default `true`. `false` is a backend that changes nothing in its
         * database (`REBASE_PROVISION=false`): `ensureTables` creates nothing,
         * and throws when the table is not already there.
         */
        provision?: boolean;
    } = {}
): UiPreferencesStore | null {
    const admin = driver.admin;
    if (!isSQLAdmin(admin)) return null;

    const run: SqlExec = provisioningExec(
        (sql, execOptions) => admin.executeSql(sql, execOptions?.params ? { params: execOptions.params } : undefined),
        options.provision
    );
    const exec = (sql: string, params?: unknown[]) => run(sql, params ? { params } : undefined);
    const ddl = createDdlBootstrapper(run, "ui-preferences-store");

    const read = async (owner: string, scope: UiPreferenceScope, slug: string): Promise<UiTablePreferences> => {
        const rows = await exec(
            `SELECT preferences FROM ${TABLE} WHERE scope = $1 AND owner = $2 AND table_slug = $3`,
            [scope, owner, slug]
        );
        return rows.length > 0 ? storedPreferences(rows[0].preferences, `${scope} ${slug}`) ?? {} : {};
    };

    return {
        async ensureTables() {
            await ddl.ensureObject(TABLE, `
                CREATE TABLE IF NOT EXISTS ${TABLE} (
                    scope        text NOT NULL CHECK (scope IN ('workspace', 'user')),
                    owner        text NOT NULL DEFAULT '',
                    table_slug   text NOT NULL,
                    preferences  jsonb NOT NULL,
                    updated_by   text,
                    updated_at   timestamptz NOT NULL DEFAULT now(),
                    PRIMARY KEY (scope, owner, table_slug)
                )
            `);
            const [schema, name] = TABLE.split(".");
            await ddl.step(`revoke ${TABLE}`, () => exec(revokeInternalTableSql(schema, name)));

            // The bootstrapper logs a failed statement rather than throwing;
            // routes over a missing table would fail every request, so ask.
            const rows = await exec(`SELECT to_regclass($1) AS present`, [TABLE]);
            if (rows[0]?.present == null) {
                throw new Error(options.provision === false
                    ? `The UI preferences table ${TABLE} does not exist, and this backend changes nothing in its database. `
                      + "A provisioning run creates it."
                    : `The UI preferences table ${TABLE} was not created. Check the boot log above for the statement `
                      + "that failed, which is usually a permissions problem on the `rebase` schema.");
            }
        },

        async list(owner) {
            const rows = await exec(
                `SELECT table_slug, preferences FROM ${TABLE} WHERE scope = $1 AND owner = $2 ORDER BY table_slug`,
                [owner.scope, ownerKey(owner)]
            );
            // A Map, not assignment into `{}`: a stored slug of `__proto__`
            // would set the object's prototype instead of a key.
            const tables = new Map<string, UiTablePreferences>();
            for (const row of rows) {
                if (typeof row.table_slug !== "string") continue;
                const preferences = storedPreferences(row.preferences, `${owner.scope} ${row.table_slug}`);
                if (preferences) tables.set(row.table_slug, preferences);
            }
            return { tables: Object.fromEntries(tables) };
        },

        async save(owner, slug, delta, { updatedBy, replace }) {
            const key = ownerKey(owner);
            const next = replace ? delta : mergeUiTablePreferences(await read(key, owner.scope, slug), delta);
            const serialized = JSON.stringify(next);
            // The body is capped at the route; a merge could still grow a row
            // past it one write at a time.
            if (Buffer.byteLength(serialized, "utf8") > UI_PREFERENCES_MAX_BYTES) {
                throw new ApiError(413, "UI_PREFERENCES_TOO_LARGE",
                    `"${slug}"'s preferences would take more than ${UI_PREFERENCES_MAX_BYTES / 1024} KB. Reset them, or save fewer.`);
            }
            await exec(
                `INSERT INTO ${TABLE} (scope, owner, table_slug, preferences, updated_by, updated_at)
                 VALUES ($1, $2, $3, $4::jsonb, $5, now())
                 ON CONFLICT (scope, owner, table_slug)
                 DO UPDATE SET preferences = EXCLUDED.preferences, updated_by = EXCLUDED.updated_by, updated_at = now()`,
                [owner.scope, key, slug, serialized, updatedBy]
            );
            return next;
        },

        async remove(owner, slug) {
            await exec(`DELETE FROM ${TABLE} WHERE scope = $1 AND owner = $2 AND table_slug = $3`, [owner.scope, ownerKey(owner), slug]);
        }
    };
}
