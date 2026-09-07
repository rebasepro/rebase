/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

/**
 * A record the URL names and the database does not have.
 *
 * Two failures met in this one branch.
 *
 * It logged `Entity with id undefined not found in collection posts` on every
 * successful *create*: `EntityFormBinding` sets `status` to `"existing"` the
 * moment a save lands, and the `entityId` prop arrives one render later from
 * the URL, so for one frame the component looked up a record with no id, found
 * nothing, and reported it as missing — two console errors beside a "Saved
 * successfully" toast. There is no id to look up, so nothing could have been
 * found; the state is in transit.
 *
 * And for a genuinely unknown id it rendered a bare, untranslated "Entity not
 * found" with no way out: the reader's only move was the browser's back button.
 */

/** What `useFetch` answers. Set per test. */
let fetched: { entity: unknown; dataLoading: boolean } = { entity: undefined, dataLoading: false };

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useFetch: () => ({ ...fetched, dataLoadingError: undefined }),
        usePermissions: () => ({ canEdit: () => true }),
        useAuthController: () => ({ user: { uid: "u1" } })
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { AuthControllerContext, RebaseI18nProvider } from "@rebasepro/app";
import { EditViewBinding } from "../../src/components/EditViewBinding";
import { UrlContext } from "../../src/hooks/navigation/contexts/UrlContext";

const collection = { name: "Posts", slug: "posts", properties: {} } as never;

const urlController = {
    basePath: "/",
    baseCollectionPath: "/c",
    urlPathToDataPath: () => "",
    homeUrl: "/",
    isUrlCollectionPath: () => true,
    buildUrlCollectionPath: (p: string) => `/c/${p}`,
    buildAppUrlPath: () => "",
    resolveDatabasePathsFrom: () => "",
    navigate: () => undefined
} as never;

function renderRecord(entityId: string | undefined, locale = "en", copy = false) {
    return render(
        <RebaseI18nProvider locale={locale}>
            <AuthControllerContext.Provider value={{ user: { uid: "u1" } } as never}>
            <MemoryRouter>
                <UrlContext.Provider value={urlController}>
                    <EditViewBinding
                        path="posts"
                        collection={collection}
                        entityId={entityId}
                        copy={copy}
                        parentCollectionSlugs={[]}
                        parentEntityIds={[]}
                    />
                </UrlContext.Provider>
            </MemoryRouter>
            </AuthControllerContext.Provider>
        </RebaseI18nProvider>
    );
}

/** Everything written to the console during a render, both channels. */
let logged: string[] = [];

beforeEach(() => {
    fetched = { entity: undefined, dataLoading: false };
    logged = [];
    const collect = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
    jest.spyOn(console, "error").mockImplementation(collect);
    jest.spyOn(console, "warn").mockImplementation(collect);
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe("a record that is not there", () => {

    it("says so, and offers the way back to its collection", () => {
        renderRecord("ghost-id");

        expect(screen.getByText("Entity not found")).toBeTruthy();
        const back = screen.getByRole("link", { name: "Back to Posts" });
        expect(back.getAttribute("href")).toBe("/c/posts");
    });

    it("is translated", () => {
        renderRecord("ghost-id", "es");

        expect(screen.getByRole("link", { name: "Volver a Posts" })).toBeTruthy();
        // The bare English label was the whole screen in every locale.
        expect(screen.queryByText("Entity not found")).toBeNull();
    });

    it("is not what a record with no id yet looks like", () => {
        // A copy with no source id reaches this branch from props alone; the
        // create transition reaches it the same way, one render after a save
        // lands and before the URL carries the new id. Both are "nothing to
        // look up", and neither is a missing record.
        //
        // Rendering the form itself needs the admin's own providers, so this
        // throws — and reaching the throw is the assertion. With the bug the
        // branch answered first, the render succeeded, and the screen said the
        // record was missing.
        expect(() => renderRecord(undefined, "en", true)).toThrow(/must be used inside <Rebase>/);

        expect(screen.queryByText("Entity not found")).toBeNull();
        expect(logged.join(" ")).not.toContain("not found in collection");
    });
});
