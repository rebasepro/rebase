/**
 * @jest-environment jsdom
 */
import { en } from "../../app/src/locales/en";
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BranchDiff, BranchInfo, BranchMergeResult } from "@rebasepro/types";

/**
 * The Branches pane's review of a branch: what it changed, side by side, and a
 * merge that says what wins before it writes. What is pinned is what a
 * reviewer relies on — the SQL of both sides, the rows, and that a merge with
 * conflicts cannot be sent until someone has chosen which side wins.
 */

const branch: BranchInfo = { name: "agent", database: "rb_agent", parentDatabase: "app", createdAt: new Date("2026-10-01T00:00:00Z") };

const DIFF: BranchDiff = {
    branch: "agent",
    branchDatabase: "rb_agent",
    targetDatabase: "app",
    schemas: ["public"],
    forkPointKnown: true,
    fingerprint: "fp-1",
    schema: [{
        object: "policy",
        change: "altered",
        schema: "public",
        table: "posts",
        name: "posts_write",
        before: "CREATE POLICY \"posts_write\" ON \"public\".\"posts\"\n    WITH CHECK ((author_id IS NOT NULL));",
        after: "CREATE POLICY \"posts_write\" ON \"public\".\"posts\"\n    WITH CHECK (((author_id IS NOT NULL) AND (title <> ''::text)));"
    }],
    data: [{
        schema: "public",
        table: "posts",
        collection: "posts",
        primaryKey: ["id"],
        inserted: 1,
        updated: 0,
        deleted: 0,
        conflicts: 1,
        targetChanges: 2,
        samples: [
            { change: "conflict", key: "[4]", before: { id: "4", views: "41" }, after: { id: "4", views: "400" }, changedColumns: ["views"] },
            { change: "inserted", key: "[50]", after: { id: "50", title: "agent post" } }
        ]
    }],
    sampleLimit: 100,
    computedAt: "2026-10-20T00:00:00.000Z"
};

const MERGED: BranchMergeResult = {
    branch: "agent",
    targetDatabase: "app",
    tables: [{ schema: "public", table: "posts", inserted: 1, updated: 1, deleted: 0 }],
    skipped: [],
    conflictsKept: 0,
    schemaChangesNotMerged: 1,
    warnings: []
};

const snackbar = { open: jest.fn() };

function interpolate(key: string, values?: Record<string, unknown>): string {
    const template = en[key as keyof typeof en] ?? key;
    return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ""));
}

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => ({ t: interpolate, i18n: { language: "en" } }),
    useApiBase: () => "http://backend/api",
    useApiConfig: () => ({ getAuthToken: async () => "token-1" }),
    useSnackbarController: () => snackbar,
    ErrorView: () => null
}));

import { BranchDiffView } from "../src/components/Branches/BranchDiffView";

type Answer = { status: number; body: unknown };
let mergeAnswer: Answer = { status: 200, body: MERGED };
const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    const answer: Answer = init?.method === "POST" ? mergeAnswer : { status: 200, body: DIFF };
    return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
});

beforeEach(() => {
    fetchMock.mockClear();
    snackbar.open.mockClear();
    mergeAnswer = { status: 200, body: MERGED };
    Object.defineProperty(globalThis, "fetch", { value: fetchMock, writable: true, configurable: true });
});

const diffCalls = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "GET");

describe("reviewing a branch", () => {
    it("reads the diff with the signed-in token, and shows both sides of each schema change", async () => {
        render(<BranchDiffView branch={branch} details={null}/>);
        expect(await screen.findByText("public.posts.posts_write")).toBeTruthy();
        expect(fetchMock.mock.calls[0][0]).toBe("http://backend/api/admin/branches/agent/diff");
        expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer token-1" });
        expect(screen.getByText("WITH CHECK ((author_id IS NOT NULL));")).toBeTruthy();
        expect(screen.getByText("WITH CHECK (((author_id IS NOT NULL) AND (title <> ''::text)));")).toBeTruthy();
    });

    it("lists the rows the branch changed, and counts the target's own apart", async () => {
        render(<BranchDiffView branch={branch} details={null}/>);
        await screen.findByText("public.posts.posts_write");
        fireEvent.click(screen.getByRole("tab", { name: /Data changes/ }));
        expect(await screen.findByText("50")).toBeTruthy();
        expect(screen.getByText("41")).toBeTruthy();
        expect(screen.getByText("400")).toBeTruthy();
        expect(screen.getByText(interpolate("studio_branch_diff_target_changes", { count: 2, target: "app" }))).toBeTruthy();
    });
});

describe("merging a branch", () => {
    async function openMerge() {
        render(<BranchDiffView branch={branch} details={null}/>);
        await screen.findByText("public.posts.posts_write");
        fireEvent.click(screen.getByRole("button", { name: "Merge into app" }));
        await screen.findByText(interpolate("studio_branch_diff_merge_conflicts", { count: 1 }));
    }

    it("cannot be sent with a conflict until someone chooses which side wins", async () => {
        await openMerge();
        // Asked for afresh each time: the stubbed dialog is remounted on every
        // render, so a button held across one is no longer on the page.
        const confirm = () => screen.getByRole("button", { name: "Merge" });
        expect(confirm().hasAttribute("disabled")).toBe(true);

        fireEvent.click(screen.getByRole("radio", { name: "The branch's (agent)" }));
        await waitFor(() => expect(confirm().hasAttribute("disabled")).toBe(false));
        fireEvent.click(confirm());

        await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
        const [url, init] = fetchMock.mock.calls.find(([, call]) => call?.method === "POST") ?? [];
        expect(url).toBe("http://backend/api/admin/branches/agent/merge");
        expect(JSON.parse(String(init?.body))).toEqual({ expectedFingerprint: "fp-1", onConflict: "branch", skipBlocked: false });
        await waitFor(() => expect(snackbar.open).toHaveBeenCalledWith(expect.objectContaining({ type: "success" })));
    });

    it("reloads the diff, rather than merging again, when the one on screen went stale", async () => {
        mergeAnswer = { status: 409, body: { error: { code: "BRANCH_DIFF_STALE", message: "The branch changed since the diff was read." } } };
        await openMerge();
        fireEvent.click(screen.getByRole("radio", { name: "The branch's (agent)" }));
        await waitFor(() => expect(screen.getByRole("button", { name: "Merge" }).hasAttribute("disabled")).toBe(false));
        fireEvent.click(screen.getByRole("button", { name: "Merge" }));

        await waitFor(() => expect(diffCalls()).toHaveLength(2));
        expect(snackbar.open).toHaveBeenCalledWith({ type: "warning", message: "The branch changed since the diff was read." });
    });
});
