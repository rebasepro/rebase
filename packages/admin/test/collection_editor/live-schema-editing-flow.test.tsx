/**
 * The plan-then-confirm flow, from the caller's side.
 *
 * What matters here is not that a dialog renders — it is that a save does not
 * complete until somebody has said so, and that saying no reaches the caller as
 * a rejection. A flow that resolved on cancel would leave the editor believing
 * it had saved: the collection on screen would differ from the one on disk, and
 * the *next* save would be computed from the wrong `before`.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, render, screen, waitFor } from "@testing-library/react";

import {
    useLiveSchemaEditing,
    SchemaChangeCancelled
} from "../../src/collection_editor/useLiveSchemaEditing";
import type {
    LiveSchemaClient,
    LiveSchemaPlan,
    LiveSchemaResult
} from "../../src/collection_editor/liveSchemaClient";

const SAFE_PLAN: LiveSchemaPlan = {
    applicable: true,
    verdict: "safe",
    changes: [{
        kind: "add-property",
        verdict: "safe",
        collection: "posts",
        property: "subtitle",
        detail: 'New optional property "subtitle" — adds column "subtitle".'
    }],
    statements: ['ALTER TABLE "public"."posts" ADD COLUMN IF NOT EXISTS "subtitle" TEXT;'],
    files: ["backend/src/collections/posts.ts", "drizzle/schema.sql"],
    message: "feat(schema): add subtitle to posts",
    withheldConstraints: []
};

const REFUSED_PLAN: LiveSchemaPlan = {
    applicable: false,
    verdict: "needs-migration",
    changes: [{
        kind: "remove-property",
        verdict: "needs-migration",
        collection: "posts",
        property: "subtitle",
        detail: '"subtitle" was removed, which would drop column "subtitle" and its data.',
        remedy: "The ensure path never drops a column."
    }],
    statements: [],
    files: [],
    message: "feat(schema): 1 change(s) to posts",
    withheldConstraints: []
};

const APPLIED: LiveSchemaResult = {
    applied: true,
    committed: { sha: "abc123def456", branch: "main", files: ["backend/src/collections/posts.ts"] },
    statements: SAFE_PLAN.statements,
    summary: "Committed abc123def on main and applied 1 statement(s).",
    withheldConstraints: []
};

const change = { collectionId: "posts", collection: { name: "Posts" } };

function fakeClient(over: Partial<LiveSchemaClient> = {}): LiveSchemaClient {
    return {
        status: jest.fn(async () => ({ enabled: true, canPlan: true, repository: "/repo" })),
        plan: jest.fn(async () => SAFE_PLAN),
        apply: jest.fn(async () => APPLIED),
        ...over
    } as unknown as LiveSchemaClient;
}

/**
 * Drives the hook from a component, because that is the only way its dialog is
 * on screen to be pressed. `start` is exposed so a test can begin a review and
 * then interact with what appears.
 */
function Harness({ client, writeSourceOnly, onSettled }: {
    client: LiveSchemaClient;
    writeSourceOnly?: (c: typeof change) => Promise<void>;
    onSettled: (outcome: "resolved" | "rejected", err?: unknown) => void;
}) {
    const live = useLiveSchemaEditing({ baseUrl: "/api/admin/schema", client, writeSourceOnly });
    return (
        <div>
            <button onClick={() => {
                live.reviewChange(change).then(
                    () => onSettled("resolved"),
                    err => onSettled("rejected", err)
                );
            }}>start</button>
            {live.dialog}
        </div>
    );
}

const start = async () => {
    await act(async () => { screen.getByText("start").click(); });
};

describe("reviewing a schema change", () => {
    it("shows the plan and does not apply anything until it is confirmed", async () => {
        const client = fakeClient();
        const settled = jest.fn();
        render(<Harness client={client} onSettled={settled}/>);

        await start();

        await waitFor(() => expect(screen.getByText("Ready to apply")).toBeTruthy());
        expect(screen.getByText(/New optional property "subtitle"/)).toBeTruthy();

        // The whole point of a preview.
        expect(client.apply).not.toHaveBeenCalled();
        expect(settled).not.toHaveBeenCalled();
    });

    it("applies on confirm, and resolves the caller", async () => {
        const client = fakeClient();
        const settled = jest.fn();
        render(<Harness client={client} onSettled={settled}/>);

        await start();
        await waitFor(() => expect(screen.getByText("Ready to apply")).toBeTruthy());

        await act(async () => { screen.getByText("Commit and apply").click(); });

        await waitFor(() => expect(settled).toHaveBeenCalledWith("resolved"));
        expect(client.apply).toHaveBeenCalledWith(change);
        // The dialog becomes a receipt rather than closing.
        expect(screen.getByText(/Committed abc123def on main/)).toBeTruthy();
    });

    it("rejects the caller when the dialog is cancelled", async () => {
        const client = fakeClient();
        const settled = jest.fn();
        render(<Harness client={client} onSettled={settled}/>);

        await start();
        await waitFor(() => expect(screen.getByText("Ready to apply")).toBeTruthy());

        await act(async () => { screen.getByText("Cancel").click(); });

        await waitFor(() => expect(settled).toHaveBeenCalledTimes(1));
        const [outcome, err] = settled.mock.calls[0] as [string, unknown];
        expect(outcome).toBe("rejected");
        expect(err).toBeInstanceOf(SchemaChangeCancelled);
        expect(client.apply).not.toHaveBeenCalled();
    });

    it("cannot be confirmed when the change is refused", async () => {
        const client = fakeClient({ plan: jest.fn(async () => REFUSED_PLAN) as never });
        render(<Harness client={client} onSettled={jest.fn()}/>);

        await start();
        await waitFor(() => expect(screen.getByText("This needs a migration")).toBeTruthy());

        const confirm = screen.getByText("Commit and apply").closest("button");
        expect(confirm?.disabled).toBe(true);
    });

    it("offers the source-only fallback for a refused change", async () => {
        // Removing a property can never be applied — the ensure path has no
        // DROP COLUMN — and refusing the whole save over it would mean a dev
        // could not delete a field from a collection they are still designing.
        const client = fakeClient({ plan: jest.fn(async () => REFUSED_PLAN) as never });
        const writeSourceOnly = jest.fn(async () => {});
        const settled = jest.fn();
        render(<Harness client={client} writeSourceOnly={writeSourceOnly} onSettled={settled}/>);

        await start();
        await waitFor(() => expect(screen.getByText("Edit source only")).toBeTruthy());

        await act(async () => { screen.getByText("Edit source only").click(); });

        await waitFor(() => expect(settled).toHaveBeenCalledWith("resolved"));
        expect(writeSourceOnly).toHaveBeenCalledWith(change);
        expect(client.apply).not.toHaveBeenCalled();
    });

    it("shows a withheld constraint apart from the changes", async () => {
        const client = fakeClient({
            plan: jest.fn(async () => ({
                ...SAFE_PLAN,
                withheldConstraints: [{
                    target: "public.posts.subtitle",
                    kind: "not-null" as const,
                    reason: "posts already holds rows.",
                    remedy: "Backfill the column, then make it required."
                }]
            })) as never
        });
        render(<Harness client={client} onSettled={jest.fn()}/>);

        await start();

        await waitFor(() => expect(
            screen.getByText("One constraint will not be enforced")
        ).toBeTruthy());
        expect(screen.getByText(/Backfill the column/)).toBeTruthy();
        // Applicable, so it is still confirmable — this is information, not a
        // refusal, and conflating the two would teach people to ignore it.
        expect(screen.getByText("Commit and apply").closest("button")?.disabled).toBe(false);
    });

    it("reports a plan that failed, without pretending it succeeded", async () => {
        const client = fakeClient({
            plan: jest.fn(async () => { throw new Error("backend unreachable"); }) as never
        });
        const settled = jest.fn();
        render(<Harness client={client} onSettled={settled}/>);

        await start();

        await waitFor(() => expect(screen.getByText("backend unreachable")).toBeTruthy());
        expect(settled).not.toHaveBeenCalled();
        expect(screen.getByText("Commit and apply").closest("button")?.disabled).toBe(true);
    });

    it("keeps the dialog open when the apply fails, so the error is readable", async () => {
        const client = fakeClient({
            apply: jest.fn(async () => { throw new Error("the working tree is dirty"); }) as never
        });
        const settled = jest.fn();
        render(<Harness client={client} onSettled={settled}/>);

        await start();
        await waitFor(() => expect(screen.getByText("Ready to apply")).toBeTruthy());
        await act(async () => { screen.getByText("Commit and apply").click(); });

        await waitFor(() => expect(screen.getByText("the working tree is dirty")).toBeTruthy());
        expect(settled).not.toHaveBeenCalled();
    });
});
