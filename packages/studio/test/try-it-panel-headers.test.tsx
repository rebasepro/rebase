/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * The API explorer's "Try it" panel pre-filled every request with a
 * `rebase-branch` header that nothing on the server reads — so every request
 * carried an empty header, and the panel suggested a branch switch that does
 * not exist.
 */

jest.mock("@rebasepro/app", () => ({
    useRebaseContext: () => ({ authController: { user: null } }),
    UserSelectPopover: () => null
}));

import { TryItPanel } from "../src/components/ApiExplorer/TryItPanel";
import type { ParsedEndpoint } from "../src/components/ApiExplorer/types";

const listPosts: ParsedEndpoint = {
    id: "get-data-posts",
    method: "get",
    path: "/data/posts",
    shortPath: "/posts",
    summary: "List posts",
    description: "",
    tags: ["posts"],
    parameters: [],
    responses: {}
};

const fetchMock = jest.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    new Response("{}", { status: 200, statusText: "OK" }));

beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
    global.fetch = fetchMock;
});

describe("a fresh Try-it request", () => {
    it("sends no header the caller did not add", async () => {
        render(
            <TryItPanel
                endpoint={listPosts}
                apiUrl="http://api.test"
                getAuthToken={async () => null}
                user={null}
            />
        );

        fireEvent.click(screen.getByRole("button", { name: /Send Request/ }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        const [, init] = fetchMock.mock.calls[0];
        expect(init?.headers).toEqual({ "Content-Type": "application/json" });
    });
});
