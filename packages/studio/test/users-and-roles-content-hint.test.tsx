/**
 * @jest-environment jsdom
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { useEnTranslation } from "./en-translation";

/**
 * A project with the CMS edits the same accounts in two places: Studio's
 * Users & roles (sign-in, roles, scopes) and the users table's collection
 * (its own columns). Neither said the other existed. The view's header now
 * names the collection when the CMS has one for the auth table, and says
 * nothing of it when there is none.
 */

const page: { collections: Record<string, { name: string }> } = { collections: {} };

jest.mock("@rebasepro/app", () => ({
    useApiBase: () => "/api",
    useApiConfig: () => ({ apiUrl: "http://localhost:3000", getAuthToken: async () => "test-token" }),
    useAuthController: () => ({ getAuthToken: async () => "test-token" }),
    useSnackbarController: () => ({ open: jest.fn() }),
    useTranslation: () => useEnTranslation(),
    useTableDescriptors: () => ({
        status: "ready",
        tables: [
            { name: "Users", slug: "users", table: "users", schema: "public", kind: "table", auth: {} },
            { name: "Posts", slug: "posts", table: "posts", schema: "public", kind: "table" }
        ]
    }),
    useStudioCollectionRegistry: () => ({ getCollection: (slug: string) => page.collections[slug] })
}));

import { UsersAndRolesView } from "../src/components/UsersAndRoles/UsersAndRolesView";

const originalFetch = globalThis.fetch;

beforeEach(() => {
    page.collections = {};
    Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: async (input: RequestInfo | URL) => {
            const url = String(input);
            const body = url.includes("/api/admin/users") ? { users: [] } : url.endsWith("/api/admin/roles") ? { roles: [] } : {};
            return { ok: true, status: 200, statusText: "OK", text: async () => JSON.stringify(body), json: async () => body };
        }
    });
});

afterEach(() => {
    Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: originalFetch });
});

describe("Users & roles beside the CMS", () => {
    it("says the users table's own columns are edited in its collection", async () => {
        page.collections = { users: { name: "Team members" } };
        render(<UsersAndRolesView/>);

        expect(await screen.findByText(/Sign-in accounts, roles and access scopes are managed here\./)).toBeTruthy();
        expect(screen.getByText(/edited as content, in Team members\./)).toBeTruthy();
    });

    it("does not mention a collection when the CMS has none for the users table", async () => {
        render(<UsersAndRolesView/>);

        expect(await screen.findByText("Sign-in accounts, roles and access scopes are managed here.")).toBeTruthy();
        expect(screen.queryByText(/edited as content/)).toBeNull();
    });
});
