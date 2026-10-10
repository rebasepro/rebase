/**
 * The first markdown of a session should not flash its source.
 *
 * The kit's `Markdown` imports markdown-it (~100 kB) the first time one
 * renders, and shows the source as plain text until it lands; the login
 * screen has no markdown, so it must not be preloaded there. Once someone is
 * signed in, `prefetchRecordViews` (run by `RebaseNavigation`, behind the auth
 * gate) fetches it while the browser is idle, so it is in the module cache
 * before the first markdown cell or preview mounts.
 */
let mockMarkdownLoads = 0;
jest.mock("markdown-it", () => {
    mockMarkdownLoads++;
    return { __esModule: true, default: function MarkdownIt() { return undefined; } };
});
// The record views it prefetches beside the parser are not under test here.
jest.mock("../src/components/CollectionViewBinding/CollectionViewBinding", () => ({}));
jest.mock("../src/components/EditViewBinding", () => ({}));
jest.mock("../src/components/DetailViewBinding", () => ({}));
jest.mock("../src/components/SidePanelBinding", () => ({}));

import { prefetchRecordViews } from "../src/components/lazy_record_views";

describe("prefetchRecordViews", () => {
    it("fetches markdown-it when the browser is idle after sign-in, not on import", async () => {
        const idle: IdleRequestCallback[] = [];
        Object.defineProperty(window, "requestIdleCallback", {
            configurable: true,
            value: (callback: IdleRequestCallback) => idle.push(callback)
        });
        Object.defineProperty(window, "cancelIdleCallback", { configurable: true, value: () => undefined });

        expect(mockMarkdownLoads).toBe(0);
        prefetchRecordViews();
        expect(mockMarkdownLoads).toBe(0);

        idle.forEach(callback => callback({ didTimeout: false, timeRemaining: () => 50 }));
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockMarkdownLoads).toBe(1);
    });
});
