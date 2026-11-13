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
    /** The schema editor's `/status`: off is production. */
    sourceEditor?: boolean;
    /** An answer to the frontend source editor's `/apply`. */
    frontendApply?: () => Response;
    /** An answer to the source-only `/apply`. */
    apply?: () => Response;
    tablesSummary?: unknown;
    /** `GET /unmapped-tables` and `GET /unmapped-tables/public/<table>`, by table. */
    unmapped?: { list: unknown; described: Record<string, unknown> };
}

function backend({ live = false, apply, tablesSummary, sourceEditor = true, frontendApply, unmapped }: BackendOptions = {}) {
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
        if (url.endsWith("/api/admin/schema-editor/status")) {
            return jsonResponse(sourceEditor ? { enabled: true } : { enabled: false, code: "SCHEMA_EDITOR_PRODUCTION", reason: "The schema editor is off under NODE_ENV=production." });
        }
        if (url.includes("/api/admin/schema-editor/frontend/calls")) {
            return jsonResponse({
                calls: [{
                    value: "fs_events", file: "frontend/src/cms/events.ts", version: "v1",
                    members: { "fields.legacy": "`fields.legacy` is `legacyField`, not an object written in the call." }
                }]
            });
        }
        if (url.endsWith("/api/admin/schema-editor/frontend/apply")) return frontendApply ? frontendApply() : jsonResponse({ success: true, files: [] });
        if (url.endsWith("/api/admin/schema-editor/tables")) return jsonResponse(tablesSummary ?? { tables: [] });
        if (unmapped && url.endsWith("/api/admin/schema-editor/unmapped-tables")) return jsonResponse(unmapped.list);
        const describedTable = /\/api\/admin\/schema-editor\/unmapped-tables\/public\/(\w+)$/.exec(url)?.[1];
        if (unmapped && describedTable) return jsonResponse({ table: unmapped.described[describedTable] });
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

describe("a Firestore collection, defined in the frontend", () => {
    const events = (): AdminCollection => ({
        slug: "fs_events",
        name: "Events",
        engine: "firestore",
        dataSource: "firestore",
        properties: {
            title: { name: "Title", type: "string", validation: { required: true } },
            customerId: { name: "Customer", type: "reference", path: "customers" }
        }
    });
    const frontendPosts = (posted: Posted[]) => posted.filter(p => p.url.includes("/schema-editor/frontend/"));

    it("is editable on a development server, and says what is edited in code", async () => {
        backend();
        harness([project(posts), events()]);
        await waitFor(() => expect(controller.frontendCollectionsEditable).toBe(true));
        await waitFor(() => expect(controller.tableSource?.("fs_events")).toBeDefined());
        expect(controller.tableSource?.("fs_events")).toEqual({
            file: "frontend/src/cms/events.ts",
            fields: { legacy: "`fields.legacy` is `legacyField`, not an object written in the call." }
        });
    });

    it("a label, a type and a rule are one edit of its definition, with the file's version; nothing goes to the schema or the preferences", async () => {
        const posted = backend();
        const { saved, presentation } = writer();
        harness([project(posts), events()], { presentation });
        await waitFor(() => expect(controller.tableSource?.("fs_events")).toBeDefined());
        const after = events();
        after.properties.title = { name: "Headline", type: "string", validation: { required: true, max: 80 } };
        after.properties.customerId = { name: "Customer", type: "string" };
        await run(() => controller.saveCollection({ id: "fs_events", baseline: events(), collectionData: after }));

        expect(frontendPosts(posted)).toEqual([{
            url: "https://api.example.com/api/admin/schema-editor/frontend/apply",
            body: {
                target: { callee: "defineFirestoreCollection", key: "slug", value: "fs_events" },
                version: "v1",
                operations: [
                    { op: "set", path: ["fields", "title", "name"], value: "Headline" },
                    { op: "set", path: ["fields", "title", "validation"], value: { max: 80 } },
                    { op: "set", path: ["fields", "customerId", "type"], value: "string" },
                    { op: "remove", path: ["fields", "customerId", "target"] }
                ]
            }
        }]);
        expect(posted.filter(p => p.url.endsWith("/schema-editor/apply") || p.url.includes("/admin/schema/"))).toEqual([]);
        expect(saved).toEqual([]);
    });

    it("adding and removing a field, through saveProperty and deleteProperty", async () => {
        const posted = backend();
        harness([project(posts), events()]);
        await waitFor(() => expect(controller.frontendCollectionsEditable).toBe(true));
        await run(() => controller.saveProperty({ path: "fs_events", propertyKey: "when", property: { name: "When", type: "date" } }));
        await run(() => controller.deleteProperty({ path: "fs_events", propertyKey: "customerId" }));
        expect(frontendPosts(posted).filter(p => p.url.endsWith("/apply")).map(p => p.body.operations)).toEqual([
            [{ op: "set", path: ["fields", "when"], value: { name: "When", type: "date" } }],
            [{ op: "remove", path: ["fields", "customerId"] }]
        ]);
    });

    it("a refusal of the source editor reaches the editor with its code", async () => {
        backend({
            frontendApply: () => jsonResponse({
                error: { code: "SCHEMA_EDIT_STALE_FILE", message: "frontend/src/cms/events.ts changed since the edit was prepared.", details: { problems: [] } }
            }, { status: 409 })
        });
        harness([events()]);
        await waitFor(() => expect(controller.frontendCollectionsEditable).toBe(true));
        const error = await run(() => controller.updateCollection({ id: "fs_events", collectionData: { name: "Live events" } }));
        expect(error).toBeInstanceOf(SchemaEditRefused);
        expect(error).toMatchObject({ code: "SCHEMA_EDIT_STALE_FILE" });
    });

    it("is read-only in production: no source editor writes the frontend", async () => {
        const posted = backend({ sourceEditor: false });
        harness([project(posts), events()]);
        await waitFor(() => expect(controller.readOnly).toBe(true));
        expect(controller.frontendCollectionsEditable).toBe(false);
        const error = await run(() => controller.saveProperty({ path: "fs_events", propertyKey: "when", property: { type: "date" } }));
        expect(error).toMatchObject({ code: "EXTERNAL_COLLECTION" });
        expect(String(error)).toMatch(/frontend\/src\/cms/);
        expect(frontendPosts(posted)).toEqual([]);
        expect(schemaPosts(posted)).toEqual([]);
    });

    it("is never deleted from the editor", async () => {
        const posted = backend();
        harness([events()]);
        const error = await run(() => controller.deleteCollection({ id: "fs_events" }));
        expect(error).toMatchObject({ code: "EXTERNAL_COLLECTION" });
        expect(String(error)).toMatch(/externalCollections/);
        expect(frontendPosts(posted)).toEqual([]);
    });
});

describe("importing an existing table", () => {
    /** As `GET …/unmapped-tables/public/comments` describes it: RLS off, so raised to "admin-only". */
    const comments = table("comments", {
        columns: [
            uuidId(),
            column("body", { kind: "text" }, { nullable: false }),
            column("score", { kind: "numeric", precision: 10, scale: 2 }),
            column("authorId", { kind: "uuid" }, { column: "author_id", foreignKeyOf: "author" })
        ],
        relations: [{ name: "author", kind: "belongsTo", target: "users", cardinality: "one", localKey: "author_id", localField: "authorId", index: true, constraint: true }],
        rls: { posture: "admin-only", rules: [], defaultPolicies: true }
    });
    const rlsRaised = "Row-level security is off on \"comments\", so today every request reaches every row. It is imported as \"admin-only\".";
    const unmapped = {
        list: { tables: [{ schema: "public", table: "comments", rlsEnabled: false, policies: 0 }] },
        described: { comments: { schema: "public", table: "comments", rlsEnabled: false, policies: 0, descriptor: comments, rlsRaised, notes: [] } }
    };

    it("lists the tables the schema editor offers, and opens one projected as a served table", async () => {
        backend({ unmapped });
        harness([project(posts)]);
        let listed: unknown;
        await run(async () => { listed = await controller.listUnmappedTables?.(); });
        expect(listed).toEqual([{ schema: "public", table: "comments", rlsEnabled: false, policies: 0, notes: [] }]);

        let imported: Awaited<ReturnType<NonNullable<CollectionsConfigController["describeUnmappedTable"]>>> | undefined;
        await run(async () => { imported = await controller.describeUnmappedTable?.("public", "comments"); });
        expect(imported?.table.rlsRaised).toBe(rlsRaised);
        expect(imported?.descriptor).toEqual(comments);
        // The same projection a served table gets: its foreign key a relation to the served `users`.
        const asData = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
        expect(asData(imported?.collection)).toEqual(asData(collectionFromTable(comments, { tables: [...all, comments] })));
        expect(imported?.collection.properties.author).toMatchObject({ type: "relation" });
    });

    it("saves an adoption of its description, then the person's edits, as one edit", async () => {
        const posted = backend({ unmapped });
        const { saved, presentation } = writer();
        harness([project(posts)], { presentation });
        const projected = collectionFromTable(comments, { tables: [...all, comments] });
        const after = { ...projected, name: "Reader comments", description: "What readers wrote." };
        await run(() => controller.saveCollection({ id: "comments", collectionData: after, adopting: comments }));

        const apply = posted.find(p => p.url.endsWith("/api/admin/schema-editor/apply"));
        expect(apply?.body).toEqual({
            patches: [
                { op: "adoptTable", table: comments },
                { op: "setOption", table: "comments", option: "description", value: "What readers wrote." }
            ]
        });
        expect(saved).toEqual([{ slug: "comments", delta: { name: "Reader comments" } }]);
    });

    it("adopts it unchanged when the person changed nothing", async () => {
        const posted = backend({ unmapped });
        harness([project(posts)]);
        await run(() => controller.saveCollection({ id: "comments", collectionData: collectionFromTable(comments, { tables: [...all, comments] }), adopting: comments }));
        expect(posted.find(p => p.url.endsWith("/api/admin/schema-editor/apply"))?.body).toEqual({ patches: [{ op: "adoptTable", table: comments }] });
    });
});
