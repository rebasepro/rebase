/**
 * Backend storage-source discovery, and specifically what it is allowed to say
 * after the provider is gone.
 *
 * `<Rebase>` asks the backend for its storage sources on mount. A failure there
 * is routine — a 401 before login is the normal first answer — so it is reported
 * at `debug` and the effect retries when auth changes. What makes it worth a
 * test is the timing: the request outlives the provider by however long the
 * network takes to give up, which for an unreachable host is seconds. A write on
 * that path is therefore a write at an arbitrary later moment, long after
 * whatever rendered the provider has finished. Inside a test worker "later" can
 * be after the file completed, which closes the run's console channel mid-write
 * and fails a suite in which every assertion passed.
 *
 * So both halves are pinned: the diagnostic still happens while there is a
 * provider to diagnose, and does not once there isn't.
 */
import React from "react";
import { render } from "@testing-library/react";
import { Rebase } from "../src/core/Rebase";
import type { RebaseClient, RebaseData, StorageSourceDefinition } from "@rebasepro/types";

const mockAuthController: any = {
    user: { uid: "u1" },
    initialLoading: false,
    authLoading: false,
    loginSkipped: true,
    getAuthToken: jest.fn().mockResolvedValue("t")
};

const clientData = { collection: () => ({}) } as unknown as RebaseData;

/** A discovery request whose outcome the test decides, mid-flight. */
function pendingDiscovery() {
    let settle!: (defs: StorageSourceDefinition[]) => void;
    let fail!: (err: Error) => void;
    const promise = new Promise<StorageSourceDefinition[]>((resolve, reject) => {
        settle = resolve;
        fail = reject;
    });
    const client = {
        data: clientData,
        auth: {},
        fetchStorageSources: () => promise
    } as unknown as RebaseClient;
    return { client, settle, fail };
}

/** Let the rejection's `.catch` handler run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("<Rebase> storage-source discovery", () => {

    let debugSpy: jest.SpyInstance;

    beforeEach(() => {
        debugSpy = jest.spyOn(console, "debug").mockImplementation(() => undefined);
    });

    afterEach(() => {
        debugSpy.mockRestore();
    });

    it("reports a failed discovery while the provider is mounted", async () => {
        const { client, fail } = pendingDiscovery();
        render(
            <Rebase authController={mockAuthController} client={client} storageSource={{} as any}>
                {null}
            </Rebase>
        );

        fail(new Error("fetch failed"));
        await flush();

        expect(debugSpy).toHaveBeenCalledWith(
            "[Rebase] Could not load storage sources",
            expect.any(Error)
        );
    });

    it("says nothing once the provider that asked is unmounted", async () => {
        const { client, fail } = pendingDiscovery();
        const { unmount } = render(
            <Rebase authController={mockAuthController} client={client} storageSource={{} as any}>
                {null}
            </Rebase>
        );

        // The provider goes away first; the network answers afterwards, which is
        // the ordering that actually happens when the host is unreachable.
        unmount();
        fail(new Error("fetch failed"));
        await flush();

        expect(debugSpy).not.toHaveBeenCalled();
    });
});
