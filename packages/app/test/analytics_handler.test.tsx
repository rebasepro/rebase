import React from "react";
import { act, render } from "@testing-library/react";
import type { AnalyticsController } from "@rebasepro/cms-types";
import { Rebase } from "../src/core/Rebase";
import { useAnalyticsController } from "../src/hooks/useAnalyticsController";
import { fakeAuthController, fakeClient, fakeStorageSource, fakeUser } from "./helpers/fakes";

/**
 * `<Rebase onAnalyticsEvent>` was memoised with no dependencies, so the admin
 * called the handler from the first render forever. An inline handler gated on
 * consent — the ordinary way to write one — kept the consent it was created
 * with: it went on sending after the visitor opted out, or never sent after
 * they opted in.
 */

const storageSource = fakeStorageSource();

const authController = fakeAuthController({
    user: fakeUser({ uid: "u1" }),
    initialLoading: false,
    authLoading: false,
    loginSkipped: true,
    getAuthToken: async () => "t"
});

const client = fakeClient({ fetchStorageSources: async () => [] });

function renderWithHandler(handler: ((event: string) => void) | undefined) {
    const seen: { current?: AnalyticsController } = {};
    function Probe() {
        seen.current = useAnalyticsController();
        return null;
    }
    const tree = (onAnalyticsEvent: typeof handler) => (
        <Rebase authController={authController} client={client} storageSource={storageSource}
            onAnalyticsEvent={onAnalyticsEvent}>
            <Probe/>
        </Rebase>
    );
    const view = render(tree(handler));
    return { seen, rerender: (next: typeof handler) => view.rerender(tree(next)) };
}

describe("<Rebase onAnalyticsEvent>", () => {
    it("reaches the handler of the latest render", async () => {
        const first = jest.fn();
        const second = jest.fn();
        const { seen, rerender } = renderWithHandler(first);

        await act(async () => rerender(second));
        seen.current?.onAnalyticsEvent?.("new_entity_click");

        expect(second).toHaveBeenCalledWith("new_entity_click");
        expect(first).not.toHaveBeenCalled();
    });

    it("stops reporting once the handler is taken away", async () => {
        const handler = jest.fn();
        const { seen, rerender } = renderWithHandler(handler);

        await act(async () => rerender(undefined));
        seen.current?.onAnalyticsEvent?.("new_entity_click");

        expect(handler).not.toHaveBeenCalled();
    });
});
