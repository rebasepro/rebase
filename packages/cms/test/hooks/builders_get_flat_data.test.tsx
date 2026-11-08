/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it } from "@jest/globals";
import { render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { DataDriver, RebaseSdkData } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";
import { Rebase } from "@rebasepro/app";

import { RebaseCMS } from "../../src/components/RebaseCMS";
import { RebaseNavigation } from "../../src/components/RebaseNavigation";

/**
 * `<RebaseCMS collections={({ data }) => …}>` and its `views` builder are
 * handed `data` that reads rows as the server sends them — the browser's
 * `context.data` — not the admin's `Entity` view model.
 */

const DUE = "2026-11-08T09:30:00.000Z";

const driver: DataDriver = {
    key: "memory",
    fetchCollection: async () => [{ id: 1, title: "First", due: DUE }],
    fetchOne: async () => ({ id: 1, title: "First", due: DUE }),
    save: async ({ values }) => values,
    delete: async () => undefined,
    checkUniqueField: async () => true
};

const tasks = {
    slug: "tasks",
    name: "Tasks",
    properties: { title: { type: "string", name: "Title" }, due: { type: "date", name: "Due" } }
} as unknown as AdminCollection;

const authController = {
    user: { uid: "u1", roles: ["admin"] },
    initialLoading: false,
    authLoading: false,
    loginSkipped: false,
    getAuthToken: async () => "t",
    signOut: async () => undefined,
    extra: null,
    setExtra: () => undefined
} as never;

describe("the collection and view builders", () => {
    it("read rows as the server sends them", async () => {
        // The schema editor asks the backend whether it is on; nothing here answers.
        global.fetch = (async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => "" })) as unknown as typeof fetch;
        const seen: { collections?: unknown[]; views?: unknown[] } = {};
        const collections = async ({ data }: { data: RebaseSdkData }) => {
            seen.collections = (await data.collection("tasks").find()).data;
            return [tasks];
        };
        const views = async ({ data }: { data: RebaseSdkData }) => {
            seen.views = (await data.tasks.find()).data;
            return [];
        };
        const router = createMemoryRouter([{
            path: "*",
            element: (
                <Rebase authController={authController} storageSource={{} as never}
                    dataSources={[{ key: "(default)", engine: "postgres", driver }]}>
                    <RebaseCMS collections={collections} views={views}/>
                    <RebaseNavigation>{null}</RebaseNavigation>
                </Rebase>
            )
        }]);
        render(<RouterProvider router={router}/>);

        await waitFor(() => expect(seen.collections).toEqual([{ id: 1, title: "First", due: DUE }]));
        await waitFor(() => expect(seen.views).toEqual([{ id: 1, title: "First", due: DUE }]));
    });
});
