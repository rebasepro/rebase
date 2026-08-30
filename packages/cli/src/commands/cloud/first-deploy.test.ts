/**
 * The two-command trap, and the two halves of removing it.
 *
 * A project created through `rebase cloud projects create` had no database. It
 * was written `status: "provisioning"`, `database: null`, and there was no
 * command in the CLI's output, its help, or the deployment skill that named
 * `rebase cloud db create` as the missing step. So the first-deploy sequence
 * everybody follows deadlocked at a status word that means the opposite of what
 * it says.
 *
 * Two things are asserted here:
 *
 *  1. `projects create` attaches a managed database by default, so the state is
 *     not reachable by following the obvious path — and `--db none` still gets
 *     you there deliberately, with the command that finishes the job printed.
 *  2. `db create --wait` does NOT poll a managed database. There is nothing to
 *     poll: CloudNativePG materialises it at the first deploy. A `--wait` that
 *     looped would be the same non-terminating wait in a new place.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        requireClient: vi.fn(),
        requireProject: vi.fn(async () => "proj_1"),
        requireProjectRef: vi.fn(() => "shop"),
        displayProjectRef: vi.fn(() => "shop"),
        getContextOrg: vi.fn(() => "org_1"),
        fetchTenantBaseDomain: vi.fn(async () => "rebase.website"),
        fetchDeployTargets: vi.fn(async () => [{ clusterId: null,
provider: "gcp",
region: "europe-west1" }]),
        writeLink: vi.fn()
    };
});

import * as context from "./context";
import { createProject } from "./projects";
import { dbCommand, waitForDatabase } from "./databases";

/** `rebase cloud <words…>` as `process.argv`. */
function argv(...words: string[]): string[] {
    return ["/usr/bin/node", "/x/y/rebase.js", "cloud", ...words];
}

interface Recorded { collection: string; data: Record<string, unknown> }

/** A control-plane client that records every row it is asked to create. */
function fakeClient(
    recorded: Recorded[],
    opts: { invoke?: ReturnType<typeof vi.fn>; rows?: Record<string, unknown[]> } = {}
) {
    return {
        auth: { getUser: async () => ({ uid: "user_1" }),
getSession: () => ({ accessToken: "t" }) },
        data: {
            collection: (name: string) => ({
                create: async (data: Record<string, unknown>) => {
                    recorded.push({ collection: name,
data });
                    return { id: `${name}_1`,
subdomain: data.subdomain,
...data };
                },
                find: async () => ({ data: opts.rows?.[name] ?? [] }),
                findById: async () => undefined
            })
        },
        functions: { invoke: opts.invoke ?? vi.fn(async () => ({ available: true })) }
    };
}

let recorded: Recorded[];
/**
 * Everything the command said, both streams.
 *
 * stdout carries the result and stderr carries the narration — `note`, `warn`
 * and `success` all write to stderr on purpose, so that a piped run's stdout
 * holds one JSON value and nothing else. A test that watched only `console.log`
 * would report every remedy line as missing.
 */
let logs: string[];

beforeEach(() => {
    vi.clearAllMocks();
    recorded = [];
    logs = [];
    const capture = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
    vi.spyOn(console, "log").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => {
        logs.push(String(chunk));
        return true;
    }) as never);
    context.setJsonModeForTest(false);
});

describe("rebase cloud projects create", () => {
    it("attaches a managed database in the same call, by default", async () => {
        (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
            client: fakeClient(recorded),
            url: "https://cp.example"
        });

        await createProject(argv("projects", "create", "--name", "Shop", "--subdomain", "shop"));

        // The whole point: two rows, from one command.
        expect(recorded.map(r => r.collection)).toEqual(["projects", "databases"]);
        expect(recorded[1].data).toMatchObject({ project: "projects_1",
type: "managed" });
    });

    it("honours --db none, and prints the command that finishes the job", async () => {
        (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
            client: fakeClient(recorded),
            url: "https://cp.example"
        });

        await createProject(argv("projects", "create", "--name", "Shop", "--subdomain", "shop", "--db", "none"));

        expect(recorded.map(r => r.collection)).toEqual(["projects"]);
        // Opting out is allowed; leaving without the remedy is not.
        expect(logs.join("\n")).toContain("rebase cloud db create --type managed");
    });

    it("carries the connection string through for --db byodb", async () => {
        (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
            client: fakeClient(recorded),
            url: "https://cp.example"
        });

        await createProject(argv(
            "projects", "create", "--name", "Shop", "--subdomain", "shop",
            "--db", "byodb", "--connection-string", "postgres://u:p@h/db"
        ));

        expect(recorded[1].data).toMatchObject({
            type: "byodb",
            connectionString: "postgres://u:p@h/db"
        });
    });

    it("refuses --db byodb with nothing to point at, before creating the project", async () => {
        (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
            client: fakeClient(recorded),
            url: "https://cp.example"
        });
        const exit = vi.spyOn(process, "exit").mockImplementation(((): never => {
            throw new Error("__exit__");
        }) as never);

        await expect(createProject(argv(
            "projects", "create", "--name", "Shop", "--subdomain", "shop", "--db", "byodb"
        ))).rejects.toThrow("__exit__");

        // Refusing after the insert would leave a project that exists and
        // cannot deploy — the exact state this flag removes.
        expect(recorded).toEqual([]);
        exit.mockRestore();
    });

    it("refuses an unknown --db value rather than creating a project without one", async () => {
        (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
            client: fakeClient(recorded),
            url: "https://cp.example"
        });
        const exit = vi.spyOn(process, "exit").mockImplementation(((): never => {
            throw new Error("__exit__");
        }) as never);

        await expect(createProject(argv(
            "projects", "create", "--name", "Shop", "--subdomain", "shop", "--db", "manged"
        ))).rejects.toThrow("__exit__");
        expect(recorded).toEqual([]);
        exit.mockRestore();
    });

    it("reports a project that was created when its database was not", async () => {
        const client = fakeClient(recorded);
        const original = client.data.collection;
        client.data.collection = ((name: string) => {
            const c = original(name);
            if (name !== "databases") return c;
            return { ...c,
create: async () => { throw new Error("permission denied for table databases"); } };
        }) as typeof client.data.collection;
        (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
            client,
            url: "https://cp.example"
        });

        await createProject(argv("projects", "create", "--name", "Shop", "--subdomain", "shop"));

        // Not an exception: the project is real, and saying "create failed"
        // about it would be false. Half-succeeded is its own outcome.
        const printed = logs.join("\n");
        expect(printed).toContain("permission denied for table databases");
        expect(printed).toContain("rebase cloud db create --type managed --project shop");
    });
});

describe("rebase cloud db create --wait", () => {
    it("does not poll for a managed database, and says why", async () => {
        const invoke = vi.fn(async () => ({ success: false }));
        (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
            client: fakeClient(recorded, { invoke }),
            url: "https://cp.example"
        });

        await dbCommand("create", argv("db", "create", "--type", "managed", "--wait"));

        // `db-test` is the poll. Not calling it is the assertion: a managed
        // database does not exist until the first deploy, so a loop here would
        // never terminate — which is the shape `--wait` exists to replace.
        expect(invoke).not.toHaveBeenCalled();
        expect(logs.join("\n")).toContain("first deploy");
    });

    it("polls db-test for a bring-your-own database, and stops when it answers", async () => {
        // Driven directly, with the poll interval collapsed. Going through
        // `dbCommand` here would mean three real seconds of sleeping to observe
        // one retry, and the retry is the whole assertion.
        let calls = 0;
        const invoke = vi.fn(async () => ({ success: ++calls >= 3 }));
        const client = fakeClient(recorded, { invoke });

        const result = await waitForDatabase(client as never, {
            projectId: "proj_1",
            type: "byodb",
            timeoutMs: 5000,
            pollMs: 0
        });

        expect(result).toEqual({ waited: true,
connectionStatus: "connected" });
        expect(invoke).toHaveBeenCalledTimes(3);
        expect(invoke.mock.calls[0][0]).toBe("db-test");
    });

    it("gives up on a byodb database that never answers, rather than looping", async () => {
        const invoke = vi.fn(async () => ({ success: false }));
        const client = fakeClient(recorded, { invoke });
        const exit = vi.spyOn(process, "exit").mockImplementation(((): never => {
            throw new Error("__exit__");
        }) as never);

        await expect(waitForDatabase(client as never, {
            projectId: "proj_1",
            type: "byodb",
            timeoutMs: 0,
            pollMs: 0
        })).rejects.toThrow("__exit__");
        exit.mockRestore();
    });

    it("refuses to attach a second database, and names the first", async () => {
        // The platform reads `databases` with `limit: 1` in three places, so a
        // second row does not add a database — it makes it undefined which one
        // the project deploys against. Now that `projects create` attaches one,
        // `db create --type byodb` is the obvious way to reach that state.
        const client = fakeClient(recorded, {
            rows: { databases: [{ id: "db_1",
type: "managed" }] }
        });
        (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
            client,
            url: "https://cp.example"
        });
        const exit = vi.spyOn(process, "exit").mockImplementation(((): never => {
            throw new Error("__exit__");
        }) as never);

        await expect(dbCommand("create", argv(
            "db", "create", "--type", "byodb", "--connection-string", "postgres://u:p@h/db"
        ))).rejects.toThrow("__exit__");

        expect(recorded).toEqual([]);
        expect(logs.join("\n")).toContain("db_1");
        exit.mockRestore();
    });

    it("attaches without waiting when --wait is not given", async () => {
        const invoke = vi.fn(async () => ({ success: true }));
        (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
            client: fakeClient(recorded, { invoke }),
            url: "https://cp.example"
        });

        await dbCommand("create", argv("db", "create", "--type", "managed"));

        expect(recorded.map(r => r.collection)).toEqual(["databases"]);
        expect(invoke).not.toHaveBeenCalled();
    });
});
