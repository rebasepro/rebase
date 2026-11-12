/**
 * `/api/admin/ui-config`: how the panel presents each table, as UI
 * preferences.
 *
 * - `GET /` — the workspace's preferences and the caller's own, by table
 *   slug, and where workspace preferences are written (`workspaceTarget`).
 * - `PUT /workspace/:slug` `{ preferences, replace? }` — merge (or replace)
 *   the workspace's preferences for a table. Needs `schema:write`: it changes
 *   how the table looks for everybody.
 * - `PUT /user/:slug` `{ preferences, replace? }` — the caller's own: any
 *   signed-in person.
 * - `DELETE /workspace/:slug`, `DELETE /user/:slug` — back to the defaults.
 *
 * Where workspace preferences live depends on whether this server may write
 * the project's source. In development it may — the same gate as the schema
 * editor — and they are written to `frontend/src/cms/ui-config.json`, which
 * the frontend imports and ships, so they are reviewed and deployed with the
 * code. Deployed, the frontend's source is not on disk, and they are rows of
 * `rebase.ui_preferences`. A user's own preferences are always rows.
 *
 * A body is validated against the preference keys (`UI_PREFERENCE_TABLE_KEYS`,
 * `UI_PREFERENCE_FIELD_KEYS`): a schema fact or anything that is not JSON data
 * is refused with the path of every offending key.
 *
 * @module
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Hono, type Context } from "hono";
import type { UiPreferences, UiTablePreferences } from "@rebasepro/types";
import { isUiTablePreferences, mergeUiTablePreferences, uiTablePreferencesProblems } from "@rebasepro/types";

import { ApiError, errorHandler } from "../api/errors";
import type { HonoEnv } from "../api/types";
import { hasScope, scopeMissing } from "../auth/access";
import type { UiPreferencesStore } from "./ui-preferences-store";

/** The file workspace preferences are written to in development, relative to the project root. */
export const UI_CONFIG_FILE = "frontend/src/cms/ui-config.json";

/** What the routes are built over. */
export interface UiConfigRoutesOptions {
    /** The rows; `null` when the driver cannot run SQL. */
    store: UiPreferencesStore | null;
    /**
     * The absolute path of `frontend/src/cms/ui-config.json` when this server
     * may write the project's source (the schema editor's gate); workspace
     * preferences are then written there instead of to the database.
     */
    workspaceFile?: string;
}

/** A table slug, as the routes take it: what a slug may be, and nothing that reaches a path. */
const SLUG = /^[A-Za-z_][A-Za-z0-9_$-]*$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

function slugOf(c: Context<HonoEnv>): string {
    const slug = c.req.param("slug") ?? "";
    if (!SLUG.test(slug) || slug.length > 128) {
        throw ApiError.badRequest(`"${slug}" is not a table slug.`, "INVALID_INPUT");
    }
    return slug;
}

/** `{ preferences, replace? }`, validated, or a 400 naming every offending key. */
async function bodyOf(c: Context<HonoEnv>): Promise<{ preferences: UiTablePreferences; replace: boolean }> {
    const body: unknown = await c.req.json().catch(() => undefined);
    if (!isRecord(body) || !("preferences" in body)) {
        throw ApiError.badRequest("Expected `{ preferences: { … } }`: the table's preferences to store.", "INVALID_INPUT");
    }
    const preferences = body.preferences;
    if (!isUiTablePreferences(preferences)) {
        const problems = uiTablePreferencesProblems(preferences);
        throw ApiError.badRequest(
            "These are not table preferences:\n" + problems.map(p => `  - ${p.path || "(the body)"} ${p.message}`).join("\n"),
            "INVALID_INPUT",
            { problems }
        );
    }
    return { preferences, replace: body.replace === true };
}

/** The caller's user id, when the caller is a user. */
function uidOf(c: Context<HonoEnv>): string | undefined {
    const user: unknown = c.get("user");
    return isRecord(user) && typeof user.uid === "string" && user.uid !== "" ? user.uid : undefined;
}

/** The signed-in person a user preference belongs to, or a refusal. */
function personOf(c: Context<HonoEnv>): string {
    const uid = uidOf(c);
    if (!uid || c.get("apiKey") !== undefined) {
        throw new ApiError(403, "UI_PREFERENCES_NEED_A_PERSON",
            "UI preferences belong to a signed-in person. An API key, a platform token or the service key has none.");
    }
    return uid;
}

function requireStore(store: UiPreferencesStore | null): UiPreferencesStore {
    if (!store) {
        throw new ApiError(501, "UI_PREFERENCES_UNSUPPORTED",
            "This backend's data driver cannot run SQL, so it stores no UI preferences. The panel keeps them in the browser.");
    }
    return store;
}

// ── The development file ────────────────────────────────────────────────────

/** The file's preferences; empty when it does not exist yet. Invalid entries are reported, not served. */
export async function readUiConfigFile(file: string): Promise<UiPreferences> {
    let text: string;
    try {
        text = await fs.readFile(file, "utf8");
    } catch (error) {
        if (isRecord(error) && error.code === "ENOENT") return { tables: {} };
        throw error;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new ApiError(500, "UI_CONFIG_FILE_INVALID",
            `${UI_CONFIG_FILE} is not valid JSON. Fix or delete it; the panel rewrites it on the next save.`);
    }
    const tables: UiPreferences["tables"] = {};
    const listed = isRecord(parsed) && isRecord(parsed.tables) ? parsed.tables : {};
    for (const [slug, preferences] of Object.entries(listed)) {
        if (isUiTablePreferences(preferences)) tables[slug] = preferences;
    }
    return { tables };
}

/** Write the file whole, through a temporary file, so a reader never sees half of it. */
async function writeUiConfigFile(file: string, config: UiPreferences): Promise<void> {
    const sorted: UiPreferences["tables"] = {};
    for (const slug of Object.keys(config.tables).sort()) sorted[slug] = config.tables[slug];
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify({ tables: sorted }, null, 2)}\n`, "utf8");
    await fs.rename(temporary, file);
}

/**
 * Merge (or replace) one table's preferences in the file, creating the file
 * and its directory when they are missing; returns what is now stored. What
 * `PUT /workspace/:slug` does on a server that may write the project's source.
 */
export async function saveToUiConfigFile(file: string, slug: string, preferences: UiTablePreferences, replace = false): Promise<UiTablePreferences> {
    const current = await readUiConfigFile(file);
    const next = replace ? preferences : mergeUiTablePreferences(current.tables[slug] ?? {}, preferences);
    await writeUiConfigFile(file, { tables: { ...current.tables, [slug]: next } });
    return next;
}

/** One write to the file at a time: each reads, merges and rewrites it whole. */
function serialized(): <T>(run: () => Promise<T>) => Promise<T> {
    let tail: Promise<unknown> = Promise.resolve();
    return <T>(run: () => Promise<T>): Promise<T> => {
        const next = tail.then(run, run);
        tail = next.catch(() => undefined);
        return next;
    };
}

// ── The routes ──────────────────────────────────────────────────────────────

/**
 * The UI preferences routes. Mount behind an authenticating gate: every route
 * needs a signed-in caller, and the workspace's writes check `schema:write`
 * here.
 */
export function createUiConfigRoutes({ store, workspaceFile }: UiConfigRoutesOptions): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    router.onError(errorHandler);
    const oneFileWriteAtATime = serialized();

    const requireWorkspaceWriter = (c: Context<HonoEnv>): void => {
        if (!hasScope(c, "schema:write")) throw scopeMissing(c, "schema:write");
    };

    router.get("/", async (c) => {
        const uid = c.get("apiKey") === undefined ? uidOf(c) : undefined;
        const workspace = workspaceFile
            ? await readUiConfigFile(workspaceFile)
            : store ? await store.list({ scope: "workspace" }) : { tables: {} };
        const own = uid && store ? await store.list({ scope: "user", uid }) : { tables: {} };
        return c.json({
            workspace,
            user: own,
            workspaceTarget: workspaceFile ? "file" : store ? "database" : "none",
            ...(workspaceFile ? { file: UI_CONFIG_FILE } : {}),
            userTarget: uid && store ? "database" : "none",
            canWriteWorkspace: hasScope(c, "schema:write") && (Boolean(workspaceFile) || store !== null)
        });
    });

    router.put("/workspace/:slug", async (c) => {
        requireWorkspaceWriter(c);
        const slug = slugOf(c);
        const { preferences, replace } = await bodyOf(c);
        if (workspaceFile) {
            const stored = await oneFileWriteAtATime(() => saveToUiConfigFile(workspaceFile, slug, preferences, replace));
            return c.json({ slug, preferences: stored, target: "file", file: UI_CONFIG_FILE });
        }
        const updatedBy = uidOf(c) ?? "service";
        const stored = await requireStore(store).save({ scope: "workspace" }, slug, preferences, { updatedBy, replace });
        return c.json({ slug, preferences: stored, target: "database" });
    });

    router.put("/user/:slug", async (c) => {
        const uid = personOf(c);
        const slug = slugOf(c);
        const { preferences, replace } = await bodyOf(c);
        const stored = await requireStore(store).save({ scope: "user", uid }, slug, preferences, { updatedBy: uid, replace });
        return c.json({ slug, preferences: stored, target: "database" });
    });

    router.delete("/workspace/:slug", async (c) => {
        requireWorkspaceWriter(c);
        const slug = slugOf(c);
        if (workspaceFile) {
            await oneFileWriteAtATime(async () => {
                const current = await readUiConfigFile(workspaceFile);
                const { [slug]: _removed, ...rest } = current.tables;
                void _removed;
                await writeUiConfigFile(workspaceFile, { tables: rest });
            });
            return c.json({ slug, removed: true });
        }
        await requireStore(store).remove({ scope: "workspace" }, slug);
        return c.json({ slug, removed: true });
    });

    router.delete("/user/:slug", async (c) => {
        const uid = personOf(c);
        const slug = slugOf(c);
        await requireStore(store).remove({ scope: "user", uid }, slug);
        return c.json({ slug, removed: true });
    });

    return router;
}
