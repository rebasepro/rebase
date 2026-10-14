/**
 * A database with no free connection says so at boot, and what to do.
 *
 * Two backends beside `rebase dev` on the managed database: the third or
 * fourth connection was turned away, and boot printed "Failed to connect to
 * PostgreSQL at 127.0.0.1:26355: Connection terminated unexpectedly", then
 * "Cannot reach PostgreSQL … to provision the collection schema" and a stack.
 * That reads as a database that is down.
 *
 * The managed database's proxy now answers such a client as Postgres answers
 * one over `max_connections`: FATAL, SQLSTATE 53300, its reason and a hint.
 * Boot prints both, and stops, since provisioning needs the connection.
 */
import { jest } from "@jest/globals";
import net from "net";
import pg from "pg";
import { logger } from "@rebasepro/server";

import { openRebase } from "../src/open-rebase";
import { createPostgresBootstrapper } from "../src/PostgresBootstrapper";

const URL_ = "postgresql://postgres@127.0.0.1:26355/postgres?sslmode=disable";

/** What node-postgres raises for a FATAL 53300 during the startup exchange. */
function noFreeConnection(message: string, hint?: string): pg.DatabaseError {
    const error = new pg.DatabaseError(message, 200, "error");
    error.severity = "FATAL";
    error.code = "53300";
    if (hint !== undefined) error.hint = hint;
    return error;
}

async function boot(error: Error): Promise<{ thrown: unknown; logged: string }> {
    const lines: string[] = [];
    const spy = jest.spyOn(logger, "error").mockImplementation((message: string) => { lines.push(message); });
    try {
        const bootstrapper = createPostgresBootstrapper({
            connectionString: URL_,
            connection: { execute: async () => { throw new Error("Failed query: SELECT 1\nparams: ", { cause: error }); } }
        } as never);
        const thrown = await bootstrapper.verifyConnection!(undefined).then(() => undefined, (failure: unknown) => failure);
        return { thrown, logged: lines.join("\n") };
    } finally {
        spy.mockRestore();
    }
}

describe("verifyConnection, when the database has no free connection", () => {
    const MANAGED_MESSAGE = "The managed development database has no free connection: it accepts only a few at a time, " +
        "and other clients hold them — a running `rebase dev` holds some.";
    const MANAGED_HINT = "Stop another process that uses it (a second backend, `rebase console`, psql or a database GUI) " +
        "and connect again. For several backends at once, run Postgres in Docker: `rebase dev --docker`.";

    it("prints the reason and the hint the managed database sent, never a dropped connection", async () => {
        const { thrown, logged } = await boot(noFreeConnection(MANAGED_MESSAGE, MANAGED_HINT));

        expect(logged).toContain("PostgreSQL at 127.0.0.1:26355 has no free connection");
        expect(logged).toContain(MANAGED_MESSAGE);
        expect(logged).toContain("rebase dev --docker");
        expect(logged).not.toContain("credentials");
        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).message).toBe(`PostgreSQL at 127.0.0.1:26355 has no free connection: ${MANAGED_MESSAGE} [53300]`);
        expect((thrown as Error).message).not.toMatch(/Cannot reach/);
    });

    it("names the pool and max_connections for a Postgres server over its own limit", async () => {
        // Real Postgres sends no hint with this one.
        const { thrown, logged } = await boot(noFreeConnection("sorry, too many clients already"));

        expect(logged).toContain("sorry, too many clients already [53300]");
        expect(logged).toContain("REBASE_DB_POOL_MAX");
        expect(logged).toContain("max_connections");
        expect((thrown as Error).message).toContain("has no free connection");
    });
});

/** A server that answers every startup as the managed database's proxy does when it is full. */
async function fullServer(message: string, hint: string): Promise<{ url: string; close(): Promise<void> }> {
    const field = (code: string, value: string) => Buffer.concat([Buffer.from(code, "ascii"), Buffer.from(`${value}\0`, "utf8")]);
    const body = Buffer.concat([
        field("S", "FATAL"), field("V", "FATAL"), field("C", "53300"), field("M", message), field("H", hint), Buffer.from([0])
    ]);
    const refusal = Buffer.alloc(5 + body.length);
    refusal.write("E", 0, "ascii");
    refusal.writeInt32BE(4 + body.length, 1);
    body.copy(refusal, 5);
    const server = net.createServer((socket) => {
        socket.on("error", () => socket.destroy());
        socket.once("data", () => socket.end(refusal));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const { port } = server.address() as net.AddressInfo;
    return {
        url: `postgresql://postgres@127.0.0.1:${port}/postgres?sslmode=disable`,
        close: () => new Promise<void>((resolve) => server.close(() => resolve()))
    };
}

describe("openRebase, when the database has no free connection", () => {
    it("says so with the database's own remedy", async () => {
        const message = "The managed development database has no free connection: it accepts only a few at a time, " +
            "and other clients hold them — a running `rebase dev` holds some.";
        const hint = "Stop another process that uses it, or run Postgres in Docker: `rebase dev --docker`.";
        const server = await fullServer(message, hint);
        try {
            const opened = openRebase({ databaseUrl: server.url, collections: [] });
            await expect(opened).rejects.toThrow(`${message} (53300). ${hint}`);
        } finally {
            await server.close();
        }
    });
});
