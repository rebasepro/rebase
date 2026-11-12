/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it } from "@jest/globals";
import { render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { DataDriver, RebaseSdkData } from "@rebasepro/types";
import { Rebase } from "@rebasepro/app";

import { RebaseCMS } from "../../src/components/RebaseCMS";
import { RebaseNavigation } from "../../src/components/RebaseNavigation";
import { fakeAuthController, fakeStorageSource, fakeUser } from "../helpers/fakes";
import { fakeFetch, jsonResponse } from "../helpers/http";

/**
 * `<RebaseCMS views={({ data }) => …}>` is handed `data` that reads rows as
 * the server sends them — the browser's `context.data` — not the admin's
 * `Entity` view model.
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

const authController = fakeAuthController({ user: fakeUser("u1", { roles: ["admin"] }) });

describe("the views builder", () => {
    it("read rows as the server sends them", async () => {
        // The schema editor asks the backend whether it is on; nothing here answers.
        global.fetch = fakeFetch(async () => jsonResponse({}, { status: 404 }));
        const seen: { views?: unknown[]; byTable?: unknown[] } = {};
        const views = async ({ data }: { data: RebaseSdkData }) => {
            seen.views = (await data.tasks.find()).data;
            seen.byTable = (await data.table("tasks").find()).data;
            return [];
        };
        const router = createMemoryRouter([{
            path: "*",
            element: (
                <Rebase authController={authController} storageSource={fakeStorageSource()}
                    dataSources={[{ key: "(default)", engine: "postgres", driver }]}>
                    <RebaseCMS views={views}/>
                    <RebaseNavigation>{null}</RebaseNavigation>
                </Rebase>
            )
        }]);
        render(<RouterProvider router={router}/>);

        await waitFor(() => expect(seen.views).toEqual([{ id: 1, title: "First", due: DUE }]));
        expect(seen.byTable).toEqual([{ id: 1, title: "First", due: DUE }]);
    });
});
