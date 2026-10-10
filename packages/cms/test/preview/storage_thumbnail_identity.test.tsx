/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, waitFor } from "@testing-library/react";
import type { AuthController, DownloadConfig } from "@rebasepro/types";

/**
 * A thumbnail remembers the URL it last drew, per path, so a remount draws at
 * once. A private file's URL carries a download token minted for the user who
 * asked — and the memory outlived the user: after a sign-out and another user's
 * sign-in in the same tab, the next user's thumbnail of the same path drew the
 * previous user's URL, served on their token.
 */

let signedInAs = "alice";
const pending: { user: string; resolve: () => void }[] = [];
let deferAnswers = false;
const getSignedUrl = jest.fn((key: string): Promise<DownloadConfig> => {
    const user = signedInAs;
    const config = {
        url: `https://files.example.com/api/storage/file/${key}?token=for-${user}`,
        metadata: { contentType: "application/pdf" }
    } as DownloadConfig;
    if (!deferAnswers) return Promise.resolve(config);
    return new Promise(resolve => pending.push({ user, resolve: () => resolve(config) }));
});

jest.mock("@rebasepro/app", () => {
    const source = { getSignedUrl };
    const sources = { registry: {}, sources: {} };
    const overrides: Record<string, unknown> = {
        useStorageSource: () => source,
        useStorageSources: () => sources
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { AuthControllerContext } from "@rebasepro/app";
import { StorageThumbnail } from "../../src/preview/components/StorageThumbnail";

function signedIn(uid: string): AuthController {
    return { user: { uid } } as unknown as AuthController;
}

function thumbnail(uid: string, path: string) {
    return render(
        <AuthControllerContext.Provider value={signedIn(uid)}>
            <StorageThumbnail storagePathOrDownloadUrl={path} storeUrl={false} size="small"/>
        </AuthControllerContext.Provider>
    );
}

function drawn(container: HTMLElement): string {
    return container.innerHTML;
}

beforeEach(() => {
    signedInAs = "alice";
    deferAnswers = false;
    pending.length = 0;
    getSignedUrl.mockClear();
});

describe("a thumbnail after a change of user", () => {
    it("does not draw the URL it remembered for the previous user", async () => {
        const first = thumbnail("alice", "private/report.pdf");
        await waitFor(() => expect(drawn(first.container)).toContain("for-alice"));
        first.unmount();

        signedInAs = "bob";
        const second = thumbnail("bob", "private/report.pdf");
        // On mount, before the source answers: nothing of Alice's.
        expect(drawn(second.container)).not.toContain("for-alice");
        await waitFor(() => expect(drawn(second.container)).toContain("for-bob"));
        expect(drawn(second.container)).not.toContain("for-alice");
    });

    it("does not share the previous user's request still in flight", async () => {
        deferAnswers = true;
        const first = thumbnail("alice", "private/minutes.pdf");
        await waitFor(() => expect(pending).toHaveLength(1));
        first.unmount();

        signedInAs = "bob";
        const second = thumbnail("bob", "private/minutes.pdf");
        await waitFor(() => expect(getSignedUrl).toHaveBeenCalledTimes(2));
        for (const answer of pending) answer.resolve();

        await waitFor(() => expect(drawn(second.container)).toContain("for-bob"));
        expect(drawn(second.container)).not.toContain("for-alice");
    });
});
