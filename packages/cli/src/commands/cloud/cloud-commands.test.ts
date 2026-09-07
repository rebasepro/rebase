/**
 * Behavioural tests for the agent-facing `rebase cloud` commands.
 *
 * The load-bearing guarantees an agent relies on are the ones asserted here:
 *   1. `--json` mode prints exactly one JSON value and nothing human.
 *   2. A secret (write-only) variable's VALUE never appears in list/reveal.
 *   3. Rollback is offered only for a successful deploy that recorded an image —
 *      never a deploy the server would 409.
 *   4. Destructive commands refuse to run non-interactively without `--yes`.
 *
 * The command handlers call `client.functions.invoke` / `client.data.collection`,
 * so a fake client stands in for the SDK and we capture stdout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setJsonModeForTest } from "./context";
import { isRollbackable, deploymentDurationMs, deploymentView, triggerInfo, type DeploymentRow } from "./deployments";
import { parseEnvAssignment } from "./env";
import { resolveExtensionAlias } from "./extensions";
import { buildSettingsPatch } from "./settings";

/* ── stdout capture ─────────────────────────────────────────────── */

function captureStdout(): { output: () => string; restore: () => void } {
    const chunks: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string) => {
        chunks.push(typeof s === "string" ? s : String(s));
        return true;
    };
    return { output: () => chunks.join(""),
restore: () => { process.stdout.write = orig; } };
}

/* ── fake SDK client ────────────────────────────────────────────── */

interface FakeClientSpec {
    invoke?: (name: string, body: unknown, opts?: { method?: string; path?: string }) => Promise<unknown>;
    find?: (collection: string, query: unknown) => Promise<{ data: unknown[] }>;
}

function fakeClient(spec: FakeClientSpec) {
    return {
        functions: { invoke: vi.fn(spec.invoke ?? (async () => ({}))) },
        data: {
            collection: (name: string) => ({
                find: async (q: unknown) => (spec.find ? spec.find(name, q) : { data: [] }),
                findById: async () => undefined,
                update: async () => ({}),
                create: async () => ({}),
                delete: async () => ({})
            })
        },
        auth: { getSession: () => ({ accessToken: "t",
expiresAt: Date.now() + 1e9 }) }
    };
}

// The command modules import `requireClient` from context; mock it to return our
// fake, and make project resolution deterministic. `requireProject` yields the
// resolved id; `displayProjectRef` yields the slug shown in human output.
vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        requireClient: vi.fn(),
        requireProject: vi.fn(async () => "proj_1"),
        requireProjectRef: vi.fn(() => "proj-one"),
        displayProjectRef: vi.fn(() => "proj-one")
    };
});

// The dispatch tests below assert *routing*, so the resource group handlers are
// replaced by spies — running them would need a control-plane client.
vi.mock("./resources", () => ({
    statusCommand: vi.fn(async () => undefined),
    metricsCommand: vi.fn(async () => undefined),
    webhooksCommand: vi.fn(async () => undefined),
    storageCommand: vi.fn(async () => undefined),
    clustersCommand: vi.fn(async () => undefined),
    billingCommand: vi.fn(async () => undefined),
    // The dispatcher's GROUP_HELP map holds this at module scope, so omitting it
    // from the mock makes importing `./index` throw before any test runs.
    printStorageHelp: vi.fn()
}));

import * as context from "./context";
import { envCommand } from "./env";
import { deploymentsListCommand, rollbackCommand } from "./deployments";
import { dbCommand } from "./databases";
import { cloudCommand, positionals } from "./index";
import { statusCommand, storageCommand } from "./resources";

function useClient(client: unknown): void {
    (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ client,
url: "https://cp.example" });
}

beforeEach(() => setJsonModeForTest(true));
afterEach(() => {
    setJsonModeForTest(false);
    vi.clearAllMocks();
});

/* ── pure helpers ───────────────────────────────────────────────── */

describe("parseEnvAssignment", () => {
    it("splits KEY=VALUE on the first =", () => {
        expect(parseEnvAssignment(["DB_URL=postgres://a=b"])).toEqual({ key: "DB_URL",
value: "postgres://a=b" });
    });
    it("supports KEY VALUE form", () => {
        expect(parseEnvAssignment(["KEY", "val"])).toEqual({ key: "KEY",
value: "val" });
    });
    it("returns null when no key", () => {
        expect(parseEnvAssignment([])).toBeNull();
    });
});

describe("resolveExtensionAlias", () => {
    it("maps pgvector to the real identifier vector", () => {
        expect(resolveExtensionAlias("pgvector")).toBe("vector");
        expect(resolveExtensionAlias("PgVector")).toBe("vector");
    });
    it("leaves other names alone", () => {
        expect(resolveExtensionAlias("postgis")).toBe("postgis");
    });
});

describe("buildSettingsPatch", () => {
    it("includes only the flags supplied, lowercasing the subdomain", () => {
        expect(buildSettingsPatch({ name: "New",
subdomain: "ACME" })).toEqual({ name: "New",
subdomain: "acme" });
    });
    it("is empty when nothing is passed", () => {
        expect(buildSettingsPatch({})).toEqual({});
    });
});

describe("isRollbackable (the safety rule)", () => {
    it("is true only for a successful deploy with an image", () => {
        expect(isRollbackable({ id: 1,
status: "success",
imageUrl: "img:1" })).toBe(true);
    });
    it("is false when the image is missing, even if successful", () => {
        expect(isRollbackable({ id: 1,
status: "success" })).toBe(false);
    });
    it("is false for a failed deploy that has an image", () => {
        expect(isRollbackable({ id: 1,
status: "failed",
imageUrl: "img:1" })).toBe(false);
    });

    // A managed deploy publishes no image — the platform image is the
    // platform's half of the runtime — and ships a BUNDLE instead. While this
    // rule knew only about images, `rebase cloud rollback` refused every managed
    // project locally, before the server was ever asked.
    it("is true for a successful managed deploy, which has a bundle and no image", () => {
        expect(isRollbackable({ id: 1,
status: "success",
bundleId: "bundle-1" })).toBe(true);
        expect(isRollbackable({ id: 1,
status: "success",
bundle_id: "bundle-1" })).toBe(true);
    });

    it("is false for a failed managed deploy", () => {
        expect(isRollbackable({ id: 1,
status: "failed",
bundleId: "bundle-1" })).toBe(false);
    });

    it("is false for a managed row from before bundles were recorded", () => {
        expect(isRollbackable({ id: 1,
status: "success",
bundleId: "" })).toBe(false);
    });

    it("publishes the bundle beside the image, so a script can tell them apart", () => {
        const view = deploymentView({ id: 7,
status: "success",
bundleId: "bundle-1" });
        expect(view.bundle).toBe("bundle-1");
        expect(view.image).toBeNull();
        expect(view.rollbackable).toBe(true);
    });
});

describe("deploymentDurationMs", () => {
    it("is null while a build is still running (no finishedAt)", () => {
        expect(deploymentDurationMs({ id: 1,
createdAt: "2026-01-01T00:00:00Z" })).toBeNull();
    });
    it("is finishedAt − createdAt in ms", () => {
        expect(
            deploymentDurationMs({ id: 1,
createdAt: "2026-01-01T00:00:00Z",
finishedAt: "2026-01-01T00:00:08Z" })
        ).toBe(8000);
    });
});

/* ── env list: never leaks a value, JSON is a single object ─────── */

describe("env list --json", () => {
    it("prints one JSON object with keys but NO values, secret marked", async () => {
        const client = fakeClient({
            invoke: async (name, _body, opts) => {
                expect(name).toBe("env-vars");
                expect(opts?.method).toBe("GET");
                return {
                    vars: [
                        { id: "1",
key: "PUBLIC_URL",
secret: false,
valueSet: true,
createdAt: null,
updatedAt: null },
                        { id: "2",
key: "STRIPE_SECRET",
secret: true,
valueSet: true,
createdAt: null,
updatedAt: null }
                    ],
                    pendingRedeploy: true,
                    pendingSince: null,
                    limits: { maxVars: 100,
maxValueBytes: 1,
maxTotalBytes: 1,
keyPattern: "x",
reservedKeys: [] }
                };
            }
        });
        useClient(client);
        const cap = captureStdout();
        await envCommand("list", ["node", "rebase", "cloud", "env", "list", "--json"]);
        cap.restore();

        const text = cap.output().trim();
        // The WHOLE of stdout must parse: one JSON value, nothing human.
        const parsed = JSON.parse(text);
        expect(parsed.vars.map((v: { key: string }) => v.key)).toEqual(["PUBLIC_URL", "STRIPE_SECRET"]);
        expect(parsed.pendingRedeploy).toBe(true);
        // The secret's shape is present; its VALUE is not — no `value` field at all.
        for (const v of parsed.vars) expect(v).not.toHaveProperty("value");
        // And the whole blob must not contain a value string we never fetched.
        expect(text).not.toContain("sk_live");
    });
});

/* ── env reveal: a secret var is refused, never sent to /reveal ──── */

describe("env reveal of a secret var", () => {
    it("fails without calling /reveal (write-only)", async () => {
        const invoke = vi.fn(async (name: string, _b: unknown, opts?: { path?: string }) => {
            if (name === "env-vars" && opts?.path === "proj_1") {
                return { vars: [{ id: "2",
key: "STRIPE_SECRET",
secret: true,
valueSet: true,
createdAt: null,
updatedAt: null }],
pendingRedeploy: false,
pendingSince: null,
limits: {} };
            }
            throw new Error("reveal should NOT be called for a secret var");
        });
        useClient(fakeClient({ invoke }));

        const cap = captureStdout();
        const exit = vi.spyOn(process, "exit").mockImplementation(((): never => {
            throw new Error("__exit__");
        }) as never);
        await expect(envCommand("reveal", ["node", "rebase", "cloud", "env", "reveal", "STRIPE_SECRET", "--json"])).rejects.toThrow("__exit__");
        cap.restore();
        exit.mockRestore();

        // /reveal was never invoked (only the list call happened).
        const revealCalls = invoke.mock.calls.filter((c) => c[2]?.path === "reveal");
        expect(revealCalls).toHaveLength(0);
        const parsed = JSON.parse(cap.output().trim());
        expect(parsed.error.code).toBe("secret_write_only");
    });
});

/* ── rollback: not offered for an ineligible deploy ─────────────── */

describe("rollback --json", () => {
    const rows: DeploymentRow[] = [
        { id: "d3",
status: "failed",
imageUrl: "img:3",
createdAt: "2026-01-03T00:00:00Z" },
        { id: "d2",
status: "success",
imageUrl: "img:2",
createdAt: "2026-01-02T00:00:00Z" },
        { id: "d1",
status: "success",
imageUrl: "img:1",
createdAt: "2026-01-01T00:00:00Z" }
    ];

    it("refuses an explicitly named ineligible deploy WITHOUT calling deploy/rollback", async () => {
        const invoke = vi.fn(async () => ({}));
        useClient(fakeClient({ invoke,
find: async () => ({ data: rows }) }));

        const cap = captureStdout();
        const exit = vi.spyOn(process, "exit").mockImplementation(((): never => {
            throw new Error("__exit__");
        }) as never);
        await expect(
            rollbackCommand(["node", "rebase", "cloud", "rollback", "d3", "--yes", "--json"])
        ).rejects.toThrow("__exit__");
        cap.restore();
        exit.mockRestore();

        expect(invoke).not.toHaveBeenCalled(); // never reached the server
        const parsed = JSON.parse(cap.output().trim());
        expect(parsed.error.code).toBe("deploy_not_rollbackable");
    });

    it("without an id, targets the most recent successful+image deploy (with --yes)", async () => {
        const invoke = vi.fn(async (_n: string, body: unknown) => ({
            success: true,
            deployment: { id: "d4" },
            rolledBackTo: (body as { deploymentId?: string }).deploymentId,
            imageUrl: "img:2"
        }));
        useClient(fakeClient({ invoke,
find: async () => ({ data: rows }) }));

        const cap = captureStdout();
        await rollbackCommand(["node", "rebase", "cloud", "rollback", "--yes", "--json"]);
        cap.restore();

        // Called deploy/rollback with the newest ROLLBACKABLE deploy (d2), not the
        // failed d3 (which is newest overall) and not the old d1.
        expect(invoke).toHaveBeenCalledTimes(1);
        expect((invoke.mock.calls[0][1] as { deploymentId: string }).deploymentId).toBe("d2");
        const parsed = JSON.parse(cap.output().trim());
        expect(parsed.rolledBackTo).toBe("d2");
    });
});

/* ── db info: password hidden unless --reveal ───────────────────── */

describe("db info --json", () => {
    const infoBody = {
        type: "managed",
        host: "h",
        port: "5432",
        database: "app",
        username: "u",
        passwordAvailable: true,
        portForward: null,
        unavailableReason: null
    };

    it("omits the password without --reveal", async () => {
        const invoke = vi.fn(async (_n: string, _b: unknown, opts?: { path?: string }) => {
            if (opts?.path === "reveal") throw new Error("reveal must not be called");
            return infoBody;
        });
        useClient(fakeClient({ invoke }));
        const cap = captureStdout();
        await dbCommand("info", ["node", "rebase", "cloud", "db", "info", "--json"]);
        cap.restore();

        const parsed = JSON.parse(cap.output().trim());
        expect(parsed).not.toHaveProperty("password");
        expect(parsed.passwordAvailable).toBe(true);
    });

    it("includes the password only when --reveal is passed", async () => {
        const invoke = vi.fn(async (_n: string, _b: unknown, opts?: { path?: string }) => {
            if (opts?.path === "reveal") return { password: "s3cr3t",
connectionString: "postgres://u:s3cr3t@h/app" };
            return infoBody;
        });
        useClient(fakeClient({ invoke }));
        const cap = captureStdout();
        await dbCommand("info", ["node", "rebase", "cloud", "db", "info", "--reveal", "--json"]);
        cap.restore();

        const parsed = JSON.parse(cap.output().trim());
        expect(parsed.password).toBe("s3cr3t");
    });
});

/* ── deployment history shaping ─────────────────────────────────── */

describe("deployments list --json", () => {
    it("shapes rows with rollbackable + duration and a stable trigger object", async () => {
        const rows: DeploymentRow[] = [
            { id: "d2",
status: "deploying",
createdAt: "2026-01-02T00:00:00Z",
triggerSource: "cli",
triggeredBy: "user" },
            { id: "d1",
status: "success",
imageUrl: "img:1",
createdAt: "2026-01-01T00:00:00Z",
finishedAt: "2026-01-01T00:00:10Z" }
        ];
        useClient(fakeClient({ find: async () => ({ data: rows }) }));
        const cap = captureStdout();
        await deploymentsListCommand(["node", "rebase", "cloud", "deployments", "list", "--json"]);
        cap.restore();

        const parsed = JSON.parse(cap.output().trim());
        expect(parsed.deployments).toHaveLength(2);
        expect(parsed.deployments[0].durationMs).toBeNull(); // still running
        expect(parsed.deployments[0].rollbackable).toBe(false);
        expect(parsed.deployments[1].durationMs).toBe(10000);
        expect(parsed.deployments[1].rollbackable).toBe(true);
    });
});

describe("triggerInfo", () => {
    it("normalises unknown source/by to 'unknown'", () => {
        expect(triggerInfo({ id: 1,
triggerSource: "bogus",
triggeredBy: "??" })).toEqual({ by: "unknown",
source: "unknown",
userId: "" });
    });
});

/* ── destructive confirm gate (non-interactive) ─────────────────── */

describe("confirmDestructive", () => {
    it("returns immediately when --yes was passed", async () => {
        await expect(context.confirmDestructive({ yes: true,
prompt: "x" })).resolves.toBeUndefined();
    });

    it("REFUSES (never prompts) in JSON/non-TTY mode without --yes", async () => {
        setJsonModeForTest(true);
        const cap = captureStdout();
        const exit = vi.spyOn(process, "exit").mockImplementation(((): never => {
            throw new Error("__exit__");
        }) as never);
        await expect(context.confirmDestructive({ yes: false,
prompt: "delete?" })).rejects.toThrow("__exit__");
        cap.restore();
        exit.mockRestore();
        const parsed = JSON.parse(cap.output().trim());
        expect(parsed.error.code).toBe("confirmation_required");
    });
});

/* ── subcommand dispatch ────────────────────────────────────────── */

describe("cloud subcommand dispatch", () => {
    /**
     * `rawArgs` is the whole of `process.argv`, so a resource group sits at
     * index 3 and index 2 is always the literal "cloud". A handler that
     * re-derives its own action by indexing rawArgs therefore matches nothing,
     * silently, and falls through to the group's default behaviour — which is
     * exactly what `storage create` and `storage attach` did when they shipped:
     * both advertised in the help, neither reachable.
     *
     * The dispatcher resolves the action positionally. This pins that contract
     * so the next resource group cannot repeat it.
     */
    beforeEach(() => {
        vi.mocked(storageCommand).mockClear();
        vi.mocked(statusCommand).mockClear();
    });

    /**
     * These call the real `positionals`. They used to call a copy declared in
     * this file as `rawArgs.slice(3).filter(a => !a.startsWith("-"))` — which
     * dropped flags, while the real function did not. So the copy had the
     * behaviour the tests assert, the dispatcher did not, and every case below
     * passed for as long as `rebase cloud --json storage create` was broken.
     * A local re-implementation of the thing under test can only ever confirm
     * itself.
     */
    it("resolves the group and action positionally", () => {
        expect(positionals(["node", "cli", "cloud", "storage", "create"]).slice(0, 2))
            .toEqual(["storage", "create"]);
        expect(positionals(["node", "cli", "cloud", "storage", "attach", "--bucket", "b"])[1])
            .toBe("attach");
        // Bare `rebase cloud storage` has no action, which is the list path.
        expect(positionals(["node", "cli", "cloud", "storage"])[1]).toBeUndefined();
        expect(positionals(["node", "cli", "cloud"])[0]).toBeUndefined();
    });

    /**
     * The reported bug. `arg`'s `permissive: true` does not skip an undeclared
     * flag, it pushes it into `_` beside the positionals — so a flag written
     * before the group took the group's place and `rebase cloud --json storage
     * create` dispatched to a group named "--json".
     *
     * `--project` is the sharp case, and the reason filtering `-`-prefixed
     * tokens is not on its own a fix: `arg` leaves the flag's *value* in `_`
     * too, so the group came out as the project name — a real-looking word, in
     * the right position, that no `startsWith("-")` test can catch.
     */
    it.each([
        ["flag before the group", ["node", "cli", "cloud", "--json", "storage", "create"]],
        ["flag between group and action", ["node", "cli", "cloud", "storage", "--json", "create"]],
        ["value-taking flag before the group", ["node", "cli", "cloud", "--project", "acme", "storage", "create"]],
        ["its short alias", ["node", "cli", "cloud", "-p", "acme", "storage", "create"]],
        ["several, on both sides", ["node", "cli", "cloud", "--json", "-p", "acme", "storage", "--yes", "create"]],
        ["an undeclared boolean flag", ["node", "cli", "cloud", "--verbose", "storage", "create"]]
    ])("resolves storage/create with a %s", (_label, argv) => {
        expect(positionals(argv).slice(0, 2)).toEqual(["storage", "create"]);
    });

    /**
     * A flag *after* the action belongs to the handler, and must be left alone —
     * otherwise fixing the leading case would eat the group's own options.
     */
    it("leaves flags after the action for the handler to parse", () => {
        const pos = positionals(["node", "cli", "cloud", "storage", "create", "--bucket", "b"]);
        expect(pos.slice(0, 2)).toEqual(["storage", "create"]);
    });

    /**
     * End to end through the dispatcher, because `positionals` being right is
     * necessary and not sufficient: `cloudCommand` also had to stop preferring
     * the `subcommand` the top-level parser passes it. That parser is generic
     * over every command and cannot know which flags `cloud` takes, so for
     * `cloud --json storage create` it reported the subcommand as "--json" —
     * and the dispatcher trusted it over its own positionals.
     */
    it("routes a flag-prefixed line to the storage handler with the right action", async () => {
        const storage = vi.mocked(storageCommand);
        storage.mockClear();

        // "--json" is what `cli.ts` derives as the subcommand for this line.
        await cloudCommand("--json", ["node", "cli", "cloud", "--json", "storage", "create"]);

        expect(storage).toHaveBeenCalledTimes(1);
        expect(storage.mock.calls[0][0]).toBe("create");
    });

    it("still routes a clean line, and still prints help for a bare `cloud`", async () => {
        const storage = vi.mocked(storageCommand);
        storage.mockClear();

        await cloudCommand("storage", ["node", "cli", "cloud", "storage", "create"]);
        expect(storage.mock.calls[0][0]).toBe("create");

        // No group at all: help, and nothing dispatched. The help printer uses
        // `console.log`, which vitest intercepts above `process.stdout.write`,
        // so the stdout shim the rest of this file uses would see nothing.
        // No group at all: the index, and nothing dispatched. Under vitest
        // stdout is not a TTY, so `initOutputMode` latches JSON — and the index
        // answers in JSON rather than printing the human page to a caller that
        // asked for one parseable value. `storage` is a group either way, so the
        // assertion holds across both renderings; the parse is what pins WHICH
        // one we got.
        storage.mockClear();
        const cap = captureStdout();
        await cloudCommand(undefined, ["node", "cli", "cloud"]);
        cap.restore();

        expect(storage).not.toHaveBeenCalled();
        // `actions` is a list of descriptions now, not of bare words: a piped
        // `--help` carries what the terminal page carries.
        const help = JSON.parse(cap.output()) as { command: string; actions: Array<{ action: string }> };
        expect(help.command).toBe("cloud");
        expect(help.actions.map(a => a.action)).toContain("storage");
    });

    /**
     * Kept from the parallel sweep of this file: the argv shape itself. The
     * first three entries are the runtime, the script and the literal "cloud",
     * whatever the first two happen to be called.
     */
    it("reads past the runtime and script names, whatever they are", () => {
        expect(positionals(["/usr/bin/node", "/x/y/rebase.js", "cloud", "db", "list"]))
            .toEqual(["db", "list"]);
    });

    it("routes `cloud storage create` to the storage group, passing the whole argv", async () => {
        vi.mocked(storageCommand).mockClear();
        const rawArgs = ["node", "cli", "cloud", "storage", "create", "--region", "eu"];
        await cloudCommand("storage", rawArgs);
        expect(storageCommand).toHaveBeenCalledWith("create", rawArgs);
    });

    it("routes a bare `cloud storage` with no action — the list path", async () => {
        vi.mocked(storageCommand).mockClear();
        const rawArgs = ["node", "cli", "cloud", "storage"];
        await cloudCommand("storage", rawArgs);
        expect(storageCommand).toHaveBeenCalledWith(undefined, rawArgs);
    });

    it("takes the group from the positionals when no subcommand is passed in", async () => {
        vi.mocked(storageCommand).mockClear();
        vi.mocked(statusCommand).mockClear();
        await cloudCommand(undefined, ["node", "cli", "cloud", "status"]);
        expect(statusCommand).toHaveBeenCalled();
        expect(storageCommand).not.toHaveBeenCalled();
    });
});

/* keep the shaping helper referenced in one place for clarity */
void deploymentView;
