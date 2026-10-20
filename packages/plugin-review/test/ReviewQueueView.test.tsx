import React from "react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SnackbarProvider } from "notistack";
import { ApiConfigProvider } from "@rebasepro/app";
import { ReviewQueueView } from "../src/components/ReviewQueueView";
import type { ReviewConfig, StagedChange } from "../src/config";

const config: ReviewConfig = {
    collections: {
        orders: { mode: "staged-table",
agentRoles: ["agent"] },
        posts: { mode: "state-field",
field: "status",
pendingValue: "draft",
approvedValue: "published",
rejectedValue: "rejected" }
    }
};

const change = (id: string, overrides: Partial<StagedChange> = {}): StagedChange => ({
    id,
    collection_slug: "orders",
    operation: "update",
    target_record_id: "7",
    before_data: { id: 7,
total: 10,
status: "open" },
    proposed_data: { total: 12,
status: "open" },
    status: "pending",
    actor_type: "api_key",
    actor_id: "key-1",
    actor_label: "rk_live_7c2… · outreach-agent",
    reason: "Customer asked for an upgrade",
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
    created_at: "2026-10-20T10:00:00.000Z",
    ...overrides
});

const IDS = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];

type Call = { url: string; method: string; body: unknown };

/** What the queue reads off a response — jsdom has no `Response`. */
type FakeResponse = Pick<Response, "ok" | "status" | "statusText" | "text">;

function json(body: unknown, status = 200): Promise<FakeResponse> {
    return Promise.resolve({ ok: status < 400,
status,
statusText: status < 400 ? "OK" : "Error",
text: async () => JSON.stringify(body) });
}

describe("ReviewQueueView", () => {
    let calls: Call[];
    let pending: StagedChange[];
    let rows: Record<string, unknown>[];

    beforeEach(() => {
        calls = [];
        pending = [
            change(IDS[0]),
            change(IDS[1], { operation: "insert",
target_record_id: null,
before_data: null,
proposed_data: { total: 5 },
reason: null }),
            change(IDS[2], { operation: "delete",
proposed_data: null,
actor_type: "user",
actor_label: "ana@example.com" })
        ];
        rows = [
            { id: "p1",
title: "First draft",
status: "draft" },
            { id: "p2",
title: "Second draft",
status: "draft" }
        ];
        const fake = jest.fn((input: RequestInfo | URL, init?: RequestInit): Promise<FakeResponse> => {
            const url = String(input);
            const method = init?.method ?? "GET";
            const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
            calls.push({ url,
method,
body });
            if (url.includes("/functions/review/changes?")) {
                return json({ data: pending,
meta: { total: pending.length,
limit: 100,
offset: 0,
hasMore: false } });
            }
            const decision = url.match(/\/functions\/review\/changes\/([^/]+)\/(approve|reject)$/);
            if (decision) {
                const decided = pending.find(entry => entry.id === decision[1])!;
                pending = pending.filter(entry => entry.id !== decision[1]);
                return json({ data: { ...decided,
status: decision[2] === "approve" ? "approved" : "rejected" } });
            }
            if (url.endsWith("/functions/review/changes/batch")) {
                const { ids, action } = body as { ids: string[]; action: string };
                const decided = pending.filter(entry => ids.includes(entry.id));
                pending = pending.filter(entry => !ids.includes(entry.id));
                return json({ data: decided.map(entry => ({ ...entry,
status: action === "approve" ? "approved" : "rejected" })) });
            }
            if (url.includes("/data/posts?")) return json({ data: rows.filter(row => row.status === "draft"),
meta: { total: rows.length } });
            const patch = url.match(/\/data\/posts\/([^/]+)$/);
            if (patch && method === "PATCH") {
                rows = rows.map(row => row.id === patch[1] ? { ...row,
...(body as object) } : row);
                return json({ ok: true });
            }
            return json({ error: { message: `unexpected ${method} ${url}` } }, 500);
        });
        global.fetch = fake as unknown as typeof fetch;
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    const renderQueue = (slug: string) => render(
        <SnackbarProvider>
            <ApiConfigProvider apiUrl="http://backend.test" getAuthToken={async () => "reviewer-token"}>
                <ReviewQueueView config={config} slug={slug}/>
            </ApiConfigProvider>
        </SnackbarProvider>
    );

    const items = () => screen.queryAllByRole("listitem");

    it("shows each change's operation, proposer, reason and field-by-field diff", async () => {
        renderQueue("orders");
        await waitFor(() => expect(items()).toHaveLength(3));
        const [update, insert, remove] = items();

        expect(within(update).getByText("UPDATE")).toBeTruthy();
        expect(within(update).getByText("rk_live_7c2… · outreach-agent")).toBeTruthy();
        expect(within(update).getByText("Customer asked for an upgrade")).toBeTruthy();
        const total = update.querySelector("[data-field=total]")!;
        expect(total.querySelector("del")?.textContent).toBe("10");
        expect(total.querySelector("ins")?.textContent).toBe("12");
        expect(total.querySelector("del")?.className).toContain("line-through");
        expect(total.querySelector("ins")?.className).toContain("text-emerald-400");
        expect(update.querySelector("[data-field=status]")?.getAttribute("data-kind")).toBe("unchanged");

        expect(within(insert).getByText("INSERT")).toBeTruthy();
        expect(within(insert).getByText("No reason given")).toBeTruthy();
        expect(within(remove).getByText("DELETE")).toBeTruthy();
        expect(remove.querySelector("[data-field=total] del")?.textContent).toBe("10");
        expect(calls[0].url).toBe("http://backend.test/api/functions/review/changes?collection=orders&status=pending&limit=100");
    });

    it("moves with j and k, approves the focused change with a and rejects with r", async () => {
        renderQueue("orders");
        await waitFor(() => expect(items()).toHaveLength(3));
        const queue = screen.getByTestId("review-queue");

        fireEvent.keyDown(queue, { key: "j" });
        expect(items()[1].getAttribute("aria-current")).toBe("true");
        fireEvent.keyDown(queue, { key: "k" });
        expect(items()[0].getAttribute("aria-current")).toBe("true");

        await act(async () => {
            fireEvent.keyDown(queue, { key: "a" });
        });
        await waitFor(() => expect(items()).toHaveLength(2));
        expect(calls.some(call => call.method === "POST" && call.url.endsWith(`/changes/${IDS[0]}/approve`))).toBe(true);

        await act(async () => {
            fireEvent.keyDown(queue, { key: "r" });
        });
        await waitFor(() => expect(items()).toHaveLength(1));
        expect(calls.some(call => call.url.endsWith(`/changes/${IDS[1]}/reject`))).toBe(true);
    });

    it("selects with Space and decides the selection in one batch", async () => {
        renderQueue("orders");
        await waitFor(() => expect(items()).toHaveLength(3));
        const queue = screen.getByTestId("review-queue");

        fireEvent.keyDown(queue, { key: " " });
        fireEvent.keyDown(queue, { key: "j" });
        fireEvent.keyDown(queue, { key: "j" });
        fireEvent.keyDown(queue, { key: " " });
        expect(screen.getByText("Approve 2")).toBeTruthy();

        await act(async () => {
            fireEvent.click(screen.getByText("Approve 2"));
        });
        await waitFor(() => expect(items()).toHaveLength(1));
        const batch = calls.find(call => call.url.endsWith("/changes/batch"));
        expect(batch?.body).toEqual({ action: "approve",
ids: [IDS[0], IDS[2]] });
        expect(within(items()[0]).getByText("INSERT")).toBeTruthy();
    });

    it("leaves keys typed into the note alone", async () => {
        renderQueue("orders");
        await waitFor(() => expect(items()).toHaveLength(3));
        const note = screen.getByPlaceholderText("Note for the proposer (optional)");
        fireEvent.keyDown(note, { key: "a" });
        expect(calls.filter(call => call.method === "POST")).toHaveLength(0);
    });

    it("approves a state-field row by setting its state to the approved value", async () => {
        renderQueue("posts");
        await waitFor(() => expect(items()).toHaveLength(2));
        expect(screen.getByText("Rows waiting in “draft”")).toBeTruthy();

        await act(async () => {
            fireEvent.click(within(items()[0]).getByText("Approve"));
        });
        await waitFor(() => expect(items()).toHaveLength(1));
        expect(calls.find(call => call.method === "PATCH")).toEqual({
            url: "http://backend.test/api/data/posts/p1",
            method: "PATCH",
            body: { status: "published" }
        });

        await act(async () => {
            fireEvent.keyDown(screen.getByTestId("review-queue"), { key: "r" });
        });
        await waitFor(() => expect(items()).toHaveLength(0));
        expect(calls.filter(call => call.method === "PATCH").at(-1)?.body).toEqual({ status: "rejected" });
        expect(screen.getByText("Nothing is waiting for review.")).toBeTruthy();
    });
});
