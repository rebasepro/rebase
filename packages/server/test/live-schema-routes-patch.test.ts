/**
 * The live door takes a patch: what the person changed, not the collection.
 *
 * The plan needs the whole proposed collection, so it is built here as the
 * collection as it is with the patch applied — keeping every relation thunk,
 * handler and shared property the panel's JSON never carried. The write gets
 * the patch, and writes those keys alone.
 *
 * A caller that still posts a whole collection for one that exists gets the
 * same treatment: the difference from the collection as it is, written as a
 * patch, so no caller can delete what JSON dropped.
 */
import { Hono } from "hono";
import type { CollectionConfig, DatabaseAdmin, SchemaChangePlan } from "@rebasepro/types";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createLiveSchemaRoutes, proposedCollections, type ProposedChange } from "../src/api/live-schema-routes";
import type { SchemaEditRepository } from "../src/schema-edit/apply-schema-change";

const authors = { slug: "authors", name: "Authors", properties: { name: { type: "string" } } } as unknown as CollectionConfig;
const authorsThunk = () => authors;
const onSaveSuccess = () => undefined;

const posts = (): CollectionConfig => ({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        title: { name: "Title", type: "string" },
        author: { name: "Author", type: "relation", relation: { kind: "belongsTo", target: authorsThunk } }
    },
    callbacks: { onSaveSuccess },
    admin: { icon: "FileText" }
}) as unknown as CollectionConfig;

const okPlan = (): SchemaChangePlan => ({
    files: [{ path: "backend/src/schema.generated.ts", contents: "export const x = 1;" }],
    statements: [],
    classified: { changes: [], verdict: "safe", applicable: true },
    message: "chore(schema): no change"
});

function harness() {
    const planned: CollectionConfig[][] = [];
    const written: ProposedChange[] = [];
    const repository: SchemaEditRepository = {
        root: "/tmp/project",
        currentBranch: async () => "main",
        dirtyPaths: async () => [],
        writeFiles: async () => undefined,
        commit: async () => "abc123def456"
    };
    const admin = {
        planSchemaChange: async (_before: CollectionConfig[], after: CollectionConfig[]) => {
            planned.push(after);
            return okPlan();
        },
        executeSql: async () => ({ rows: [] })
    } as unknown as DatabaseAdmin;

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.use("/*", async (c, next) => {
        c.set("user", { uid: "u_1", roles: ["admin"], email: "ada@example.com" } as never);
        await next();
    });
    app.route("/api/schema", createLiveSchemaRoutes({
        getCollections: () => [posts(), authors],
        getAdmin: () => admin,
        getRepository: () => repository,
        writeSource: async (change) => {
            written.push(change);
            return [];
        }
    }));
    const post = (route: string, body: unknown) => app.fetch(new Request(`http://localhost/api/schema${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    }));
    return { post, planned, written };
}

describe("a patch through the live door", () => {
    it("plans the collection as it is with the patch applied, thunks and handlers kept", async () => {
        const { post, planned } = harness();
        const response = await post("/plan", {
            collectionId: "posts",
            patch: [{ op: "set", path: ["properties", "subtitle"], value: { name: "Subtitle", type: "string" } }]
        });
        expect(response.status).toBe(200);
        const proposed = planned[0].find(c => c.slug === "posts") as unknown as Record<string, any>;
        expect(Object.keys(proposed.properties)).toEqual(["title", "author", "subtitle"]);
        expect(proposed.properties.author.relation.target).toBe(authorsThunk);
        expect(proposed.callbacks.onSaveSuccess).toBe(onSaveSuccess);
    });

    it("hands the source writer the patch, not a collection", async () => {
        const { post, written } = harness();
        const patch = [{ op: "set", path: ["name"], value: "Articles" }];
        const response = await post("/apply", { collectionId: "posts", patch });
        expect(response.status).toBe(200);
        expect(written).toEqual([{ collectionId: "posts", patch }]);
    });

    it("turns a whole collection posted for an existing one into the patch of what differs", async () => {
        const { post, written } = harness();
        const whole = JSON.parse(JSON.stringify({ ...posts(), name: "Articles" }));
        // JSON dropped the callbacks block's handler and the relation's target.
        const response = await post("/apply", { collectionId: "posts", collection: whole });
        expect(response.status).toBe(200);
        expect(written).toEqual([{ collectionId: "posts", patch: [{ op: "set", path: ["name"], value: "Articles" }] }]);
    });

    it("never removes a key whose value is code because a whole collection left it out", async () => {
        const { post, written } = harness();
        const { callbacks: _callbacks, ...rest } = JSON.parse(JSON.stringify({ ...posts(), name: "Articles" }));
        await post("/apply", { collectionId: "posts", collection: rest });
        expect(written[0].patch).toEqual([{ op: "set", path: ["name"], value: "Articles" }]);
    });

    it("still takes a whole collection for one that does not exist yet", async () => {
        const { post, written } = harness();
        const collection = { name: "Tags", properties: { label: { type: "string" } } };
        await post("/apply", { collectionId: "tags", collection });
        expect(written).toEqual([{ collectionId: "tags", collection }]);
    });

    it("refuses a patch for a collection that does not exist", async () => {
        const { post } = harness();
        const response = await post("/plan", { collectionId: "tags", patch: [{ op: "set", path: ["name"], value: "x" }] });
        expect(response.status).toBe(400);
        expect(await response.text()).toMatch(/no collection/i);
    });

    it("refuses the runtime's resolved relation, before anything is written", async () => {
        const { post, written } = harness();
        const response = await post("/apply", {
            collectionId: "posts",
            patch: [{ op: "set", path: ["properties", "author", "resolvedRelation"], value: { kind: "belongsTo" } }]
        });
        expect(response.status).toBe(400);
        expect(await response.text()).toMatch(/resolvedRelation/);
        expect(written).toEqual([]);
    });

    it("refuses an unsafe column name that only a patch carries", async () => {
        const { post } = harness();
        const response = await post("/plan", {
            collectionId: "posts",
            patch: [{ op: "set", path: ["properties", "title", "columnName"], value: "x\"; DROP TABLE users; --" }]
        });
        expect(response.status).toBe(400);
        expect(await response.text()).toMatch(/columnName/);
    });

    it("links a relation target a patch names by slug", () => {
        const proposed = proposedCollections([posts(), authors], {
            collectionId: "posts",
            patch: [{ op: "set", path: ["properties", "editor"], value: { type: "relation", relation: { kind: "belongsTo", target: "authors" } } }]
        });
        const editor = (proposed.find(c => c.slug === "posts") as unknown as Record<string, any>).properties.editor;
        expect(editor.relation.target().slug).toBe("authors");
    });
});
