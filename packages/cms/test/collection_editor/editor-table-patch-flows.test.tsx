/**
 * @jest-environment jsdom
 */
/**
 * The collection editor's controller against a server speaking the schema
 * editor's routes: `{ patches: TablePatch[] }` to `/admin/schema-editor/apply`
 * (source only) or `/admin/schema/plan` → `/apply` (live), presentation to the
 * UI preferences store and never to a schema route.
 *
 * Replaces the suites of the collection-patch wire format
 * (`collection-save-is-a-patch`, `every-write-is-reviewed`,
 * `live-schema-controller-wiring`, `duplicate-collection-relations`): every
 * capability they held is asserted here on the new wire.
 */
import React from "react";
import { describe, expect, it, beforeEach, jest } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RebaseI18nProvider } from "@rebasepro/app";
import type { AdminCollection, AdminPostgresCollection } from "@rebasepro/cms-types";
import type { TableDescriptor, UiTablePreferences } from "@rebasepro/types";

import { useLocalCollectionsConfigController, SchemaEditRefused, type PresentationWriter }
    from "../../src/collection_editor/useLocalCollectionsConfigController";
import type { CollectionsConfigController } from "../../src/collection_editor/types/config_controller";
import { collectionFromTable } from "../../src/tables";
import { column, posts, rules, table, tags, users, uuidId } from "../tables/fixtures";
import { fakeFetch, jsonResponse } from "../helpers/http";

const client = { baseUrl: "https://api.example.com", apiPath: "/api" };
const all = [posts, users, tags];
const project = (t: TableDescriptor): AdminPostgresCollection => collectionFromTable(t, { tables: all });

type Posted = { url: string; body: Record<string, unknown> };

interface BackendOptions {
    live?: boolean;
    /** An answer to the source-only `/apply`. */
    apply?: () => Response;
    tablesSummary?: unknown;
}

function backend({ live = false, apply, tablesSummary }: BackendOptions = {}) {
    const posted: Posted[] = [];
    global.fetch = fakeFetch(async (url, init) => {
        if (init?.method === "POST") posted.push({ url, body: JSON.parse(String(init.body)) });
        if (url.endsWith("/api/admin/schema/status")) {
            return jsonResponse(live
                ? { enabled: true, canPlan: true, canApply: true, repository: "/repo" }
                : { enabled: false, canPlan: false, canApply: false, code: "SCHEMA_EDITING_NO_REPOSITORY" });
        }
        if (url.endsWith("/api/admin/schema/plan")) {
            return jsonResponse({ applicable: true, verdict: "safe", changes: [], statements: ["ALTER TABLE posts ADD COLUMN subtitle text"], files: [], message: "", withheldConstraints: [] });
        }
        if (url.endsWith("/api/admin/schema/apply")) {
            return jsonResponse({ applied: true, committed: { sha: "abc", branch: "main", files: [] }, statements: [], summary: "done", withheldConstraints: [] });
        }
        if (url.endsWith("/api/admin/schema-editor/status")) return jsonResponse({ enabled: true });
        if (url.endsWith("/api/admin/schema-editor/tables")) return jsonResponse(tablesSummary ?? { tables: [] });
        if (url.endsWith("/api/admin/schema-editor/apply")) return apply ? apply() : jsonResponse({ success: true, files: [], tables: [] });
        return jsonResponse({}, { status: 404 });
    });
    return posted;
}

let controller: CollectionsConfigController;

function harness(collections: AdminCollection[], options: { presentation?: PresentationWriter; tables?: readonly TableDescriptor[] } = {}) {
    function Body() {
        controller = useLocalCollectionsConfigController(client, collections, { tables: options.tables ?? all, presentation: options.presentation });
        return <div>{controller.dialog}</div>;
    }
    return render(<RebaseI18nProvider locale="en"><Body/></RebaseI18nProvider>);
}

const run = async (fn: () => Promise<void>): Promise<unknown> => {
    let error: unknown;
    await act(async () => { await fn().catch(e => { error = e; }); });
    return error;
};

const writer = () => {
    const saved: { slug: string; delta: UiTablePreferences }[] = [];
    const presentation: PresentationWriter = { save: async (slug, delta) => { saved.push({ slug, delta }); } };
    return { saved, presentation };
};

const schemaPosts = (posted: Posted[]) => posted.filter(p => p.url.includes("/admin/schema"));

beforeEach(() => { jest.restoreAllMocks(); });

describe("a save on the source-only editor", () => {
    it("posts `{ patches }` to /schema-editor/apply, and the label to the preferences store", async () => {
        const posted = backend();
        const { saved, presentation } = writer();
        harness([project(posts)], { presentation });
        const before = project(posts);
        const after = project(posts);
        after.properties.subtitle = { type: "string", name: "Subtitle" };
        await run(() => controller.saveCollection({ id: "posts", baseline: before, collectionData: after }));

        const apply = posted.find(p => p.url.endsWith("/api/admin/schema-editor/apply"));
        expect(apply?.body).toEqual({ patches: [{ op: "addColumn", table: "posts", key: "subtitle", column: { type: { kind: "text" } } }] });
        expect(saved).toEqual([{ slug: "posts", delta: { fields: { subtitle: { name: "Subtitle" } } } }]);
    });

    it("writes nothing at all when nothing changed", async () => {
        const posted = backend();
        const { saved, presentation } = writer();
        harness([project(posts)], { presentation });
        await run(() => controller.saveCollection({ id: "posts", baseline: project(posts), collectionData: project(posts) }));
        expect(schemaPosts(posted)).toEqual([]);
        expect(saved).toEqual([]);
    });

    it("never sends presentation to a schema route", async () => {
        const posted = backend();
        const { saved, presentation } = writer();
        harness([project(posts)], { presentation });
        const after = project(posts);
        after.name = "Articles";
        after.properties.title.admin = { columnWidth: 300 };
        await run(() => controller.saveCollection({ id: "posts", baseline: project(posts), collectionData: after }));
        expect(schemaPosts(posted)).toEqual([]);
        expect(saved).toEqual([{ slug: "posts", delta: { name: "Articles", fields: { title: { columnWidth: 300 } } } }]);
    });

    it("refuses a presentation edit when there is no preferences store, rather than dropping it", async () => {
        backend();
        harness([project(posts)]);
        const after = project(posts);
        after.name = "Articles";
        const error = await run(() => controller.saveCollection({ id: "posts", baseline: project(posts), collectionData: after }));
        expect(String(error)).toMatch(/UI preference/);
    });

    it("surfaces an edit that does not compile with its problems, and writes no presentation", async () => {
        backend({
            apply: () => jsonResponse({
                error: {
                    code: "SCHEMA_EDIT_DOES_NOT_COMPILE",
                    message: "The edited schema does not compile.",
                    details: { problems: [{ table: "posts", key: "subtitle", message: "\"subtitle\" collides with a relation" }] }
                }
            }, { status: 400 })
        });
        const { saved, presentation } = writer();
        harness([project(posts)], { presentation });
        const after = project(posts);
        after.name = "Articles";
        after.properties.subtitle = { type: "string" };
        const error = await run(() => controller.saveCollection({ id: "posts", baseline: project(posts), collectionData: after }));
        expect(error).toBeInstanceOf(SchemaEditRefused);
        expect(error).toMatchObject({ code: "SCHEMA_EDIT_DOES_NOT_COMPILE", problems: [{ table: "posts", key: "subtitle" }] });
        expect(saved).toEqual([]);
    });

    it("adds and removes a property through the same door", async () => {
        const posted = backend();
        harness([project(posts)]);
        await run(() => controller.deleteProperty({ path: "posts", propertyKey: "publishDate" }));
        await run(() => controller.saveProperty({ path: "posts", propertyKey: "summary", property: { type: "string", columnType: "text" } }));
        expect(posted.filter(p => p.url.endsWith("/schema-editor/apply")).map(p => p.body)).toEqual([
            { patches: [{ op: "removeColumn", table: "posts", key: "publishDate" }] },
            { patches: [{ op: "addColumn", table: "posts", key: "summary", column: { type: { kind: "text" } } }] }
        ]);
    });

    it("saves a default filter and sort as presentation, removing a cleared key", async () => {
        const posted = backend();
        const { saved, presentation } = writer();
        harness([project(posts)], { presentation });
        await run(() => controller.updateCollection({ id: "posts", collectionData: { defaultFilter: { status: ["==", "draft"] }, sort: ["title", "asc"] } }));
        expect(schemaPosts(posted)).toEqual([]);
        expect(saved).toEqual([{ slug: "posts", delta: { sort: ["title", "asc"], defaultFilter: { status: ["==", "draft"] } } }]);
    });

    it("column order and kanban column order are preferences", async () => {
        const posted = backend();
        const { saved, presentation } = writer();
        harness([project(posts)], { presentation });
        const collection = project(posts);
        await run(() => controller.updatePropertiesOrder({ fullPath: "posts", parentCollectionSlugs: [], parentEntityIds: [], collection, newPropertiesOrder: ["title", "status"] }));
        await run(() => controller.updateKanbanColumnsOrder({ fullPath: "posts", parentCollectionSlugs: [], parentEntityIds: [], collection, kanbanColumnProperty: "status", newColumnsOrder: ["published", "draft"] }));
        expect(schemaPosts(posted)).toEqual([]);
        expect(saved).toEqual([
            { slug: "posts", delta: { fieldOrder: ["title", "status"] } },
            { slug: "posts", delta: { fields: { status: { enumOrder: ["published", "draft"] } } } }
        ]);
    });

    it("deletes a table as deleteTable", async () => {
        const posted = backend();
        harness([project(posts)]);
        await run(() => controller.deleteCollection({ id: "posts" }));
        expect(posted.find(p => p.url.endsWith("/schema-editor/apply"))?.body).toEqual({ patches: [{ op: "deleteTable", table: "posts" }] });
    });

    it("refuses to edit a collection that is not a table: it is defined in the frontend", async () => {
        const posted = backend();
        const events: AdminCollection = { slug: "fs_events", name: "Events", engine: "firestore", properties: { title: { type: "string" } } };
        harness([project(posts), events]);
        const error = await run(() => controller.saveProperty({ path: "fs_events", propertyKey: "when", property: { type: "date" } }));
        expect(error).toMatchObject({ code: "EXTERNAL_COLLECTION" });
        expect(String(error)).toMatch(/frontend\/src\/cms/);
        expect(schemaPosts(posted)).toEqual([]);
    });

    it("refuses a slug rename as a migration", async () => {
        backend();
        harness([project(posts)]);
        const error = await run(() => controller.saveCollection({ id: "posts", baseline: project(posts), collectionData: { ...project(posts), slug: "articles" } }));
        expect(error).toMatchObject({ code: "MIGRATION_REQUIRED" });
    });

    it("a duplicated collection keeps its relations, by target slug", async () => {
        const posted = backend();
        harness([project(posts)]);
        const duplicate: AdminPostgresCollection = { ...project(posts), slug: "articles", table: "articles", name: "Articles" };
        await run(() => controller.saveCollection({ id: "articles", collectionData: duplicate }));
        const created = posted.find(p => p.url.endsWith("/schema-editor/apply"))?.body.patches;
        expect(created).toEqual([expect.objectContaining({
            op: "createTable",
            table: expect.objectContaining({
                name: "articles",
                relations: {
                    author: expect.objectContaining({ kind: "belongsTo", target: "users" }),
                    tags: expect.objectContaining({ kind: "manyToMany", target: "tags" })
                }
            })
        })]);
    });
});

describe("with live schema editing on", () => {
    it("plans `{ patches }` and shows the review before anything is written", async () => {
        const posted = backend({ live: true });
        harness([project(posts)]);
        const after = project(posts);
        after.properties.subtitle = { type: "string" };
        await act(async () => {
            void controller.saveCollection({ id: "posts", baseline: project(posts), collectionData: after }).catch(() => undefined);
        });
        await waitFor(() => expect(posted.some(p => p.url.endsWith("/api/admin/schema/plan"))).toBe(true));
        expect(posted.find(p => p.url.endsWith("/api/admin/schema/plan"))?.body).toEqual({
            patches: [{ op: "addColumn", table: "posts", key: "subtitle", column: { type: { kind: "text" } } }]
        });
        expect(posted.some(p => p.url.endsWith("/schema-editor/apply"))).toBe(false);
        await waitFor(() => expect(screen.getByText("Review schema change")).toBeTruthy());
    });

    it.each([
        ["saveProperty", () => controller.saveProperty({ path: "posts", propertyKey: "summary", property: { type: "string" } })],
        ["deleteProperty", () => controller.deleteProperty({ path: "posts", propertyKey: "publishDate" })],
        ["deleteCollection", () => controller.deleteCollection({ id: "posts" })],
        ["updateCollection", () => controller.updateCollection({ id: "posts", collectionData: { history: false } })]
    ])("%s is planned, never written straight to source", async (_name, write) => {
        const posted = backend({ live: true });
        harness([project(posts)]);
        await act(async () => { void write().catch(() => undefined); });
        await waitFor(() => expect(posted.some(p => p.url.endsWith("/api/admin/schema/plan"))).toBe(true));
        expect(posted.some(p => p.url.endsWith("/schema-editor/apply"))).toBe(false);
    });
});

describe("what the editor may offer", () => {
    it("reads what is edited in code from GET /tables", async () => {
        backend({
            tablesSummary: {
                tables: [{
                    slug: "posts", name: "posts", kind: "table", file: "/p/backend/schema/posts.ts",
                    columns: [{ key: "title" }, { key: "slug", editedInCode: "`slug` is built by a helper." }],
                    relations: [{ name: "author" }],
                    rlsEditedInCode: "`rls` is a variable."
                }]
            }
        });
        harness([project(posts)]);
        await waitFor(() => expect(controller.tableSource?.("posts")).toBeDefined());
        expect(controller.tableSource?.("posts")).toEqual({
            file: "/p/backend/schema/posts.ts",
            fields: { slug: "`slug` is built by a helper." },
            rlsEditedInCode: "`rls` is a variable."
        });
    });

    it("is read-only for a caller who was served redacted rules", async () => {
        backend();
        const redacted = table("secrets", { columns: [uuidId(), column("value", { kind: "text" })], rls: rules([{ redacted: true, operation: "select", roles: ["admin"] }]) });
        const collection = collectionFromTable(redacted, { tables: [redacted] });
        harness([collection], { tables: [redacted] });
        await waitFor(() => expect(controller.readOnly).toBe(true));
        expect(controller.readOnlyReason).toMatch(/redacted/);
    });
});

describe("inherited rules", () => {
    const notes = table("notes", {
        columns: [uuidId(), column("body", { kind: "text" })],
        rls: { posture: "rules", inherited: true, rules: [{ operation: "select", access: "authenticated" }], defaultPolicies: true }
    });
    const edited = (): AdminPostgresCollection => {
        const after = collectionFromTable(notes, { tables: [notes] });
        after.securityRules = [...(after.securityRules ?? []), { operation: "insert", access: "authenticated" }];
        return after;
    };

    it("keeping \"inherit\" writes nothing", async () => {
        const posted = backend();
        harness([collectionFromTable(notes, { tables: [notes] })], { tables: [notes] });
        let settled: unknown = "pending";
        await act(async () => {
            void controller.saveCollection({ id: "notes", baseline: collectionFromTable(notes, { tables: [notes] }), collectionData: edited() })
                .then(() => { settled = "saved"; }, (e: unknown) => { settled = e; });
        });
        await waitFor(() => expect(screen.getByText(/defaultRls/)).toBeTruthy());
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: /cancel/i })); });
        await waitFor(() => expect(settled).not.toBe("pending"));
        expect(settled).toMatchObject({ name: "SchemaChangeCancelled" });
        expect(schemaPosts(posted)).toEqual([]);
    });

    it("detaching, once confirmed, writes the table's own rules", async () => {
        const posted = backend();
        harness([collectionFromTable(notes, { tables: [notes] })], { tables: [notes] });
        await act(async () => {
            void controller.saveCollection({ id: "notes", baseline: collectionFromTable(notes, { tables: [notes] }), collectionData: edited() }).catch(() => undefined);
        });
        await waitFor(() => expect(screen.getByText(/defaultRls/)).toBeTruthy());
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: /ok/i })); });
        await waitFor(() => expect(posted.some(p => p.url.endsWith("/schema-editor/apply"))).toBe(true));
        expect(posted.find(p => p.url.endsWith("/schema-editor/apply"))?.body).toEqual({
            patches: [{ op: "setRls", table: "notes", rls: [{ operation: "select", access: "authenticated" }, { operation: "insert", access: "authenticated" }] }]
        });
    });
});
