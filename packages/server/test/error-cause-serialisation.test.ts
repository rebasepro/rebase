import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { describeCauseChain, logger } from "../src/utils/logger";

/**
 * A boot failure has to name the database.
 *
 * Every database error a developer sees is a wrapper. Drizzle rethrows
 * `Failed query: <sql>` with a stack through its own internals; the sentence
 * that says what is actually wrong — `connect ECONNREFUSED 127.0.0.1:5432` —
 * is in `.cause`, and on a dual-stack host it is not even there but inside the
 * `AggregateError.errors` array of one attempt per resolved address.
 *
 * The serialiser used to copy `name`, `message` and `stack` and stop. So a
 * scaffold booted against a stopped database logged `Failed query: [redacted]`
 * and nothing else: no host, no port, no reason, no hint. These tests hold the
 * chain open — and hold the redaction closed at the same time, because the
 * fields that make the chain useful sit right beside the ones that leak rows.
 */
function connectRefused(address = "127.0.0.1", port = 5432): Error {
    return Object.assign(new Error(`connect ECONNREFUSED ${address}:${port}`), {
        code: "ECONNREFUSED",
        errno: -61,
        syscall: "connect",
        address,
        port
    });
}

describe("serialised errors carry their cause", () => {
    let written: string[];

    beforeEach(() => {
        written = [];
        jest.spyOn(console, "log").mockImplementation((...args: unknown[]) => { written.push(args.join(" ")); });
        jest.spyOn(console, "warn").mockImplementation((...args: unknown[]) => { written.push(args.join(" ")); });
        jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => { written.push(args.join(" ")); });
        jest.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => { written.push(String(chunk)); return true; }) as never);
        jest.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => { written.push(String(chunk)); return true; }) as never);
    });

    afterEach(() => jest.restoreAllMocks());

    const output = () => written.join("\n");

    it("names the host, the port and ECONNREFUSED under a drizzle wrapper", () => {
        const wrapped = new DrizzleQueryError("select 1", [], connectRefused("10.0.0.4", 5432));
        logger.error("Failed to start", { error: wrapped });

        expect(output()).toContain("ECONNREFUSED");
        expect(output()).toContain("10.0.0.4");
        expect(output()).toContain("5432");
    });

    it("reaches into an AggregateError's children", () => {
        // What a dual-stack host produces: one attempt per resolved address,
        // and the reason is in none of the wrappers, only in the children.
        const aggregate = new AggregateError(
            [connectRefused("::1", 5432), connectRefused("127.0.0.1", 5432)],
            "All connection attempts failed"
        );
        logger.error("Failed to start", { error: new Error("Boot failed", { cause: aggregate }) });

        expect(output()).toContain("ECONNREFUSED");
        expect(output()).toContain("::1");
    });

    it("carries a plain-object cause rather than [object Object]", () => {
        logger.error("Failed to start", {
            error: new Error("Boot failed", { cause: { code: "ENOTFOUND", hostname: "db.internal" } })
        });

        expect(output()).toContain("ENOTFOUND");
        expect(output()).toContain("db.internal");
        expect(output()).not.toContain("[object Object]");
    });

    it("still refuses the query, the params and Postgres's row-level detail", () => {
        // The reason `serialiseError` copies a fixed list and not every
        // own-property: `23505` reports `Key (email)=(a@b.c) already exists.`
        // in `detail`, and `DrizzleQueryError` carries the bound values.
        const pgError = Object.assign(new Error('duplicate key value violates unique constraint "users_email_key"'), {
            code: "23505",
            detail: "Key (email)=(alice@acme.com) already exists.",
            table: "users"
        });
        logger.error("Insert failed", {
            error: new DrizzleQueryError(
                'insert into "users" ("email") values ($1)',
                ["alice@acme.com"],
                pgError
            )
        });

        expect(output()).toContain("23505");
        expect(output()).not.toContain("alice@acme.com");
        expect(output()).not.toContain("insert into");
    });

    it("does not hang on a cause that points back at itself", () => {
        const loop = new Error("outer");
        (loop as { cause?: unknown }).cause = loop;

        expect(() => logger.error("Cyclic", { error: loop })).not.toThrow();
    });
});

describe("describeCauseChain", () => {
    it("renders one printable line per link", () => {
        const chain = new Error("Boot failed", {
            cause: new DrizzleQueryError("select 1", [], connectRefused("10.0.0.4", 5432))
        });

        const lines = describeCauseChain(chain);
        expect(lines.some(line => line.includes("ECONNREFUSED") && line.includes("10.0.0.4:5432"))).toBe(true);
        expect(lines.every(line => line.startsWith("caused by: "))).toBe(true);
    });

    it("says nothing about an error with no cause", () => {
        expect(describeCauseChain(new Error("standalone"))).toEqual([]);
    });

    it("does not repeat the endpoint the message already names", () => {
        const [line] = describeCauseChain(new Error("outer", { cause: connectRefused("127.0.0.1", 5432) }));
        expect(line).toBe("caused by: connect ECONNREFUSED 127.0.0.1:5432 (ECONNREFUSED)");
    });

    it("terminates on a cycle", () => {
        const loop = new Error("outer");
        (loop as { cause?: unknown }).cause = loop;
        expect(() => describeCauseChain(loop)).not.toThrow();
    });
});
