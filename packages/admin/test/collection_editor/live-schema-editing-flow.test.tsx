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
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
    useLiveSchemaEditing,
    SchemaChangeCancelled,
    isSchemaChangeCancelled
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
        status: jest.fn(async () => ({
            enabled: true, canPlan: true, canApply: true, repository: "/repo"
        })),
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

/**
 * A caller who may preview but not apply.
 *
 * The signed-in-with-an-API-key case. The refusal has to arrive while they are
 * deciding, not after: reading a plan, agreeing to it, pressing the button and
 * *then* being told is the one ordering that wastes their attention entirely.
 */
describe("when the caller may not apply", () => {
    const readOnly = () => fakeClient({
        status: jest.fn(async () => ({
            enabled: true,
            canPlan: true,
            canApply: false,
            applyRefusedBecause: "This request is authenticated with an API key."
        })) as never
    });

    it("shows the plan, says why, and disables the button", async () => {
        render(<Harness client={readOnly()} onSettled={jest.fn()}/>);
        await start();

        await waitFor(() => expect(
            screen.getByText("You can preview this change, but not apply it")
        ).toBeTruthy());
        expect(screen.getByText(/authenticated with an API key/)).toBeTruthy();
        expect(screen.getByText("Commit and apply").closest("button")?.disabled).toBe(true);
    });

    it("still plans, because previewing has no side effects", async () => {
        const client = readOnly();
        render(<Harness client={client} onSettled={jest.fn()}/>);
        await start();

        await waitFor(() => expect(screen.getByText("Ready to apply")).toBeTruthy());
        expect(client.plan).toHaveBeenCalled();
        expect(client.apply).not.toHaveBeenCalled();
    });
});

/**
 * The window between mount and the backend's first answer.
 *
 * `status` is undefined for one round trip. A caller that read it to choose a
 * code path would take the "not available" branch for that window — so a save
 * issued quickly after a page load would skip the confirmation and write source
 * only, while the same save a second later would open a dialog. Nothing on
 * screen would distinguish the two.
 */
describe("before the backend has answered", () => {
    it("waits for the answer rather than assuming there is none", async () => {
        let answer: (s: unknown) => void = () => {};
        const client = fakeClient({
            status: jest.fn(() => new Promise(resolve => { answer = resolve; })) as never
        });

        const Waiter = () => {
            const live = useLiveSchemaEditing({ baseUrl: "/api/admin/schema", client });
            return (
                <div>
                    <button onClick={() => { void live.ready().then(s => {
                        (globalThis as Record<string, unknown>).__answered = s;
                    }); }}>ask</button>
                    {live.dialog}
                </div>
            );
        };
        render(<Waiter/>);

        // Asked while the probe is still in flight.
        await act(async () => { screen.getByText("ask").click(); });
        expect((globalThis as Record<string, unknown>).__answered).toBeUndefined();

        await act(async () => {
            answer({ enabled: true, canPlan: true, canApply: true });
        });

        await waitFor(() => expect(
            (globalThis as Record<string, unknown>).__answered
        ).toMatchObject({ enabled: true }));
    });

    it("asks the backend once, however many callers want the answer", async () => {
        const client = fakeClient();
        const Many = () => {
            const live = useLiveSchemaEditing({ baseUrl: "/api/admin/schema", client });
            return <button onClick={() => { void live.ready(); void live.ready(); }}>ask</button>;
        };
        render(<Many/>);
        await act(async () => { screen.getByText("ask").click(); });

        // The effect's probe and both explicit asks share one request.
        expect(client.status).toHaveBeenCalledTimes(1);
    });
});

/**
 * Cancelling is an answer, and callers have to be able to tell it apart.
 *
 * A save must *reject* when it is cancelled — resolving would leave the form
 * believing it saved. But the collection editor caught every rejection the same
 * way, so cancelling produced a console error and a red snackbar reading "Error
 * persisting collection: The schema change was not applied": the person's own
 * choice, reported back to them as a fault.
 */
describe("telling a cancellation from a failure", () => {
    it("recognises the cancellation", () => {
        expect(isSchemaChangeCancelled(new SchemaChangeCancelled())).toBe(true);
    });

    it("does not swallow a real failure", () => {
        expect(isSchemaChangeCancelled(new Error("the working tree is dirty"))).toBe(false);
        expect(isSchemaChangeCancelled("cancelled")).toBe(false);
        expect(isSchemaChangeCancelled(undefined)).toBe(false);
    });

    it("recognises one thrown by another copy of this module", () => {
        // Matched by name, not `instanceof`: two copies of the package in one
        // bundle give the class two identities, and an `instanceof` check then
        // answers false for a cancellation that is real. The editor would go
        // back to reporting it as an error, which is the bug this guards.
        const fromElsewhere = new Error("The schema change was not applied.");
        fromElsewhere.name = "SchemaChangeCancelled";
        expect(isSchemaChangeCancelled(fromElsewhere)).toBe(true);
    });
});


/**
 * Two ways the dialog could settle a caller wrongly.
 *
 * Both are about a promise and a running operation disagreeing, which is the
 * failure this whole feature exists to make impossible.
 */
describe("settling the caller correctly", () => {
    it("settles the first review when a second replaces it", async () => {
        // A double-clicked save. `setPending` overwrote `resolve`/`reject` with
        // nobody left holding them, so the first promise never settled and the
        // editor's save simply never returned.
        const client = fakeClient();
        const settled: string[] = [];

        const Twice = () => {
            const live = useLiveSchemaEditing({ baseUrl: "/api/admin/schema", client });
            return (
                <div>
                    <button onClick={() => {
                        live.reviewChange({ collectionId: "a", collection: {} })
                            .then(() => settled.push("a:resolved"), () => settled.push("a:rejected"));
                        live.reviewChange({ collectionId: "b", collection: {} })
                            .then(() => settled.push("b:resolved"), () => settled.push("b:rejected"));
                    }}>start</button>
                    {live.dialog}
                </div>
            );
        };
        render(<Twice/>);
        await act(async () => { screen.getByText("start").click(); });

        await waitFor(() => expect(settled).toContain("a:rejected"));
        // The second is still open and waiting to be decided.
        expect(settled).not.toContain("b:resolved");
        expect(settled).not.toContain("b:rejected");
    });

    it("does not report a cancellation while the apply is still running", async () => {
        // Escape and the backdrop both reach `onClose`, and only the Cancel
        // *button* was disabled while applying. Closing mid-apply rejected the
        // caller as cancelled while the commit and DDL carried on — telling
        // somebody nothing happened while something did.
        let finishApply: (r: LiveSchemaResult) => void = () => {};
        const client = fakeClient({
            apply: jest.fn(() => new Promise(resolve => { finishApply = resolve; })) as never
        });
        const settled = jest.fn();
        render(<Harness client={client} onSettled={settled}/>);

        await start();
        await waitFor(() => expect(screen.getByText("Ready to apply")).toBeTruthy());
        await act(async () => { screen.getByText("Commit and apply").click(); });

        // Mid-apply. The Cancel *button* is disabled — but Escape does not go
        // through the button, it goes through the dialog's own dismiss. That is
        // the path that was unguarded, so that is the one to press.
        expect(screen.getByText("Cancel").closest("button")?.disabled).toBe(true);
        await act(async () => {
            fireEvent.keyDown(document.activeElement ?? document.body, {
                key: "Escape", code: "Escape", keyCode: 27
            });
        });

        // Nothing settled: the apply is still running and has not been answered.
        expect(settled).not.toHaveBeenCalled();

        await act(async () => { finishApply(APPLIED); });
        await waitFor(() => expect(settled).toHaveBeenCalledWith("resolved"));
        expect(settled).not.toHaveBeenCalledWith("rejected", expect.anything());
    });
});


/**
 * The dialog says what will happen, not what usually happens.
 *
 * A document database has no table to alter, and a relational change that only
 * moves source runs nothing either. Both are a commit — and calling either one
 * "apply" describes something that does not occur. The engine is never asked;
 * the plan is.
 */
describe("a change that runs nothing", () => {
    const noStatements = () => fakeClient({
        plan: jest.fn(async () => ({
            ...SAFE_PLAN,
            statements: [],
            changes: [{
                kind: "add-property",
                verdict: "safe" as const,
                collection: "posts",
                property: "subtitle",
                detail: 'New property "subtitle". Existing documents do not have it.'
            }]
        })) as never
    });

    it("offers to commit, not to apply", async () => {
        render(<Harness client={noStatements()} onSettled={jest.fn()}/>);
        await start();

        await waitFor(() => expect(screen.getByText("Ready to commit")).toBeTruthy());
        expect(screen.getByText("Commit")).toBeTruthy();
        expect(screen.queryByText("Commit and apply")).toBeNull();
    });

    it("does not claim anything runs against the database", async () => {
        render(<Harness client={noStatements()} onSettled={jest.fn()}/>);
        await start();

        await waitFor(() => expect(screen.getByText("Ready to commit")).toBeTruthy());
        expect(screen.getByText(/Nothing runs against the database/)).toBeTruthy();
        // And no empty "Statements (0)" disclosure to click into.
        expect(screen.queryByText(/Statements that will run/)).toBeNull();
    });

    it("still says apply when there is DDL", async () => {
        render(<Harness client={fakeClient()} onSettled={jest.fn()}/>);
        await start();
        await waitFor(() => expect(screen.getByText("Ready to apply")).toBeTruthy());
        expect(screen.getByText("Commit and apply")).toBeTruthy();
    });
});

describe("where the commit lands", () => {
    it("is on screen before the button, not only in the receipt", async () => {
        // A commit is going somewhere, and which branch it is going to is the
        // one fact somebody cannot recover from being wrong about.
        const client = fakeClient({
            status: jest.fn(async () => ({
                enabled: true, canPlan: true, canApply: true,
                repository: "acme/storefront", branch: "main"
            })) as never
        });
        render(<Harness client={client} onSettled={jest.fn()}/>);
        await start();

        await waitFor(() => expect(screen.getByText(/acme\/storefront/)).toBeTruthy());
        expect(screen.getByText(/main/)).toBeTruthy();
    });

    it("says nothing when the backend did not say", async () => {
        const client = fakeClient({
            status: jest.fn(async () => ({ enabled: true, canPlan: true, canApply: true })) as never
        });
        render(<Harness client={client} onSettled={jest.fn()}/>);
        await start();
        await waitFor(() => expect(screen.getByText("Ready to apply")).toBeTruthy());
        expect(screen.queryByText(/→/)).toBeNull();
    });
});


describe("the destination label", () => {
    it("shows a remote repository as owner/repo", async () => {
        const client = fakeClient({
            status: jest.fn(async () => ({
                enabled: true, canPlan: true, canApply: true,
                repository: "acme/storefront", branch: "main"
            })) as never
        });
        render(<Harness client={client} onSettled={jest.fn()}/>);
        await start();
        await waitFor(() => expect(screen.getByText(/acme\/storefront · main/)).toBeTruthy());
    });

    it("shows a local checkout by name, not by path", async () => {
        // The leading directories are the part nobody needs; which checkout is
        // the part they do.
        const client = fakeClient({
            status: jest.fn(async () => ({
                enabled: true, canPlan: true, canApply: true,
                repository: "/Users/someone/work/storefront", branch: "main"
            })) as never
        });
        render(<Harness client={client} onSettled={jest.fn()}/>);
        await start();
        await waitFor(() => expect(screen.getByText(/storefront · main/)).toBeTruthy());
        expect(screen.queryByText(/Users\/someone/)).toBeNull();
    });
});
