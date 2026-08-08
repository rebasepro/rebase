/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * The two things the user picker did not do that the relation picker next to
 * it does.
 *
 * 1. It never resolved its own value. `getUser` reads a cache filled only by
 *    the list request — the first page of ten — so a record whose assignee is
 *    user #147 opened with the field reading *empty*. The value was still
 *    there, which is worse: an editor shown "no value" sets one, and the
 *    previous assignment goes with it.
 *
 * 2. Its type-ahead had neither debouncing nor cancellation. Every keystroke
 *    issued a request and every response overwrote the list, so the answer for
 *    "al" landing after the answer for "alice" replaced the list — and the
 *    paging offset — with the wrong page.
 */

const API_BASE = "http://api.test/api";

// cmdk measures its list; jsdom has no ResizeObserver, and without one the
// popover cannot mount at all.
beforeAll(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
        observe() { /* no layout in jsdom */ }
        unobserve() { /* no layout in jsdom */ }
        disconnect() { /* no layout in jsdom */ }
    };
});

// Both have to be referentially stable: `fetchUsers` lists them as
// dependencies, and a fresh identity per render re-runs the list effect
// forever.
const CLIENT = { baseUrl: "http://api.test" };
const AUTH = { getAuthToken: async () => "token" };

jest.mock("@rebasepro/app", () => ({
    apiBaseOf: () => API_BASE,
    useRebaseClient: () => CLIENT,
    useAuthController: () => AUTH,
    UserDisplay: ({ user }: { user: { uid: string, displayName?: string | null } }) =>
        <span data-testid="user">{user.displayName ?? user.uid}</span>
}));

jest.mock("../../src/preview", () => ({
    EmptyValue: () => <span data-testid="empty-value">—</span>
}));

import { UserSelector } from "../../src/components/UserSelector";

type Row = { uid: string, displayName: string };
const user = (uid: string, displayName: string): Row => ({ uid,
displayName });

/** Requests issued, and control over when each one answers. */
function mockFetch(handler: (url: string) => Promise<unknown>) {
    const urls: string[] = [];
    (globalThis as { fetch?: unknown }).fetch = ((url: string) => {
        urls.push(url);
        return handler(url).then(body => ({ ok: true,
json: async () => body }));
    }) as never;
    return urls;
}

const listRequests = (urls: string[]) => urls.filter(u => !u.includes("ids="));

describe("UserSelector resolves the value it was given", () => {

    afterEach(() => {
        delete (globalThis as { fetch?: unknown }).fetch;
    });

    it("shows a user who is not on the loaded page", async () => {
        mockFetch(async (url) => {
            if (url.includes("ids=u-147")) return { users: [user("u-147", "Grace Hopper")] };
            // The list: ten other people, as an installation with 200 users has.
            return { users: [user("u-1", "Ada Lovelace")] };
        });

        render(<UserSelector value="u-147"/>);

        await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("Grace Hopper"));
    });

    it("falls back to the raw uid rather than claiming the field is empty", async () => {
        // Deleted, or hidden from this viewer. Either way the field is set.
        mockFetch(async () => ({ users: [] }));

        render(<UserSelector value="u-999"/>);

        await waitFor(() => expect(screen.getByText("u-999")).toBeTruthy());
        expect(screen.queryByTestId("empty-value")).toBeNull();
    });

    it("still shows the empty placeholder when nothing is selected", async () => {
        mockFetch(async () => ({ users: [user("u-1", "Ada Lovelace")] }));

        render(<UserSelector/>);

        await waitFor(() => expect(screen.getByTestId("empty-value")).toBeTruthy());
    });
});

describe("UserSelector type-ahead", () => {

    // Only the debounce timer is faked. React's scheduler runs on
    // queueMicrotask/setImmediate, and faking those hangs `act`.
    beforeEach(() => jest.useFakeTimers({
        doNotFake: ["queueMicrotask", "setImmediate", "clearImmediate", "nextTick",
            "performance", "requestAnimationFrame", "cancelAnimationFrame",
            "requestIdleCallback", "cancelIdleCallback", "Date"]
    }));

    afterEach(() => {
        jest.useRealTimers();
        delete (globalThis as { fetch?: unknown }).fetch;
    });

    /** Open the popover and hand back its search input. */
    async function openPicker() {
        render(<UserSelector/>);
        await act(async () => {
            fireEvent.click(screen.getByRole("button"));
        });
        return screen.getByPlaceholderText("Search users...");
    }

    it("issues one request for a word, not one per keystroke", async () => {
        const urls = mockFetch(async () => ({ users: [] }));
        const input = await openPicker();
        const before = listRequests(urls).length;

        for (const value of ["a", "al", "ali", "alic", "alice"]) {
            fireEvent.change(input, { target: { value } });
        }
        await act(async () => {
            jest.advanceTimersByTime(300);
        });

        expect(listRequests(urls).length - before).toBe(1);
    });

    it("ignores a response that a later search has superseded", async () => {
        const pending: Array<(body: unknown) => void> = [];
        mockFetch((url) => {
            if (url.includes("search=al&") || url.endsWith("search=al")) {
                return new Promise(resolve => pending.push(resolve));
            }
            if (url.includes("search=alice")) {
                return Promise.resolve({ users: [user("u-2", "Alice Coltrane")] });
            }
            return Promise.resolve({ users: [] });
        });

        const input = await openPicker();

        fireEvent.change(input, { target: { value: "al" } });
        await act(async () => {
            jest.advanceTimersByTime(300);
        });

        fireEvent.change(input, { target: { value: "alice" } });
        await act(async () => {
            jest.advanceTimersByTime(300);
        });

        await waitFor(() => expect(screen.getAllByTestId("user").length).toBe(1));

        // "al" answers last, as it routinely does on a loaded server.
        await act(async () => {
            pending.forEach(resolve => resolve({ users: [user("u-3", "Al Green"), user("u-4", "Alan Turing")] }));
        });

        const shown = screen.getAllByTestId("user").map(node => node.textContent);
        expect(shown).toEqual(["Alice Coltrane"]);
    });
});
