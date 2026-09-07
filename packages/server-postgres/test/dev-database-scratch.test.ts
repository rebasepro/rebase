/**
 * The Atlas scratch database: what happens when it cannot be made, and what
 * happens to it afterwards.
 *
 * Atlas plans every change in a throwaway copy of the schema, which this
 * creates as `<db>_dev_diff` beside the real database. Two things were wrong:
 *
 *  - **The cause was thrown away.** An empty catch, commented "Ignore, let
 *    Atlas handle connection failures". Atlas's version of handling it is
 *    `postgres: querying system variables: pq: database "app_dev_diff" does
 *    not exist (3D000)`, four frames downstream, and `CREATE DATABASE` is a
 *    privilege managed providers withhold — so this is the first thing a
 *    hosted user hits and the one they can act on least.
 *  - **It was never dropped.** One per target, forever, and the only notice was
 *    `rebase db branch prune` reporting "3 Atlas scratch database(s) left over
 *    from db push".
 */
import { describeDevDatabaseFailure, ensureDevDatabaseExists, getDevDatabaseUrl } from "../src/cli-helpers";

const URL = "postgres://app:secret@db.example.com:5432/app";

/** A `pg` Client that fails to connect with the given error. */
function clientThatThrows(error: unknown) {
    return class {
        connect() { return Promise.reject(error); }
        query() { return Promise.reject(error); }
        end() { return Promise.resolve(); }
    };
}

function mockPg(error: unknown) {
    jest.doMock("pg", () => ({ Client: clientThatThrows(error) }), { virtual: false });
}

describe("getDevDatabaseUrl", () => {
    it("names the scratch database after the real one", () => {
        expect(getDevDatabaseUrl(URL)).toContain("/app_dev_diff");
    });
});

describe("describeDevDatabaseFailure", () => {
    it("names the database, the cause and the two ways out on 42501", () => {
        const err = Object.assign(new Error("permission denied to create database"), { code: "42501" });
        const text = describeDevDatabaseFailure(err, "app_dev_diff");

        expect(text).toContain("app_dev_diff");
        expect(text).toContain("permission denied to create database");
        expect(text).toContain("CREATEDB");
        expect(text).toContain("CREATE DATABASE \"app_dev_diff\"");
    });

    it("says what Atlas will fail with next for any other cause", () => {
        // The 3D000 is the symptom people search for; naming it here is what
        // connects the two lines on their terminal.
        const text = describeDevDatabaseFailure(new Error("connect ECONNREFUSED 127.0.0.1:5432"), "app_dev_diff");

        expect(text).toContain("ECONNREFUSED");
        expect(text).toContain("3D000");
    });

    it("does not print the connection string, which carries the password", () => {
        const err = Object.assign(new Error("permission denied to create database"), { code: "42501" });

        expect(describeDevDatabaseFailure(err, "app_dev_diff")).not.toContain("secret");
    });
});

describe("ensureDevDatabaseExists", () => {
    let warnings: string[];
    let spy: jest.SpyInstance;

    beforeEach(() => {
        jest.resetModules();
        warnings = [];
        spy = jest.spyOn(console, "warn").mockImplementation((line?: unknown) => {
            warnings.push(String(line ?? ""));
        });
    });

    afterEach(() => {
        spy.mockRestore();
        jest.dontMock("pg");
    });

    it("reports a role without CREATEDB instead of swallowing it", async () => {
        mockPg(Object.assign(new Error("permission denied to create database"), { code: "42501" }));
        const { ensureDevDatabaseExists: subject } = await import("../src/cli-helpers");

        const created = await subject(URL, getDevDatabaseUrl(URL));

        expect(created).toBe(false);
        expect(warnings.join("\n")).toContain("CREATEDB");
        expect(warnings.join("\n")).toContain("app_dev_diff");
    });

    it("reports an unreachable server too, rather than leaving Atlas to say 3D000", async () => {
        mockPg(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" }));
        const { ensureDevDatabaseExists: subject } = await import("../src/cli-helpers");

        await subject(URL, getDevDatabaseUrl(URL));

        expect(warnings.join("\n")).toContain("Could not create the Atlas scratch database");
    });

    it("never throws — a push must not die here", async () => {
        mockPg(new Error("something nobody classified"));
        const { ensureDevDatabaseExists: subject } = await import("../src/cli-helpers");

        await expect(subject(URL, getDevDatabaseUrl(URL))).resolves.toBe(false);
    });
});

describe("the exported surface", () => {
    it("still offers ensureDevDatabaseExists to the CLI", () => {
        expect(typeof ensureDevDatabaseExists).toBe("function");
    });
});
