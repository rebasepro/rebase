/**
 * The routed realtime composite carries every method the socket calls.
 *
 * On a project with several realtime-capable sources, the single WebSocket
 * server is driven by `createRoutedRealtimeService` — an object literal over
 * the per-source providers — and a method left off the literal does not fall
 * through to anything. `AUTHENTICATE` began calling `rescopeClient`, which was
 * added to the Postgres service and never here; the bootstrapper cast the
 * composite to the Postgres service, so the compiler had nothing to compare,
 * and every sign-in on such a project answered INTERNAL_ERROR.
 *
 * So this asserts the property, not the one name, reading the contracts out of
 * their source — interfaces leave nothing at runtime to reflect over:
 *  - everything the socket calls on its realtime service (read off the
 *    socket's own source) is declared on the socket's parameter type;
 *  - everything that type declares is declared on `WsRealtimeService`, the
 *    composite's type;
 *  - the composite has a function for every member of `WsRealtimeService`
 *    and of `RealtimeProvider` it extends.
 */
import { describe, it, expect, jest } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import type { RealtimeProvider } from "@rebasepro/types";

import { createRoutedRealtimeService } from "../src/services/routed-realtime-service";

/** The member names declared directly on `interface <name>` in `file`. */
function interfaceMembers(file: string, name: string): string[] {
    const source = fs.readFileSync(file, "utf8");
    const start = source.search(new RegExp(`^export interface ${name}\\b[^{]*\\{`, "m"));
    expect(start).toBeGreaterThanOrEqual(0);

    let depth = 0;
    const names: string[] = [];
    let line = "";
    for (let i = source.indexOf("{", start); i < source.length; i++) {
        const c = source[i];
        if (c === "{") depth++;
        else if (c === "}") { depth--; if (depth === 0) break; }
        if (c !== "\n") { line += c; continue; }
        if (depth === 1) {
            const member = /^\s{4}([a-zA-Z_][a-zA-Z0-9_]*)\??\s*[(<:]/.exec(line);
            if (member) names.push(member[1]);
        }
        line = "";
    }
    return names;
}

const ROOT = path.resolve(__dirname, "../..");
const SOCKET = path.join(ROOT, "server-postgres/src/websocket.ts");
const COMPOSITE = path.join(ROOT, "server/src/services/routed-realtime-service.ts");
const PROVIDER = path.join(ROOT, "types/src/types/backend.ts");

/** Every `realtimeService.<method>(` the socket makes. */
function socketCalls(): string[] {
    const source = fs.readFileSync(SOCKET, "utf8");
    return [...new Set([...source.matchAll(/\brealtimeService\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)].map(m => m[1]))];
}

function provider() {
    return {
        supportsChannels: true,
        addClient: jest.fn(),
        rescopeClient: jest.fn(async () => {}),
        handleClientMessage: jest.fn(async () => {}),
        subscribeToCollection: jest.fn(),
        subscribeToOne: jest.fn(),
        unsubscribe: jest.fn(),
        notifyUpdate: jest.fn(async () => {}),
        onServerReady: jest.fn(),
        destroy: jest.fn(async () => {}),
        stopListening: jest.fn(async () => {})
    };
}

describe("the routed realtime composite", () => {
    const socketType = interfaceMembers(SOCKET, "SocketRealtimeService");
    const compositeType = interfaceMembers(COMPOSITE, "WsRealtimeService");
    const providerType = interfaceMembers(PROVIDER, "RealtimeProvider");

    it("reads non-empty contracts, so a rename cannot pass vacuously", () => {
        expect(socketCalls()).toEqual(expect.arrayContaining(["addClient", "rescopeClient", "handleClientMessage"]));
        expect(socketType).toEqual(expect.arrayContaining(["addClient", "rescopeClient", "handleClientMessage"]));
        expect(compositeType).toEqual(expect.arrayContaining(["addClient", "handleClientMessage"]));
        expect(providerType).toEqual(expect.arrayContaining(["subscribeToCollection", "notifyUpdate"]));
    });

    it("declares, on the socket's parameter type, every method the socket calls", () => {
        const missing = socketCalls().filter(name => !socketType.includes(name));
        expect({ missing }).toEqual({ missing: [] });
    });

    it("declares, on its own type, every method the socket's parameter type requires", () => {
        const missing = socketType.filter(name => !compositeType.includes(name));
        expect({ missing }).toEqual({ missing: [] });
    });

    it("implements every method of its type and of RealtimeProvider", () => {
        const routed = createRoutedRealtimeService({
            providers: { a: provider() as unknown as RealtimeProvider },
            defaultKey: "a",
            resolveKey: () => "a"
        }) as unknown as Record<string, unknown>;
        const methods = [...compositeType, ...providerType].filter(name => name !== "supportsChannels");
        const missing = methods.filter(name => typeof routed[name] !== "function");
        expect({ missing }).toEqual({ missing: [] });
    });

    it("re-scopes a socket on every source", async () => {
        const a = provider();
        const b = provider();
        const routed = createRoutedRealtimeService({
            providers: { a: a as unknown as RealtimeProvider, b: b as unknown as RealtimeProvider },
            defaultKey: "a",
            resolveKey: () => "a"
        });

        await routed.rescopeClient("c1", { uid: "u1", roles: ["viewer"] });

        expect(a.rescopeClient).toHaveBeenCalledWith("c1", { uid: "u1", roles: ["viewer"] });
        expect(b.rescopeClient).toHaveBeenCalledWith("c1", { uid: "u1", roles: ["viewer"] });
    });
});
