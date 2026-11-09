/**
 * Typed fakes for the WebSocket server's collaborators.
 *
 * `createPostgresWebSocket` takes a `SocketRealtimeService`, a
 * `SocketDataDriver` and an `AuthAdapter`. These build complete objects of
 * those types, each method a typed `jest.fn`, so a test can stub or inspect a
 * method without casting a partial object into the interface.
 */
import { jest } from "@jest/globals";
import type {
    AuthAdapter,
    AuthAdapterCapabilities,
    BranchAdmin,
    DataDriver,
    RealtimeProvider,
    SchemaAdmin,
    SQLAdmin
} from "@rebasepro/types";
import type { SocketDataDriver, SocketRealtimeService } from "../../src/websocket";
import type { RealtimeSocket } from "../../src/services/socket-liveness";

/** A client socket as `RealtimeService.addClient` takes one: open, with nothing buffered. */
export function fakeRealtimeSocket() {
    return {
        readyState: 1,
        bufferedAmount: 0,
        send: jest.fn<(data: string) => void>(),
        close: jest.fn<(code?: number, reason?: string) => void>(),
        terminate: jest.fn<() => void>(),
        on: jest.fn<(event: string, listener: (...args: never[]) => void) => unknown>()
    } satisfies RealtimeSocket;
}

export type FakeRealtimeSocket = ReturnType<typeof fakeRealtimeSocket>;

/** Every frame `RealtimeService` wrote to `ws`, parsed. */
export function realtimeFrames(ws: Pick<FakeRealtimeSocket, "send">): unknown[] {
    return ws.send.mock.calls.map(([data]) => JSON.parse(data));
}

/** Every admin capability the socket can reach, each a typed mock. */
export function fakeSocketAdmin() {
    return {
        executeSql: jest.fn<SQLAdmin["executeSql"]>(),
        runSqlScript: jest.fn<NonNullable<SQLAdmin["runSqlScript"]>>(),
        fetchAvailableDatabases: jest.fn<NonNullable<SQLAdmin["fetchAvailableDatabases"]>>(),
        fetchAvailableRoles: jest.fn<NonNullable<SQLAdmin["fetchAvailableRoles"]>>(),
        fetchApplicationRoles: jest.fn<NonNullable<SQLAdmin["fetchApplicationRoles"]>>(),
        fetchCurrentDatabase: jest.fn<NonNullable<SQLAdmin["fetchCurrentDatabase"]>>(),
        fetchUnmappedTables: jest.fn<NonNullable<SchemaAdmin["fetchUnmappedTables"]>>(),
        fetchTableMetadata: jest.fn<NonNullable<SchemaAdmin["fetchTableMetadata"]>>(),
        createBranch: jest.fn<BranchAdmin["createBranch"]>(),
        deleteBranch: jest.fn<BranchAdmin["deleteBranch"]>(),
        listBranches: jest.fn<BranchAdmin["listBranches"]>()
    };
}

/**
 * A driver with the data methods every driver has, as typed mocks. Spread it
 * to add more: `{ ...fakeDataDriver(), admin }`.
 */
export function fakeDataDriver() {
    return {
        key: "postgres",
        initialised: true,
        fetchCollection: jest.fn<DataDriver["fetchCollection"]>(),
        fetchOne: jest.fn<DataDriver["fetchOne"]>(),
        save: jest.fn<DataDriver["save"]>(),
        delete: jest.fn<DataDriver["delete"]>(),
        checkUniqueField: jest.fn<DataDriver["checkUniqueField"]>()
    } satisfies SocketDataDriver;
}

/** A realtime service with each socket-facing method a typed mock. */
export function fakeSocketRealtime() {
    return {
        addClient: jest.fn<SocketRealtimeService["addClient"]>(),
        rescopeClient: jest.fn<SocketRealtimeService["rescopeClient"]>(),
        handleClientMessage: jest.fn<SocketRealtimeService["handleClientMessage"]>()
    };
}

/** A realtime provider, as a bootstrapper is handed one, that also takes socket clients. */
export function fakeRealtimeProvider() {
    return {
        ...fakeSocketRealtime(),
        subscribeToCollection: jest.fn<RealtimeProvider["subscribeToCollection"]>(),
        subscribeToOne: jest.fn<RealtimeProvider["subscribeToOne"]>(),
        unsubscribe: jest.fn<RealtimeProvider["unsubscribe"]>(),
        notifyUpdate: jest.fn<RealtimeProvider["notifyUpdate"]>()
    } satisfies RealtimeProvider & SocketRealtimeService;
}

/** What an adapter with no routes of its own says it can do. */
export const NO_CAPABILITIES: AuthAdapterCapabilities = {
    hasBuiltInAuthRoutes: false,
    emailPasswordLogin: false,
    registrationEnabled: false,
    passwordReset: false,
    adminPasswordReset: false,
    sessionManagement: false,
    profileUpdate: false,
    emailVerification: false,
    magicLink: false,
    anonymousLogin: false,
    enabledProviders: []
};

/** An auth adapter: `verifyRequest` answers nobody, and `parts` supplies the rest. */
export function fakeAuthAdapter(parts: Partial<AuthAdapter>): AuthAdapter {
    return {
        id: "test",
        verifyRequest: async () => null,
        getCapabilities: () => NO_CAPABILITIES,
        ...parts
    };
}

/** A listener the socket registers on a client: its arguments are whatever `ws` emits. */
export type SocketListener = (...args: unknown[]) => unknown;

/** The client socket the server's `connection` handler is handed. */
export function fakeClientSocket() {
    return {
        on: jest.fn<(event: string, listener: SocketListener) => void>(),
        once: jest.fn<(event: string, listener: SocketListener) => void>(),
        send: jest.fn<(data: string) => void>(),
        close: jest.fn<(code?: number, reason?: string) => void>()
    };
}

export type FakeClientSocket = ReturnType<typeof fakeClientSocket>;

/** The listener the server registered for `event` on `ws`. */
export function listenerOn(ws: Pick<FakeClientSocket, "on">, event: string): SocketListener {
    const call = ws.on.mock.calls.find(([name]) => name === event);
    if (!call) throw new Error(`nothing listens for "${event}" on this socket`);
    return call[1];
}

/** Every frame the server wrote to `ws`, parsed. */
export function framesSent(ws: Pick<FakeClientSocket, "send">): unknown[] {
    return ws.send.mock.calls.map(([data]) => JSON.parse(data));
}

/** The last frame the server wrote to `ws`, parsed. */
export function lastFrameSent(ws: Pick<FakeClientSocket, "send">): unknown {
    const calls = ws.send.mock.calls;
    if (calls.length === 0) throw new Error("nothing was sent on this socket");
    return JSON.parse(calls[calls.length - 1][0]);
}

/**
 * A driver that can build a callback context inside a refetch's transaction,
 * which is what `RealtimeService` asks of the driver it is given. The tests
 * that use it declare no hook that reads the context.
 */
export function fakeCallContextDriver() {
    return { ...fakeDataDriver(), callContextWithin: () => ({}) };
}
