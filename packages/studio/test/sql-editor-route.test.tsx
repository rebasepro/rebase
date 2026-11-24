/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { render, waitFor } from "@testing-library/react";

/**
 * `/sql?sqlDraft=…`: how other Studio views open SQL in the console. The
 * route hands the draft to the console, then takes `sqlDraft` — and only
 * `sqlDraft` — out of the URL: the hosted console keeps its open tab in
 * `?tab=`, and a draft read twice opened two tabs.
 */

const seen: { draft?: string | null }[] = [];

/**
 * `useSearchParams` over a URL held here, applied the way react-router applies
 * it: a function is called with the current params, and the navigation
 * options are recorded.
 */
const url = { search: "", navigations: [] as { replace?: boolean }[] };
jest.mock("react-router", () => {
    const ReactModule: typeof React = jest.requireActual("react");
    return {
        useSearchParams: () => {
            const [, rerender] = ReactModule.useReducer((n: number) => n + 1, 0);
            const params = new URLSearchParams(url.search);
            const set = (next: URLSearchParams | ((previous: URLSearchParams) => URLSearchParams), options?: { replace?: boolean }) => {
                const value = typeof next === "function" ? next(new URLSearchParams(url.search)) : next;
                url.search = value.toString();
                url.navigations.push(options ?? {});
                rerender();
            };
            return [params, set];
        }
    };
});

jest.mock("@rebasepro/app", () => ({
    useApiBase: () => "http://api.test/api",
    useApiConfig: () => ({ getAuthToken: async () => "token" }),
    useAuthController: () => ({ getAuthToken: async () => "token" })
}));

jest.mock("../src/components/SQLEditor/SQLEditor", () => {
    const ReactModule: typeof React = jest.requireActual("react");
    return {
        SQLEditor: ({ incomingDraft, onDraftConsumed }: { incomingDraft?: string | null; onDraftConsumed?: () => void }) => {
            seen.push({ draft: incomingDraft });
            ReactModule.useEffect(() => {
                if (incomingDraft) onDraftConsumed?.();
            }, [incomingDraft, onDraftConsumed]);
            return null;
        }
    };
});

import { SQLEditorRoute, SQL_DRAFT_PARAM } from "../src/components/SQLEditor/SQLEditorRoute";

describe("the console's draft handoff", () => {
    it("hands the decoded draft to the console, then removes only sqlDraft", async () => {
        const sql = "SELECT * FROM \"orders\" WHERE note = 'a&b=c'";
        url.search = `tab=database&${SQL_DRAFT_PARAM}=${encodeURIComponent(sql)}&other=1`;
        render(<SQLEditorRoute/>);

        expect(seen[0].draft).toBe(sql);
        await waitFor(() => expect(url.search).toBe("tab=database&other=1"));
        expect(url.navigations).toEqual([{ replace: true }]);
        expect(seen[seen.length - 1].draft).toBeNull();
    });
});
