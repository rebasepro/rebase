/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AdminCollection } from "@rebasepro/cms-types";
import { CollectionsProvider } from "@rebasepro/cms";
import { db, InRebase } from "./recipe_harness";
import { ApprovalQueue } from "../../recipes/approval-queue";

// jsdom measures nothing: give the table a laptop-sized viewport.
jest.mock("react-use-measure", () => {
    const mod = jest.requireActual("react-use-measure") as { default?: (o?: unknown) => unknown };
    const actual = (typeof mod === "function" ? mod : mod.default) as (o?: unknown) => unknown;
    return (options?: { offsetSize?: boolean }) => {
        const real = actual(options) as [unknown, unknown];
        if (options?.offsetSize) return [real[0], { width: 1440, height: 900, top: 0, left: 0, bottom: 0, right: 0, x: 0, y: 0 }];
        return real;
    };
});

function commentsIn(viewMode: "table" | "cards"): AdminCollection {
    return {
        slug: "comments",
        name: "Comments",
        table: "comments",
        properties: {
            id: { type: "string", name: "Id", isId: "uuid" },
            text: { type: "string", name: "Text" },
            status: { type: "string", name: "Status" }
        },
        admin: { defaultViewMode: viewMode }
    } as unknown as AdminCollection;
}

function renderQueue(viewMode: "table" | "cards" = "table") {
    return render(
        <InRebase>
            <CollectionsProvider collections={[commentsIn(viewMode)]}><ApprovalQueue/></CollectionsProvider>
        </InRebase>
    );
}

/** The element of one row or card: the nearest ancestor of its text that holds its own Approve button. */
function rowOf(text: string): HTMLElement {
    let node: HTMLElement | null = screen.getByText(text);
    while (node && within(node).queryAllByRole("button", { name: "Approve" }).length !== 1) node = node.parentElement;
    if (!node) throw new Error(`No row with an Approve button holds ${text}`);
    return node;
}

describe("recipe: approval queue", () => {
    beforeEach(() => {
        db.failSaveOf = undefined;
        db.rows = {
            comments: [
                { id: "c1", text: "Great post", status: "pending" },
                { id: "c2", text: "Buy cheap watches", status: "pending" },
                { id: "c3", text: "Already fine", status: "approved" }
            ]
        };
    });

    it("lists only the rows waiting for review, and how many there are", async () => {
        renderQueue();
        await screen.findByText("Great post");
        expect(screen.getByText("Buy cheap watches")).toBeTruthy();
        expect(screen.queryByText("Already fine")).toBeNull();
        expect(await screen.findByText("2 waiting")).toBeTruthy();
    });

    it("approves a row from the table, which leaves the queue", async () => {
        renderQueue("table");
        await screen.findByText("Great post");

        fireEvent.click(within(rowOf("Great post")).getByRole("button", { name: "Approve" }));

        await waitFor(() => expect(db.rows.comments.find(c => c.id === "c1")?.status).toBe("approved"));
        await waitFor(() => expect(screen.queryByText("Great post")).toBeNull());
        expect(await screen.findByText("1 waiting")).toBeTruthy();
        expect(db.rows.comments.find(c => c.id === "c2")?.status).toBe("pending");
    });

    it("rejects a row from its card", async () => {
        renderQueue("cards");
        await screen.findByText("Buy cheap watches");
        // Cards, not table rows: a card has no Edit button, clicking it opens the record.
        expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();

        fireEvent.click(within(rowOf("Buy cheap watches")).getByRole("button", { name: "Reject" }));

        await waitFor(() => expect(db.rows.comments.find(c => c.id === "c2")?.status).toBe("rejected"));
        await waitFor(() => expect(screen.queryByText("Buy cheap watches")).toBeNull());
        expect(await screen.findByText("1 waiting")).toBeTruthy();
    });

    it("says why when a decision is refused, and keeps the row in the queue", async () => {
        db.failSaveOf = "c1";
        renderQueue();
        await screen.findByText("Great post");

        fireEvent.click(within(rowOf("Great post")).getByRole("button", { name: "Approve" }));

        expect(await screen.findByText(/Saving c1 was refused/)).toBeTruthy();
        expect(db.rows.comments.find(c => c.id === "c1")?.status).toBe("pending");
        expect(screen.getByText("Great post")).toBeTruthy();
        expect(screen.getByText("2 waiting")).toBeTruthy();
    });

    it("says when nothing is left", async () => {
        db.rows = { comments: [{ id: "c3", text: "Already fine", status: "approved" }] };
        renderQueue();
        expect(await screen.findByText("Nothing waiting")).toBeTruthy();
    });
});
