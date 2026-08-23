/**
 * That the config controller actually routes its saves through the review.
 *
 * `live-schema-editing-flow.test.tsx` proves the flow behaves once it is
 * entered. This proves it is entered — which is a separate claim, and the one
 * that silently regresses: reverting `write()` to read the *rendered* status
 * instead of awaiting the probe left every test in that file passing.
 *
 * The specific hazard is timing. `status` is undefined for one round trip after
 * mount, so a controller that reads it to choose a path sends a save issued in
 * that window down the source-only branch with no confirmation, while the same
 * save a second later opens a dialog. Nothing on screen distinguishes them.
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, render, screen, waitFor } from "@testing-library/react";

import { useLocalCollectionsConfigController }
    from "../../src/collection_editor/useLocalCollectionsConfigController";
import type { AdminCollection } from "@rebasepro/admin-types";

const client = { baseUrl: "https://api.example.com", apiPath: "/api" };

const posts = {
    id: "posts",
    slug: "posts",
    name: "Posts",
    properties: { title: { type: "string", name: "Title" } }
} as unknown as AdminCollection;

/**
 * A fetch that answers both probes and records every call, with the live-schema
 * status held open until the test releases it.
 */
function mockBackend() {
    const calls: string[] = [];
    let releaseLiveStatus: () => void = () => {};
    const liveStatusHeld = new Promise<void>(resolve => { releaseLiveStatus = resolve; });

    const json = (body: unknown) => ({
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body)
    }) as unknown as Response;

    global.fetch = (async (url: string) => {
        calls.push(String(url));
        if (String(url).endsWith("/api/admin/schema/status")) {
            await liveStatusHeld;
            return json({ enabled: true, canPlan: true, canApply: true, repository: "/repo" });
        }
        if (String(url).endsWith("/api/schema-editor/status")) {
            return json({ enabled: true });
        }
        if (String(url).endsWith("/api/admin/schema/plan")) {
            return json({
                applicable: true,
                verdict: "safe",
                changes: [],
                statements: [],
                files: [],
                message: "feat(schema): no change",
                withheldConstraints: []
            });
        }
        // The source-only editor's save. Reaching this is the failure.
        return json({ ok: true });
    }) as unknown as typeof fetch;

    return { calls, releaseLiveStatus };
}

function Harness({ onSettled }: { onSettled: (outcome: string) => void }) {
    const controller = useLocalCollectionsConfigController(client, [posts]);
    return (
        <div>
            <button onClick={() => {
                controller.saveCollection({ id: "posts", collectionData: posts as never })
                    .then(() => onSettled("resolved"), () => onSettled("rejected"));
            }}>save</button>
            {controller.dialog}
        </div>
    );
}

beforeEach(() => {
    jest.restoreAllMocks();
});

describe("saving through the controller", () => {
    it("waits for the live-schema answer before choosing a path", async () => {
        const { calls, releaseLiveStatus } = mockBackend();
        const settled = jest.fn();
        render(<Harness onSettled={settled}/>);

        // Saved while the live-schema probe is still in flight — the window a
        // controller reading the rendered status would get wrong.
        await act(async () => { screen.getByText("save").click(); });

        // Nothing has been written and nothing has resolved: it is waiting.
        expect(calls.some(u => u.endsWith("/collection/save"))).toBe(false);
        expect(settled).not.toHaveBeenCalled();

        await act(async () => { releaseLiveStatus(); });

        // Once the answer arrives it plans, and the dialog opens rather than
        // the save completing on its own.
        await waitFor(() => expect(screen.getByText("Ready to apply")).toBeTruthy());
        expect(calls.some(u => u.endsWith("/api/admin/schema/plan"))).toBe(true);
        expect(calls.some(u => u.endsWith("/collection/save"))).toBe(false);
        expect(settled).not.toHaveBeenCalled();
    });

    it("falls through to the source-only editor when live editing is off", async () => {
        const calls: string[] = [];
        const json = (body: unknown) => ({
            ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body)
        }) as unknown as Response;
        global.fetch = (async (url: string) => {
            calls.push(String(url));
            if (String(url).endsWith("/api/admin/schema/status")) {
                return json({ enabled: false, canPlan: false, canApply: false, code: "SCHEMA_EDITING_NO_REPOSITORY" });
            }
            return json({ enabled: true });
        }) as unknown as typeof fetch;

        const settled = jest.fn();
        render(<Harness onSettled={settled}/>);
        await act(async () => { screen.getByText("save").click(); });

        // Nothing about the editor may depend on the feature being there.
        await waitFor(() => expect(settled).toHaveBeenCalledWith("resolved"));
        expect(calls.some(u => u.endsWith("/collection/save"))).toBe(true);
        expect(calls.some(u => u.endsWith("/api/admin/schema/plan"))).toBe(false);
    });
});
