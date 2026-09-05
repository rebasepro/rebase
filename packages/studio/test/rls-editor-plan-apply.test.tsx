/**
 * @jest-environment jsdom
 */
import { en } from "../../app/src/locales/en";
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { render } from "@testing-library/react";

/**
 * Saving a policy on a collection-mapped table POSTed the rules straight to
 * `/schema-editor/collection/save`. No plan, no confirmation, no sight of the
 * SQL — while the identical edit made in the collection editor two tabs away
 * showed all three, because it went through `useLiveSchemaEditing`.
 *
 * Studio cannot import that hook (`@rebasepro/cms` is a *peer* of
 * `@rebasepro/studio`, which has to run without it), so it reaches it over the
 * Studio bridge. These assert the routing: with an editor mounted the save goes
 * to the bridge, and with none it falls back to the direct write that is the
 * only thing the hosted console has.
 */

const updateCollection = jest.fn<(id: string, patch: Record<string, unknown>) => Promise<void>>();
let editorAvailable = true;

const translation = {
    t: (key: string) => en[key as keyof typeof en] ?? key,
    i18n: { language: "en" }
};

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => translation,
    useNavigationGroupLabel: () => (group: string) => group,
    useStudioSchemaEditing: () => ({ available: editorAvailable, updateCollection }),
    useStudioCollectionRegistry: () => ({ collections: [], getCollection: () => undefined }),
    useStudioCapabilities: () => ({ codebase: true }),
    useApiBase: () => "http://api.test/api",
    useApiConfig: () => ({ getAuthToken: async () => "token" }),
    useRebaseContext: () => ({ databaseAdmin: undefined }),
    useSnackbarController: () => ({ open: jest.fn() }),
    ErrorView: () => null,
    ConfirmationDialog: ({ open, title }: { open: boolean; title: React.ReactNode }) =>
        open ? <div data-testid="confirm">{title}</div> : null
}));

import { RLSEditor } from "../src/components/RLSEditor/RLSEditor";

beforeEach(() => {
    updateCollection.mockReset();
    updateCollection.mockResolvedValue(undefined);
    editorAvailable = true;
    // Watched in both directions: the point of the bridge path is that it does
    // *not* reach the transport.
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => "" })) as never;
});

describe("the RLS editor's write path", () => {

    // The component is large and its load path needs a database; what these
    // assert is the routing decision, which lives in one callback.
    it("is the bridge when a collection editor is mounted", async () => {
        const { saveRules } = await import("../src/components/RLSEditor/saveRules");
        await saveRules(
            { available: true, updateCollection },
            { apiBase: "http://api.test/api", getAuthToken: async () => "token" },
            "posts",
            [{ name: "read_own" }]
        );

        expect(updateCollection).toHaveBeenCalledWith("posts", { securityRules: [{ name: "read_own" }] });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it("is the direct write when there is none", async () => {
        const { saveRules } = await import("../src/components/RLSEditor/saveRules");

        await saveRules(
            { available: false, updateCollection },
            { apiBase: "http://api.test/api", getAuthToken: async () => "token" },
            "posts",
            [{ name: "read_own" }]
        );

        expect(updateCollection).not.toHaveBeenCalled();
        expect(global.fetch).toHaveBeenCalled();
    });
});

describe("cancelling the plan dialog", () => {

    it("is an answer, not an error to report", async () => {
        const { isCancellation } = await import("../src/components/RLSEditor/saveRules");
        const cancelled = new Error("The schema change was not applied.");
        cancelled.name = "SchemaChangeCancelled";

        expect(isCancellation(cancelled)).toBe(true);
        expect(isCancellation(new Error("connect ECONNREFUSED"))).toBe(false);
    });
});

// Kept so the suite fails if the editor stops rendering at all.
describe("the editor still mounts", () => {
    it("renders without a database", () => {
        expect(() => render(<RLSEditor/>)).not.toThrow();
    });
});
