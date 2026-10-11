/**
 * @jest-environment jsdom
 */
/**
 * With live schema editing on, every write the controller offers is planned
 * and shown before anything is written.
 *
 * `deleteProperty` and `updatePropertiesOrder` went straight to the
 * source-only editor: a plugin calling them removed a field from source with
 * no plan, no commit and no warning, while the same delete made in the
 * collection editor was planned and refused as a migration. A write method
 * added later is the next one to forget; this lists them all.
 */
import React from "react";
import { describe, expect, it, beforeEach, jest } from "@jest/globals";
import { act, render, waitFor } from "@testing-library/react";

import { useLocalCollectionsConfigController }
    from "../../src/collection_editor/useLocalCollectionsConfigController";
import type { CollectionsConfigController } from "../../src/collection_editor/types/config_controller";
import type { AdminCollection } from "@rebasepro/cms-types";

const client = { baseUrl: "https://api.example.com", apiPath: "/api" };

const books = (): AdminCollection => ({
    slug: "books",
    name: "Books",
    properties: {
        title: { type: "string", name: "Title" },
        summary: { type: "string", name: "Summary" }
    },
    propertiesOrder: ["title", "summary"]
}) as unknown as AdminCollection;

type Posted = { url: string; body: Record<string, unknown> };

function liveBackend() {
    const posted: Posted[] = [];
    const json = (body: unknown) => ({
        ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body)
    }) as unknown as Response;
    global.fetch = (async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") posted.push({ url: String(url), body: JSON.parse(String(init.body)) });
        if (String(url).endsWith("/api/admin/schema/status")) {
            return json({ enabled: true, canPlan: true, canApply: true, repository: "/repo" });
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

/** Every method of the controller that writes, with arguments that change something. */
const WRITES: Record<string, () => Promise<void>> = {
    saveCollection: () => controller.saveCollection({ id: "books", baseline: books(), collectionData: { ...books(), name: "Library" } }),
    updateCollection: () => controller.updateCollection({ id: "books", collectionData: { name: "Library" } as never }),
    saveProperty: () => controller.saveProperty({ path: "books", propertyKey: "isbn", property: { type: "string", name: "ISBN" } as never }),
    deleteProperty: () => controller.deleteProperty({ path: "books", propertyKey: "summary" }),
    updatePropertiesOrder: () => controller.updatePropertiesOrder({
        fullPath: "books", parentCollectionSlugs: [], parentEntityIds: [], collection: books(), newPropertiesOrder: ["summary", "title"]
    }),
    deleteCollection: () => controller.deleteCollection({ id: "books" })
};

beforeEach(() => { jest.restoreAllMocks(); });

describe("with live schema editing on", () => {
    it.each(Object.keys(WRITES))("%s is planned, and writes nothing on its own", async (method) => {
        const posted = liveBackend();
        render(<Harness/>);
        // Not awaited: the write settles only once the review is answered.
        await act(async () => { void WRITES[method]().catch(() => undefined); });

        await waitFor(() => expect(posted.some(p => p.url.endsWith("/api/admin/schema/plan"))).toBe(true));
        expect(posted.filter(p => p.url.includes("/schema-editor/"))).toEqual([]);
        expect(posted.filter(p => p.url.endsWith("/api/admin/schema/apply"))).toEqual([]);
    });
});
