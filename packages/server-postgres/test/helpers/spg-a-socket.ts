/**
 * A client socket for the realtime service: the members it drives on a `ws`
 * WebSocket, open, with every frame it is handed recorded.
 */
import { WebSocket } from "ws";
import type { RealtimeClientSocket } from "../../src/services/realtimeService";

export interface OpenSocket {
    ws: RealtimeClientSocket;
    /** `ws.send`: every frame the socket was handed. */
    send: jest.Mock;
}

export function openSocket(): OpenSocket {
    const send = jest.fn();
    const ws: RealtimeClientSocket = {
        readyState: WebSocket.OPEN,
        bufferedAmount: 0,
        send,
        close: jest.fn(),
        terminate: jest.fn(),
        on: jest.fn()
    };
    return { ws, send };
}

/** The frames `send` was handed, parsed. */
export function sentFrames(send: jest.Mock): Record<string, unknown>[] {
    return send.mock.calls.map((call: unknown[]) => {
        const frame: unknown = JSON.parse(String(call[0]));
        if (typeof frame !== "object" || frame === null) throw new Error(`not a frame: ${String(call[0])}`);
        return Object.fromEntries(Object.entries(frame));
    });
}
