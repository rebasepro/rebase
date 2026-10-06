/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * The JS editor's result table offers "Open <collection> #<id>" on each row,
 * for the collection it thinks the rows came from. That collection was read off
 * the script's text, comments included. With two collections named it offered
 * both, so a row of one opened the other's row with the same id. And the panel it
 * opens edits as the signed-in administrator even when the rows were fetched as
 * the user picked in "Run as". The row actions (and the "Collections:" bar that
 * goes with them) now appear only when the rows can be put down to one
 * collection and were read as the signed-in user.
 */

const ROWS = { data: [{ id: 7, title: "Hello" }], meta: { total: 1, limit: 10, offset: 0, hasMore: false } };

const listUsersPaginated = jest.fn(async () => ({
    users: [
        { uid: "admin-1", email: "admin@example.test", displayName: null, photoURL: null, roles: ["admin"] },
        { uid: "user-b", email: "b@example.test", displayName: null, photoURL: null, roles: [] }
    ],
    total: 2,
    limit: 50,
    offset: 0
}));

/** Every collection hands back the same page: what is under test is the label put on it. */
const dataLayer = { collection: () => ({ find: async () => ROWS }) };

/** Stable across renders, as the real contexts are. */
const appContext = {
    authController: { user: { uid: "admin-1", email: "admin@example.test", displayName: null, roles: ["admin"] } }
};
const appClient = { admin: { listUsersPaginated }, data: dataLayer };
const apiConfig = { apiUrl: "http://api.test", apiPath: "/api", getAuthToken: async () => "admin-token" };
const registry = {
    collections: [
        { slug: "posts", name: "Posts", properties: { title: { type: "string" } } },
        { slug: "authors", name: "Authors", properties: { name: { type: "string" } } }
    ]
};

jest.mock("@rebasepro/app", () => ({
    useRebaseContext: () => appContext,
    useRebaseClient: () => appClient,
    useApiConfig: () => apiConfig,
    useSnackbarController: () => ({ open: jest.fn() }),
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
    useModeController: () => ({ mode: "light", setMode: jest.fn() }),
    useStudioUrlController: () => ({}),
    useStudioCollectionRegistry: () => registry,
    useStudioSidePanelController: () => ({ open: jest.fn(), close: jest.fn() }),
    IconForView: () => null,
    ErrorView: ({ error }: { error: unknown }) => <div role="alert">{String(error)}</div>,
    UserSelectPopover: ({ users, onUserSelected }: {
        users: Array<{ uid: string; email?: string | null }>;
        onUserSelected: (user: { uid: string } | null) => void;
    }) => (
        <div>
            {users.map((user) => (
                <button key={user.uid} onClick={() => onUserSelected(user)}>{`Run as ${user.email}`}</button>
            ))}
        </div>
    )
}));

jest.mock("@rebasepro/client", () => ({
    createRebaseClient: () => ({ data: dataLayer, setAuthTokenGetter: () => undefined, close: () => undefined }),
    createMemoryStorage: () => ({ getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
}));

jest.mock("../src/components/JSEditor/JSMonacoEditor", () => ({
    JSMonacoEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
        <textarea aria-label="Script" value={value} onChange={(e) => onChange(e.target.value)}/>
    )
}));

import { JSEditor } from "../src/components/JSEditor/JSEditor";

beforeEach(() => {
    localStorage.clear();
});

/** Run a script and wait until its rows are on screen as a table. */
async function runToTable(code: string) {
    fireEvent.change(screen.getByLabelText("Script"), { target: { value: code } });
    fireEvent.click(screen.getByRole("button", { name: /Run$/ }));
    await screen.findByText("studio_sql_rows");
}

const offersRowActions = () => screen.queryByText("studio_sql_collections_label") !== null;

describe("the JS editor's row actions", () => {
    it("are offered for rows read from the one collection the script names", async () => {
        render(<JSEditor/>);
        await runToTable(`return await client.data.collection("posts").find({ limit: 10 });`);

        expect(offersRowActions()).toBe(true);
        expect(screen.getByText("Posts")).toBeTruthy();
    });

    it("are not offered when the script names two collections, since the rows could be either's", async () => {
        render(<JSEditor/>);
        await runToTable(`
const authors = await client.data.collection("authors").find();
return await client.data.collection("posts").find({ limit: 10 });
`);

        expect(offersRowActions()).toBe(false);
    });

    it("do not take a collection named in a comment for the source of the rows", async () => {
        render(<JSEditor/>);
        await runToTable(`
// The ids come from client.data.collection("authors"), fetched elsewhere.
return { data: [{ id: 7, title: "Hello" }] };
`);

        expect(offersRowActions()).toBe(false);
    });

    it("are not offered for rows read as another user, since the editor they open runs as you", async () => {
        render(<JSEditor/>);
        fireEvent.click(await screen.findByRole("button", { name: "Run as b@example.test" }));
        await runToTable(`return await client.data.collection("posts").find({ limit: 10 });`);

        expect(offersRowActions()).toBe(false);
    });
});
