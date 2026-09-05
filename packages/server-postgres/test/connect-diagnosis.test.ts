import { deepestErrorMessage, diagnoseDbError, parseHostInfo } from "../src/cli-errors";
import { createPostgresAdapter } from "../src/PostgresAdapter";
import { createPostgresBootstrapper } from "../src/PostgresBootstrapper";

/**
 * A connection that failed has to say what failed, and where.
 *
 * Everything the developer is shown here is a wrapper. `net` writes
 * `connect ECONNREFUSED 127.0.0.1:5432`, `pg` wraps it, Drizzle wraps that as
 * `Failed query: SELECT 1` — and on a dual-stack host the sentence is not in
 * `.cause` at all but inside an `AggregateError`, one attempt per resolved
 * address. The banner used to print none of it: a box naming the host and three
 * suggestions, with no `ECONNREFUSED` anywhere in the output.
 */
const refused = (address: string, port: number) =>
    Object.assign(new Error(`connect ECONNREFUSED ${address}:${port}`), {
        code: "ECONNREFUSED",
        errno: -61,
        syscall: "connect",
        address,
        port
    });

const URL_ = "postgresql://app:secret@db.internal:6543/shop";

describe("deepestErrorMessage", () => {
    it("digs the OS sentence out of a cause chain", () => {
        const wrapped = new Error("Failed query: SELECT 1", { cause: refused("127.0.0.1", 5432) });
        expect(deepestErrorMessage(wrapped)).toBe("connect ECONNREFUSED 127.0.0.1:5432 (ECONNREFUSED)");
    });

    it("looks inside an AggregateError's children", () => {
        const aggregate = new AggregateError([refused("::1", 5432)], "All attempts failed");
        expect(deepestErrorMessage(new Error("Failed query: SELECT 1", { cause: aggregate })))
            .toContain("ECONNREFUSED");
    });

    it("never returns the drizzle wrapper, which carries the statement", () => {
        expect(deepestErrorMessage(new Error("Failed query: select * from users\nparams: a@b.c"))).toBeNull();
    });
});

describe("the connection-refused banner", () => {
    const banner = () => diagnoseDbError(refused("db.internal", 6543), URL_) ?? "";

    it("names the host and port", () => {
        expect(banner()).toContain("db.internal:6543");
    });

    it("names ECONNREFUSED, the token everyone actually searches for", () => {
        expect(banner()).toContain("ECONNREFUSED");
    });

    it("still offers the fix", () => {
        expect(banner()).toContain("docker compose up -d db");
    });

    it("never prints the connection string, which carries the password", () => {
        expect(banner()).not.toContain("secret");
        expect(parseHostInfo(URL_)).toBe("db.internal:6543");
    });
});

/**
 * Boot's first database call is the schema provisioning, not `initializeDriver`
 * — so the diagnosis above has to be reachable one step earlier. That is
 * `verifyConnection`, and it has to survive both wrappers between the
 * bootstrapper and the runtime.
 */
describe("verifyConnection reaches the boot path", () => {
    const CONFIG = { connectionString: URL_ } as never;

    it("is on the bootstrapper", () => {
        expect(typeof (createPostgresBootstrapper(CONFIG) as Record<string, unknown>).verifyConnection).toBe("function");
    });

    it("is forwarded by createPostgresAdapter", () => {
        expect(typeof (createPostgresAdapter(CONFIG) as unknown as Record<string, unknown>).verifyConnection).toBe("function");
    });

    it("says nothing when the adapter holds no connection to probe", async () => {
        // An adapter built without `connection` is a different problem, and
        // `provisioningQueryable` already refuses it with a message about the
        // adapter rather than about the network.
        const bootstrapper = createPostgresBootstrapper(CONFIG);
        await expect(bootstrapper.verifyConnection!(undefined)).resolves.toBeUndefined();
    });

    it("turns a refused probe into a message naming the host and the reason", async () => {
        const bootstrapper = createPostgresBootstrapper({
            ...(CONFIG as object),
            connection: { execute: async () => { throw refused("db.internal", 6543); } }
        } as never);

        await expect(bootstrapper.verifyConnection!(undefined)).rejects.toThrow(/db\.internal:6543.*ECONNREFUSED/s);
    });
});
