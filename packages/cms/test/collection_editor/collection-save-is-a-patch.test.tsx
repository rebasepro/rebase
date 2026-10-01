/**
 * The panel sends what the person changed, not the collection.
 *
 * The collection a save starts from and the one it ends at are the same view
 * model through JSON, so their difference cannot contain anything JSON dropped
 * — an entity action's handler, a property shared from another module, an
 * imported enum. The whole collection used to be posted and written back, and
 * every one of those was deleted from the file by a save that only renamed the
 * collection.
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, render, screen, waitFor } from "@testing-library/react";

import { useLocalCollectionsConfigController }
    from "../../src/collection_editor/useLocalCollectionsConfigController";
import type { CollectionsConfigController } from "../../src/collection_editor/types/config_controller";
import type { AdminCollection } from "@rebasepro/cms-types";

const client = { baseUrl: "https://api.example.com", apiPath: "/api" };

/** The panel's view of a collection whose file has code in it. */
const books = (): AdminCollection => ({
    slug: "books",
    name: "Books",
    properties: {
        title: { type: "string", name: "Title" },
        status: { type: "string", name: "Status", enum: [{ id: "draft", label: "Draft" }], Field: () => null }
    },
    icon: "Book",
    admin: {
        icon: "Book",
        entityActions: [{ key: "publish", name: "Publish", onClick: async () => undefined }]
    }
}) as unknown as AdminCollection;

type Posted = { url: string; body: Record<string, unknown> };

function backend(live: boolean) {
    const posted: Posted[] = [];
    const json = (body: unknown) => ({
        ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body)
    }) as unknown as Response;
    global.fetch = (async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") posted.push({ url: String(url), body: JSON.parse(String(init.body)) });
        if (String(url).endsWith("/api/admin/schema/status")) {
            return json(live
                ? { enabled: true, canPlan: true, canApply: true, repository: "/repo" }
                : { enabled: false, canPlan: false, canApply: false, code: "SCHEMA_EDITING_NO_REPOSITORY" });
        }
        if (String(url).endsWith("/api/admin/schema/plan")) {
            return json({ applicable: true, verdict: "safe", changes: [], statements: [], files: [], message: "", withheldConstraints: [] });
        }
        return json({ enabled: true });
    }) as unknown as typeof fetch;
    return posted;
}

let controller: CollectionsConfigController;
function Harness() {
    controller = useLocalCollectionsConfigController(client, [books()]);
    return <div>{controller.dialog}</div>;
}

beforeEach(() => { jest.restoreAllMocks(); });

const run = async (fn: () => Promise<void>) => {
    let error: unknown;
    await act(async () => { await fn().catch(e => { error = e; }); });
    return error;
};

describe("a collection save", () => {
    it("posts only the renamed key to the source-only editor", async () => {
        const posted = backend(false);
        render(<Harness/>);
        await run(() => controller.saveCollection({
            id: "books",
            baseline: books(),
            collectionData: { ...books(), name: "Books (renamed)" }
        }));

        const save = posted.find(p => p.url.endsWith("/collection/save"));
        expect(save?.body).toEqual({
            collectionId: "books",
            patch: [{ op: "set", path: ["name"], value: "Books (renamed)" }]
        });
    });

    it("plans only the renamed key on the live door", async () => {
        const posted = backend(true);
        render(<Harness/>);
        // Not awaited: the save settles only once the dialog is answered.
        await act(async () => {
            void controller.saveCollection({
                id: "books",
                baseline: books(),
                collectionData: { ...books(), name: "Books (renamed)" }
            }).catch(() => undefined);
        });

        await waitFor(() => expect(posted.some(p => p.url.endsWith("/api/admin/schema/plan"))).toBe(true));
        const plan = posted.find(p => p.url.endsWith("/api/admin/schema/plan"));
        expect(plan?.body).toEqual({
            collectionId: "books",
            patch: [{ op: "set", path: ["name"], value: "Books (renamed)" }]
        });
        await waitFor(() => expect(screen.getByText("Review schema change")).toBeTruthy());
    });

    it("writes nothing at all when nothing changed", async () => {
        const posted = backend(false);
        render(<Harness/>);
        await run(() => controller.saveCollection({ id: "books", baseline: books(), collectionData: books() }));
        expect(posted).toEqual([]);
    });

    it("sends a new collection whole", async () => {
        const posted = backend(false);
        render(<Harness/>);
        const tags = { slug: "tags", name: "Tags", properties: { label: { type: "string" } } } as unknown as AdminCollection;
        await run(() => controller.saveCollection({ id: "tags", collectionData: tags }));
        expect(posted.find(p => p.url.endsWith("/collection/save"))?.body).toEqual({
            collectionId: "tags",
            collectionData: JSON.parse(JSON.stringify(tags))
        });
    });

    it("adds a property as one key", async () => {
        const posted = backend(false);
        render(<Harness/>);
        await run(() => controller.saveProperty({
            path: "books",
            propertyKey: "summary",
            property: { type: "string", name: "Summary" } as never
        }));
        expect(posted.find(p => p.url.endsWith("/collection/save"))?.body).toEqual({
            collectionId: "books",
            patch: [{ op: "set", path: ["properties", "summary"], value: { type: "string", name: "Summary" } }]
        });
    });

    it("removes a property as one key, through the same door", async () => {
        const posted = backend(false);
        render(<Harness/>);
        await run(() => controller.deleteProperty({ path: "books", propertyKey: "title" }));
        expect(posted.find(p => p.url.endsWith("/collection/save"))?.body).toEqual({
            collectionId: "books",
            patch: [{ op: "remove", path: ["properties", "title"] }]
        });
        expect(posted.some(p => p.url.endsWith("/property/delete"))).toBe(false);
    });

    it("updates a default filter as two `admin` keys, whatever the rendered collection carries", async () => {
        const posted = backend(false);
        const rendered = {
            ...books(),
            dataSource: "(default)",
            engine: "postgres",
            defaultFilter: { status: ["==", "draft"] },
            properties: {
                ...books().properties,
                author: { type: "relation", relation: { kind: "belongsTo" }, resolvedRelation: { kind: "belongsTo" } }
            }
        } as unknown as AdminCollection;
        function Rendered() {
            controller = useLocalCollectionsConfigController(client, [rendered]);
            return null;
        }
        render(<Rendered/>);
        await run(() => controller.updateCollection({
            id: "books",
            collectionData: { defaultFilter: { status: ["==", "published"] }, sort: ["title", "asc"] } as never
        }));
        expect(posted.find(p => p.url.endsWith("/collection/save"))?.body).toEqual({
            collectionId: "books",
            patch: [
                { op: "set", path: ["admin", "defaultFilter", "status"], value: ["==", "published"] },
                { op: "set", path: ["admin", "sort"], value: ["title", "asc"] }
            ]
        });
    });

    it("removes a cleared default filter rather than writing it as empty", async () => {
        const posted = backend(false);
        const rendered = { ...books(), defaultFilter: { status: ["==", "draft"] } } as unknown as AdminCollection;
        function Rendered() {
            controller = useLocalCollectionsConfigController(client, [rendered]);
            return null;
        }
        render(<Rendered/>);
        await run(() => controller.updateCollection({ id: "books", collectionData: { defaultFilter: undefined } as never }));
        expect(posted.find(p => p.url.endsWith("/collection/save"))?.body).toEqual({
            collectionId: "books",
            patch: [{ op: "remove", path: ["admin", "defaultFilter"] }]
        });
    });
});

describe("deleting a collection", () => {
    it("is planned through the live door as a removal", async () => {
        const posted = backend(true);
        render(<Harness/>);
        await act(async () => { void controller.deleteCollection({ id: "books" }).catch(() => undefined); });
        await waitFor(() => expect(posted.some(p => p.url.endsWith("/api/admin/schema/plan"))).toBe(true));
        expect(posted.find(p => p.url.endsWith("/api/admin/schema/plan"))?.body).toEqual({ collectionId: "books", remove: true });
        expect(posted.some(p => p.url.endsWith("/collection/delete"))).toBe(false);
    });

    it("goes to the source-only editor when live editing is off", async () => {
        const posted = backend(false);
        render(<Harness/>);
        await run(() => controller.deleteCollection({ id: "books" }));
        expect(posted.find(p => p.url.endsWith("/collection/delete"))?.body).toEqual({ collectionId: "books" });
    });
});
