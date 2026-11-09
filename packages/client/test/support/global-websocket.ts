import type { RealtimeSocketConstructor } from "../../src/websocket";

/**
 * Stand a constructor in for the global `WebSocket`, or remove it.
 *
 * The client falls back to `globalThis.WebSocket` when no constructor is
 * configured, and needs only a {@link RealtimeSocketConstructor} from it. A
 * test fake is that, not the whole DOM class the global is declared as, so it
 * is installed as a property rather than assigned through the DOM type.
 */
export function setGlobalWebSocket(ctor: RealtimeSocketConstructor | undefined): void {
    Object.defineProperty(globalThis, "WebSocket", { value: ctor, configurable: true, writable: true });
}
