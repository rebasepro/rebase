/**
 * The two strings `db connect` builds, and why they are worth pinning.
 *
 * The endpoint URL is derived from the control-plane URL the caller is logged in
 * to, so `--url http://localhost:3002` has to produce a `ws://` socket on that
 * host and not a `wss://` one on the default cloud — a tunnel that silently
 * addresses production while the developer is pointed at their own control plane
 * is the worst available failure.
 *
 * The DSN is the whole product of this command, and it must describe the LOCAL
 * end. The server reports the cluster's own URI — `postgres-rw.rebase-tenant-…`
 * — and printing that as the way to connect is exactly the bug the tunnel
 * exists to fix, so this one is composed here from the local port and never
 * echoed from the response.
 */
import { describe, expect, it } from "vitest";
import { tunnelUrl, localDsn } from "./db-connect";

describe("tunnelUrl", () => {
    it("upgrades https to wss on the same host", () => {
        expect(tunnelUrl("https://app.rebase.pro", "p1")).toBe("wss://app.rebase.pro/api/db-tunnel/p1");
    });

    it("uses ws for a plain-http control plane, which is how local dev is reached", () => {
        expect(tunnelUrl("http://localhost:3002", "p1")).toBe("ws://localhost:3002/api/db-tunnel/p1");
    });

    it("replaces any path the control-plane URL carried", () => {
        // `/api/db-tunnel` is mounted at the root of the host, so appending
        // would address a route that does not exist.
        expect(tunnelUrl("https://app.rebase.pro/console/", "p1")).toBe(
            "wss://app.rebase.pro/api/db-tunnel/p1"
        );
    });

    it("drops a query string rather than carrying it onto the socket", () => {
        expect(tunnelUrl("https://app.rebase.pro/?org=acme", "p1")).toBe(
            "wss://app.rebase.pro/api/db-tunnel/p1"
        );
    });

    it("keeps a non-default port", () => {
        expect(tunnelUrl("http://127.0.0.1:3002", "p1")).toBe("ws://127.0.0.1:3002/api/db-tunnel/p1");
    });

    it("encodes the project id", () => {
        expect(tunnelUrl("https://app.rebase.pro", "a/b")).toBe("wss://app.rebase.pro/api/db-tunnel/a%2Fb");
    });
});

describe("localDsn", () => {
    it("addresses the loopback listener, never the cluster host", () => {
        expect(localDsn({ port: 5432, username: "app", database: "rebase" })).toBe(
            "postgresql://app@127.0.0.1:5432/rebase"
        );
    });

    it("carries the local port the listener actually bound", () => {
        expect(localDsn({ port: 6543, username: "app", database: "rebase" })).toContain("127.0.0.1:6543");
    });

    it("omits the password unless one was revealed", () => {
        const dsn = localDsn({ port: 5432, username: "app", database: "rebase" });
        expect(dsn).not.toContain(":@");
        expect(dsn).toBe("postgresql://app@127.0.0.1:5432/rebase");
    });

    it("percent-encodes a revealed password, which is generated and not URL-safe", () => {
        const dsn = localDsn({ port: 5432, username: "app", database: "rebase", password: "p@ss/w:rd" });
        expect(dsn).toBe("postgresql://app:p%40ss%2Fw%3Ard@127.0.0.1:5432/rebase");
        // Parseable by anything that takes a DSN, which is the point of encoding.
        expect(new URL(dsn).password).toBe("p%40ss%2Fw%3Ard");
    });

    it("falls back only to protocol constants when the server reported nothing", () => {
        // `postgres` and `rebase` are the role and database our own CNPG
        // manifest fixes, not a guess at somebody's configuration.
        expect(localDsn({ port: 5432, username: null, database: null })).toBe(
            "postgresql://postgres@127.0.0.1:5432/rebase"
        );
    });
});
