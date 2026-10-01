import React from "react";
import { act, render, screen } from "@testing-library/react";
import type { RealtimeConnectionState } from "@rebasepro/types";
import { RebaseClientInstanceContext } from "../../src/contexts/RebaseClientInstanceContext";
import { ConnectionLostBanner } from "../../src/components/ConnectionLostBanner";

/**
 * The admin says when live updates have stopped.
 *
 * During a realtime outage the views keep what they last received instead of
 * turning into errors, so without this nothing on screen distinguishes a quiet
 * collection from a dead connection.
 */

jest.mock("../../src/hooks/useTranslation", () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));

function fakeSocket(initial: RealtimeConnectionState) {
    let state = initial;
    const listeners = new Set<(next: RealtimeConnectionState) => void>();
    return {
        get state() {
            return state;
        },
        onStateChange(listener: (next: RealtimeConnectionState) => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        move(next: RealtimeConnectionState) {
            state = next;
            for (const listener of [...listeners]) listener(next);
        }
    };
}

function renderWith(client: unknown) {
    return render(
        <RebaseClientInstanceContext.Provider value={client}>
            <ConnectionLostBanner/>
        </RebaseClientInstanceContext.Provider>
    );
}

describe("ConnectionLostBanner", () => {
    it("shows while the connection is lost, and goes away when it is back", () => {
        const ws = fakeSocket("connected");
        renderWith({ ws });
        expect(screen.queryByText("realtime_connection_lost_title")).toBeNull();

        act(() => ws.move("reconnecting"));
        // A blip says nothing.
        expect(screen.queryByText("realtime_connection_lost_title")).toBeNull();

        act(() => ws.move("disconnected"));
        expect(screen.getByRole("status").textContent).toContain("realtime_connection_lost_title");
        expect(screen.getByText("realtime_connection_lost_body")).toBeTruthy();

        act(() => ws.move("connected"));
        expect(screen.queryByText("realtime_connection_lost_title")).toBeNull();
    });

    it("renders nothing without a realtime client", () => {
        const { container } = renderWith({});
        expect(container.textContent).toBe("");
    });

    it("renders nothing for a socket that has no state to report", () => {
        const { container } = renderWith({ ws: { on: () => () => undefined } });
        expect(container.textContent).toBe("");
    });
});
