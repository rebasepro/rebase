/**
 * `/api/admin/ui-config`: UI preferences, the workspace's and each user's.
 *
 * What is under test: who may write which scope, that a body is refused
 * unless every key is a preference (a schema fact never lands here), that a
 * write merges into what is stored, and that in development the workspace's
 * preferences are written to `frontend/src/cms/ui-config.json` instead of the
 * database. The SQL of the store is proven against Postgres in
 * `server-postgres/test/ui-preferences-store.test.ts`; here it is in memory.
 */
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { Hono } from "hono";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UiPreferences, UiTablePreferences } from "@rebasepro/types";
import { mergeUiTablePreferences } from "@rebasepro/types";

import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createUiConfigRoutes, UI_CONFIG_FILE } from "../src/ui-config/ui-config-routes";
import { composableLayers, readUiPreferenceLayers } from "../src/ui-config/ui-preference-layers";
import type { UiPreferenceOwner, UiPreferencesStore } from "../src/ui-config/ui-preferences-store";

/** The store, in memory: rows keyed by scope, owner and slug. */
function memoryStore(): UiPreferencesStore & { rows: Map<string, UiTablePreferences> } {
    const rows = new Map<string, UiTablePreferences>();
    const key = (owner: UiPreferenceOwner, slug: string) => `${owner.scope}|${owner.scope === "user" ? owner.uid : ""}|${slug}`;
    return {
        rows,
        async ensureTables() { /* nothing to make */ },
        async list(owner) {
            const prefix = `${owner.scope}|${owner.scope === "user" ? owner.uid : ""}|`;
            const tables: UiPreferences["tables"] = {};
            for (const [k, v] of rows) if (k.startsWith(prefix)) tables[k.slice(prefix.length)] = v;
            return { tables };
        },
        async save(owner, slug, delta, { replace }) {
            const next = replace ? delta : mergeUiTablePreferences(rows.get(key(owner, slug)) ?? {}, delta);
            rows.set(key(owner, slug), next);
            return next;
        },
        async remove(owner, slug) { rows.delete(key(owner, slug)); }
    };
}

const ADMIN = { uid: "u_admin", roles: ["admin"] };
const EDITOR = { uid: "u_editor", roles: ["editor"] };

function harness(options: { user?: HonoEnv["Variables"]["user"]; apiKey?: boolean; workspaceFile?: string; shippedFile?: string; store?: UiPreferencesStore | null } = {}) {
    const store = options.store === undefined ? memoryStore() : options.store;
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    // Stands in for the signed-in gate the backend mounts in front.
    app.use("/*", async (c, next) => {
        if (options.user) c.set("user", options.user);
        if (options.apiKey) c.set("apiKey", { id: "key_1", name: "ci", scopes: ["schema:write"] });
        await next();
    });
    app.route("/api/admin/ui-config", createUiConfigRoutes({ store, workspaceFile: options.workspaceFile, shippedFile: options.shippedFile }));
    const call = (method: string, route: string, body?: unknown) => app.fetch(new Request(`http://localhost/api/admin/ui-config${route}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    }));
    return { call, store };
}

describe("the database target (deployed)", () => {
    it("an admin writes the workspace's preferences, merged into what is stored", async () => {
        const { call } = harness({ user: ADMIN });
        expect((await call("PUT", "/workspace/posts", { preferences: { name: "Articles", fields: { title: { columnWidth: 320 } } } })).status).toBe(200);
        const merged = await call("PUT", "/workspace/posts", { preferences: { icon: "Article", fields: { title: { hidden: false } } } });
        expect(await merged.json()).toEqual({
            slug: "posts",
            target: "database",
            preferences: { name: "Articles", icon: "Article", fields: { title: { columnWidth: 320, hidden: false } } }
        });
        const listed = await (await call("GET", "")).json();
        expect(listed).toMatchObject({
            workspaceTarget: "database",
            canWriteWorkspace: true,
            workspace: { tables: { posts: { name: "Articles", icon: "Article" } } },
            user: { tables: {} }
        });
    });

    it("replace drops what the body does not name", async () => {
        const { call } = harness({ user: ADMIN });
        await call("PUT", "/workspace/posts", { preferences: { name: "Articles", icon: "Article" } });
        const replaced = await call("PUT", "/workspace/posts", { preferences: { icon: "Book" }, replace: true });
        expect((await replaced.json()).preferences).toEqual({ icon: "Book" });
    });

    it("a caller without schema:write may not change the workspace's, but writes their own", async () => {
        const { call } = harness({ user: EDITOR });
        const refused = await call("PUT", "/workspace/posts", { preferences: { name: "Mine" } });
        expect(refused.status).toBe(403);
        expect((await refused.json()).error.code).toBe("SCOPE_MISSING");

        const own = await call("PUT", "/user/posts", { preferences: { defaultViewMode: "kanban", fields: { title: { columnWidth: 200 } } } });
        expect(own.status).toBe(200);
        const listed = await (await call("GET", "")).json();
        expect(listed.user).toEqual({ tables: { posts: { defaultViewMode: "kanban", fields: { title: { columnWidth: 200 } } } } });
        expect(listed.canWriteWorkspace).toBe(false);
    });

    it("one user's preferences are not another's", async () => {
        const store = memoryStore();
        await harness({ user: EDITOR, store }).call("PUT", "/user/posts", { preferences: { defaultSize: "s" } });
        const other = await (await harness({ user: { uid: "u_other", roles: ["editor"] }, store }).call("GET", "")).json();
        expect(other.user).toEqual({ tables: {} });
    });

    it("an API key has no preferences of its own", async () => {
        const { call } = harness({ user: ADMIN, apiKey: true });
        const res = await call("PUT", "/user/posts", { preferences: { defaultSize: "s" } });
        expect(res.status).toBe(403);
        expect((await res.json()).error.code).toBe("UI_PREFERENCES_NEED_A_PERSON");
    });

    it("refuses a schema fact, naming every offending key", async () => {
        const { call, store } = harness({ user: ADMIN });
        const res = await call("PUT", "/workspace/posts", {
            preferences: { name: "Articles", rls: "admin-only", fields: { title: { validation: { required: true }, Field: "MyField" } } }
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error.code).toBe("INVALID_INPUT");
        expect(body.error.details.problems.map((p: { path: string }) => p.path)).toEqual(["rls", "fields.title.validation", "fields.title.Field"]);
        expect(await store!.list({ scope: "workspace" })).toEqual({ tables: {} });
    });

    it("refuses a value of the wrong shape", async () => {
        const { call } = harness({ user: ADMIN });
        const res = await call("PUT", "/workspace/posts", { preferences: { defaultSize: "huge", fields: { title: { columnWidth: -4 } } } });
        expect(res.status).toBe(400);
        expect((await res.json()).error.details.problems.map((p: { path: string }) => p.path)).toEqual(["defaultSize", "fields.title.columnWidth"]);
    });

    it("refuses a slug that is not one", async () => {
        const { call } = harness({ user: ADMIN });
        expect((await call("PUT", "/workspace/..%2Fetc", { preferences: {} })).status).toBe(400);
    });

    it("forgets a table's preferences", async () => {
        const { call } = harness({ user: ADMIN });
        await call("PUT", "/workspace/posts", { preferences: { name: "Articles" } });
        expect((await call("DELETE", "/workspace/posts")).status).toBe(200);
        expect((await (await call("GET", "")).json()).workspace).toEqual({ tables: {} });
    });

    it("says preferences are not stored here when the driver cannot run SQL", async () => {
        const { call } = harness({ user: ADMIN, store: null });
        const res = await call("PUT", "/user/posts", { preferences: { defaultSize: "s" } });
        expect(res.status).toBe(501);
        expect((await call("GET", "")).status).toBe(200);
    });
});

describe("the file target (development)", () => {
    let root: string;
    let file: string;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-ui-config-"));
        file = path.join(root, UI_CONFIG_FILE);
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it("writes the workspace's preferences to frontend/src/cms/ui-config.json, never to the database", async () => {
        const { call, store } = harness({ user: ADMIN, workspaceFile: file });
        const res = await call("PUT", "/workspace/posts", { preferences: { name: "Articles", fields: { status: { enumLabels: { draft: "WIP" } } } } });
        expect(await res.json()).toMatchObject({ target: "file", file: UI_CONFIG_FILE });
        await call("PUT", "/workspace/authors", { preferences: { icon: "Person" } });
        expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
            tables: {
                authors: { icon: "Person" },
                posts: { name: "Articles", fields: { status: { enumLabels: { draft: "WIP" } } } }
            }
        });
        expect(await store!.list({ scope: "workspace" })).toEqual({ tables: {} });

        const listed = await (await call("GET", "")).json();
        expect(listed).toMatchObject({ workspaceTarget: "file", file: UI_CONFIG_FILE, workspace: { tables: { authors: { icon: "Person" } } } });
    });

    it("keeps a user's own preferences in the database", async () => {
        const { call, store } = harness({ user: EDITOR, workspaceFile: file });
        await call("PUT", "/user/posts", { preferences: { defaultSize: "s" } });
        expect(fs.existsSync(file)).toBe(false);
        expect(await store!.list({ scope: "user", uid: "u_editor" })).toEqual({ tables: { posts: { defaultSize: "s" } } });
    });

    it("serializes concurrent writes so none is lost", async () => {
        const { call } = harness({ user: ADMIN, workspaceFile: file });
        await Promise.all(["a", "b", "c", "d"].map(slug => call("PUT", `/workspace/${slug}`, { preferences: { icon: slug } })));
        expect(Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).tables)).toEqual(["a", "b", "c", "d"]);
    });

    it("removes a table from the file", async () => {
        const { call } = harness({ user: ADMIN, workspaceFile: file });
        await call("PUT", "/workspace/posts", { preferences: { name: "Articles" } });
        await call("DELETE", "/workspace/posts");
        expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ tables: {} });
    });
});

describe("the shipped layer: ui-config.json as the server knows it", () => {
    let dir: string;
    let shippedFile: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-ui-shipped-"));
        // The copy a built bundle carries (`entry.uiConfig`).
        shippedFile = path.join(dir, "ui-config.json");
        fs.writeFileSync(shippedFile, JSON.stringify({ tables: { posts: { name: "Articles", fields: { status: { enumLabels: { draft: "WIP" } } } } } }));
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it("a deployed server serves the bundle's copy as `shipped`, beside the workspace's rows", async () => {
        const { call } = harness({ user: ADMIN, shippedFile });
        await call("PUT", "/workspace/posts", { preferences: { icon: "Article" } });
        const listed = await (await call("GET", "")).json();
        expect(listed).toMatchObject({
            workspaceTarget: "database",
            shipped: { tables: { posts: { name: "Articles", fields: { status: { enumLabels: { draft: "WIP" } } } } } },
            workspace: { tables: { posts: { icon: "Article" } } }
        });
    });

    it("a server with neither file serves an empty shipped layer", async () => {
        const listed = await (await harness({ user: ADMIN }).call("GET", "")).json();
        expect(listed.shipped).toEqual({ tables: {} });
    });

    it("the layers a consumer folds itself: the file, the rows, the person's — the file once in development", async () => {
        const store = memoryStore();
        await store.save({ scope: "workspace" }, "posts", { icon: "Article" }, { updatedBy: "u_admin" });
        await store.save({ scope: "user", uid: "u_editor" }, "posts", { defaultSize: "s" }, { updatedBy: "u_editor" });

        const deployed = composableLayers(await readUiPreferenceLayers({ store, shippedFile }, "u_editor"));
        expect(deployed).toEqual({
            file: { tables: { posts: { name: "Articles", fields: { status: { enumLabels: { draft: "WIP" } } } } } },
            workspace: { tables: { posts: { icon: "Article" } } },
            user: { tables: { posts: { defaultSize: "s" } } }
        });
        // A caller that is not a person (an API key) has no user layer.
        expect((await readUiPreferenceLayers({ store, shippedFile })).user).toEqual({ tables: {} });

        // In development the workspace layer is the file: not folded twice.
        const dev = composableLayers(await readUiPreferenceLayers({ store, workspaceFile: shippedFile, shippedFile: path.join(dir, "absent.json") }, "u_editor"));
        expect(dev.file.tables.posts?.name).toBe("Articles");
        expect(dev.workspace).toEqual({ tables: {} });
    });
});
