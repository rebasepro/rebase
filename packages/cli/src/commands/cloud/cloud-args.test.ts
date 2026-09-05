/**
 * What a `rebase cloud` command reads as its ARGUMENT.
 *
 * Every command here used to resolve its operands with `cloudPositionals` —
 * `rawArgs.slice(3).filter(a => !a.startsWith("-"))` — or a copy of it. That
 * filter fails in two directions, and both are asserted below:
 *
 *  - **It keeps a flag's VALUE.** `arg` is not involved, so `--project acme`
 *    contributes "acme" to the operand list: a plain word, in the argument
 *    position, that no `startsWith("-")` test can distinguish from a real one.
 *    `--project` is documented on every one of these commands, so this was
 *    reachable straight off the help page — `env unset -p acme` removed a
 *    variable called "acme", `webhooks delete --project acme 42` deleted "acme"
 *    rather than 42.
 *  - **It drops an undeclared flag without refusing it.** The flag leaves the
 *    operand list but not the run, so the command proceeds with its argument
 *    missing or defaulted: `db backup --dry-run` listed, `domains remove
 *    --dry-run` detached the domain, `env set KEY=v --secrett` stored the value
 *    as an ordinary readable variable. `projects info|delete` resolved its id
 *    through `positionals()` rather than the filter, and there the undeclared
 *    flag became the id outright.
 *
 * The fix is to parse the whole line strictly (`parseCloudArgs`), so `arg`
 * consumes each declared flag together with its value and refuses the rest.
 * These tests drive the real resolvers, not copies of them: a re-implementation
 * of the thing under test can only ever confirm itself, which is exactly how
 * the previous version of the dispatch test stayed green while the dispatcher
 * was broken.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setJsonModeForTest } from "./context";

// `requireProjectRef` is the fallback `projects info|delete` uses when no id is
// given; the rest keep the handler tests below off the network.
vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        requireClient: vi.fn(),
        requireProject: vi.fn(async () => "proj_1"),
        requireProjectRef: vi.fn(() => "linked-project"),
        displayProjectRef: vi.fn(() => "linked-project")
    };
});

import * as context from "./context";
import { resolveEnvSetArgs, resolveEnvKeyArg, envCommand } from "./env";
import { resolveDomainArg } from "./domains";
import { resolveExtensionArgs } from "./extensions";
import { resolveDeploymentIdArg } from "./deployments";
import { resolveBackupArgs } from "./databases";
import {
    resolveWebhookIdArg,
    webhooksCommand,
    resolveClusterVerifyArgs,
    storageCommand,
    clustersCommand,
    resourcesCommand,
    billingCommand
} from "./resources";
import { resolveProjectArg } from "./projects";
import { resolveDeployArgs } from "./deploy";

/** `rebase <words…>` as `process.argv` — what every command is handed. */
function argv(...words: string[]): string[] {
    return ["/usr/bin/node", "/x/y/rebase.js", "cloud", ...words];
}

/**
 * Run something that must refuse, and return the parsed `{error}` payload.
 *
 * A refusal in this family is `fail`: exactly one JSON value on stdout and a
 * non-zero exit, never a thrown error — see `expectsJsonNotAThrow` below.
 */
async function refusalOf(run: () => unknown): Promise<{ message: string; code: string | null }> {
    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    // @ts-expect-error test shim
    process.stdout.write = (s: string) => {
        chunks.push(typeof s === "string" ? s : String(s));
        return true;
    };
    const exit = vi.spyOn(process, "exit").mockImplementation(((): never => {
        throw new Error("__exit__");
    }) as never);

    let exited = false;
    try {
        await run();
    } catch (e) {
        exited = e instanceof Error && e.message === "__exit__";
        if (!exited) {
            process.stdout.write = origWrite;
            exit.mockRestore();
            throw e;
        }
    } finally {
        process.stdout.write = origWrite;
        exit.mockRestore();
    }

    expect(exited).toBe(true);
    return JSON.parse(chunks.join("").trim()).error;
}

beforeEach(() => setJsonModeForTest(true));
afterEach(() => {
    setJsonModeForTest(false);
    vi.clearAllMocks();
});

/* ══════════════════════════════════════════════════════════════════
   A declared flag's value is never the argument
   ══════════════════════════════════════════════════════════════════ */

describe("--project's value is not an argument", () => {
    /**
     * `-p <slug>` is how the help page says to act on an unlinked project, so
     * every line here is one a user is invited to type. The number in the
     * comment is what the old filter returned.
     */
    it.each([
        ["env unset", () => resolveEnvKeyArg(argv("env", "unset", "-p", "acme"), "unset")], // "acme"
        ["env reveal", () => resolveEnvKeyArg(argv("env", "reveal", "--project", "acme"), "reveal")], // "acme"
        ["domains add", () => resolveDomainArg(argv("domains", "add", "-p", "acme"))], // "acme"
        ["rollback", () => resolveDeploymentIdArg(argv("rollback", "-p", "acme"), "cloud rollback").id], // "acme"
        ["cancel", () => resolveDeploymentIdArg(argv("cancel", "--project", "acme"), "cloud cancel").id], // "acme"
        ["extensions enable", () => resolveExtensionArgs(argv("extensions", "enable", "-p", "acme"), "enable").name], // "acme"
        ["extensions disable", () => resolveExtensionArgs(argv("extensions", "disable", "-p", "acme"), "disable").name], // "acme"
        ["webhooks delete", () => resolveWebhookIdArg(argv("webhooks", "delete", "-p", "acme"))], // "acme"
        ["db backup restore", () => resolveBackupArgs(argv("db", "backup", "restore", "-p", "acme")).filename] // "acme"
    ])("%s reads no argument from `-p acme`", (_label, resolve) => {
        expect(resolve()).toBeUndefined();
    });

    it("db backup reads no ACTION from `-p acme` either", () => {
        // The action decides between listing, creating, restoring over the live
        // database and printing a signed download URL. The old filter made it
        // the project slug, which fell through to a list — the flag silently
        // changed which command ran.
        expect(resolveBackupArgs(argv("db", "backup", "-p", "acme")).action).toBe("list");
    });

    /**
     * Order is the other half. With the flag written first the value took the
     * argument's place and the real argument was pushed one along, so the
     * command acted on the project slug and ignored what the caller named.
     */
    it("keeps the real argument when the flag comes first", () => {
        expect(resolveEnvKeyArg(argv("env", "unset", "--project", "acme", "API_KEY"), "unset")).toBe("API_KEY");
        expect(resolveWebhookIdArg(argv("webhooks", "delete", "--project", "acme", "42"))).toBe("42");
        expect(resolveBackupArgs(argv("db", "backup", "restore", "-p", "acme", "db.sql")).filename).toBe("db.sql");
    });

    it("still reads the argument written the ordinary way", () => {
        expect(resolveEnvKeyArg(argv("env", "unset", "API_KEY", "--project", "acme"), "unset")).toBe("API_KEY");
        expect(resolveDomainArg(argv("domains", "add", "app.example.com"))).toBe("app.example.com");
        expect(resolveDeploymentIdArg(argv("rollback", "d2", "--yes", "--json"), "cloud rollback").id).toBe("d2");
        expect(resolveExtensionArgs(argv("extensions", "enable", "vector", "-y"), "enable").name).toBe("vector");
        expect(resolveWebhookIdArg(argv("webhooks", "delete", "42"))).toBe("42");
    });

    /**
     * A flag before the group shifts nothing: `commandWords` is applied to the
     * PARSED positionals, not to a fixed argv index.
     */
    it("is unmoved by flags written before the group", () => {
        expect(resolveEnvKeyArg(argv("--json", "env", "unset", "API_KEY"), "unset")).toBe("API_KEY");
        expect(resolveEnvSetArgs(argv("-p", "acme", "env", "set", "K=v")).assignment).toEqual({ key: "K",
value: "v" });
    });
});

/* ══════════════════════════════════════════════════════════════════
   env set: the value, which is the field that gets written
   ══════════════════════════════════════════════════════════════════ */

describe("env set", () => {
    it("does not store --project's value as the variable's value", () => {
        // `env set KEY -p acme` parsed as the documented `KEY VALUE` form with
        // VALUE = "acme": a write that succeeds and reports success, and is
        // wrong. The KEY-only form means an empty value.
        expect(resolveEnvSetArgs(argv("env", "set", "KEY", "-p", "acme")).assignment).toEqual({ key: "KEY",
value: "" });
    });

    it("still takes both operand forms", () => {
        expect(resolveEnvSetArgs(argv("env", "set", "DB_URL=postgres://a=b")).assignment)
            .toEqual({ key: "DB_URL",
value: "postgres://a=b" });
        expect(resolveEnvSetArgs(argv("env", "set", "KEY", "val")).assignment)
            .toEqual({ key: "KEY",
value: "val" });
    });

    it("still reads its own flags wherever they sit", () => {
        expect(resolveEnvSetArgs(argv("env", "set", "--secret", "K=v")).flags["--secret"]).toBe(true);
        expect(resolveEnvSetArgs(argv("env", "set", "K=v", "--force")).flags["--force"]).toBe(true);
    });

    it("refuses a third operand rather than dropping it", async () => {
        const err = await refusalOf(() => resolveEnvSetArgs(argv("env", "set", "KEY", "one", "two")));
        expect(err.code).toBe("usage");
        expect(err.message).toContain("2 arguments");
    });
});

/* ══════════════════════════════════════════════════════════════════
   An undeclared flag is an error, not an argument
   ══════════════════════════════════════════════════════════════════ */

describe("an undeclared flag", () => {
    it.each([
        ["db backup restore", () => resolveBackupArgs(argv("db", "backup", "restore", "--dry-run"))],
        ["domains add", () => resolveDomainArg(argv("domains", "add", "--dry-run"))],
        ["env unset", () => resolveEnvKeyArg(argv("env", "unset", "--dry-run"), "unset")],
        ["extensions enable", () => resolveExtensionArgs(argv("extensions", "enable", "--dry-run"), "enable")],
        ["webhooks delete", () => resolveWebhookIdArg(argv("webhooks", "delete", "--dry-run"))],
        ["rollback", () => resolveDeploymentIdArg(argv("rollback", "--dry-run"), "cloud rollback")],
        ["projects delete", () => resolveProjectArg(argv("projects", "delete", "--dry-run"), "delete")]
    ])("is refused by %s, never taken as the argument", async (_label, resolve) => {
        const err = await refusalOf(resolve);
        expect(err.code).toBe("usage");
        expect(err.message).toContain("--dry-run");
    });

    /**
     * The refusal has to name the command's help, because the flag being wrong
     * is usually a memory of a real flag on a neighbouring command.
     */
    it("points at the help page for the command that refused", async () => {
        const err = await refusalOf(() => resolveDomainArg(argv("domains", "add", "--dry-run")));
        expect(err.message).toContain("rebase cloud domains add --help");
    });

    /**
     * `--debug` is what `bin/rebase.js` prints after EVERY failure as the thing
     * to re-run with, so it must be consumed rather than become the argument —
     * the same reasoning that put it in `GLOBAL_COMMAND_FLAGS`.
     */
    it("does not include --debug, the flag the CLI tells you to add", () => {
        expect(resolveDomainArg(argv("domains", "add", "app.example.com", "--debug"))).toBe("app.example.com");
        expect(resolveWebhookIdArg(argv("webhooks", "delete", "--debug"))).toBeUndefined();
    });
});

/* ══════════════════════════════════════════════════════════════════
   The refusal keeps the JSON contract
   ══════════════════════════════════════════════════════════════════ */

describe("a parse refusal in JSON mode", () => {
    /**
     * This is why the cloud family cannot call `parseCommandArgs` directly, the
     * way the non-cloud commands do. That helper THROWS, and a throw reaches
     * `bin/rebase.js`, which prints `✗ …` to stderr and exits 1 — right for
     * every other command, wrong here. `rebase cloud` enters JSON mode whenever
     * stdout is not a TTY, i.e. always for the agents this family exists for,
     * and it promises them exactly one JSON value on stdout. A throw would give
     * them an empty stdout and a human sentence on stderr.
     */
    it("is one JSON value on stdout, not a thrown error", async () => {
        const err = await refusalOf(() => resolveDomainArg(argv("domains", "add", "--dry-run")));
        expect(err).toMatchObject({ code: "usage" });
        expect(typeof err.message).toBe("string");
    });

    it("carries no ANSI escapes", async () => {
        const err = await refusalOf(() => resolveEnvKeyArg(argv("env", "unset", "--dry-run"), "unset"));
        // eslint-disable-next-line no-control-regex
        expect(err.message).not.toMatch(/\[/);
    });
});

/* ══════════════════════════════════════════════════════════════════
   projects info|delete: the optional id
   ══════════════════════════════════════════════════════════════════ */

describe("projects info|delete", () => {
    it("falls back to the linked project when no id is given", () => {
        expect(resolveProjectArg(argv("projects", "delete", "--yes"), "delete")).toBe("linked-project");
        expect(resolveProjectArg(argv("projects", "info"), "info")).toBe("linked-project");
    });

    it("takes an explicit id", () => {
        expect(resolveProjectArg(argv("projects", "delete", "shop", "--yes"), "delete")).toBe("shop");
    });
});

/* ══════════════════════════════════════════════════════════════════
   cloud deploy: the app name
   ══════════════════════════════════════════════════════════════════ */

/**
 * `deploy` was the one command in this family still reading `_[0]` off a
 * permissive `rawArgs.slice(2)`, and `_[0]` there is the command word `cloud`.
 * So the documented line refused itself:
 *
 *   $ rebase cloud deploy --bundle
 *   This repository declares no app named "cloud". It declares: backend, web.
 *
 * These assert the resolved app name directly rather than through a fixture
 * manifest, because a fixture that happened to declare an app called `cloud`
 * would have passed against the broken parse.
 */
describe("cloud deploy", () => {
    it("names NO app when the line names none", () => {
        // "cloud", every time, before the fix.
        expect(resolveDeployArgs(argv("deploy", "--bundle")).appName).toBeUndefined();
        expect(resolveDeployArgs(argv("deploy")).appName).toBeUndefined();
    });

    it("names the app the line names", () => {
        expect(resolveDeployArgs(argv("deploy", "web", "--bundle")).appName).toBe("web");
        expect(resolveDeployArgs(argv("deploy", "--bundle", "web")).appName).toBe("web");
    });

    it("is unshifted by a flag written before the group", () => {
        const line = ["/usr/bin/node", "/x/y/rebase.js", "--debug", "cloud", "deploy", "web"];
        expect(resolveDeployArgs(line).appName).toBe("web");
    });

    it("reads no app from a declared flag's value", () => {
        expect(resolveDeployArgs(argv("deploy", "-p", "acme", "--bundle")).appName).toBeUndefined();
        // `-m cloud` is the trap in miniature: a legitimate message that is also
        // the command word.
        const parsed = resolveDeployArgs(argv("deploy", "-m", "cloud", "--bundle"));
        expect(parsed.appName).toBeUndefined();
        expect(parsed.flags["--message"]).toBe("cloud");
    });

    it("keeps the flags it declares, and the ones every cloud command takes", () => {
        const { flags } = resolveDeployArgs(
            argv("deploy", "web", "--bundle", "--bundle-dir", "dist-bundle",
                "--skip-type-check", "--no-follow", "-m", "why", "--url", "http://localhost:3000")
        );
        expect(flags["--bundle"]).toBe(true);
        expect(flags["--bundle-dir"]).toBe("dist-bundle");
        expect(flags["--skip-type-check"]).toBe(true);
        expect(flags["--no-follow"]).toBe(true);
        expect(flags["--message"]).toBe("why");
        // `resolveCloudUrl` honours `--url` on every line in this family, so a
        // strict parse has to accept it here too.
        expect(flags["--url"]).toBe("http://localhost:3000");
    });

    it("takes --wait and --timeout", () => {
        // Both are new, and both are in the skill and the help page. A strict
        // parser that did not declare them would refuse the exact lines the
        // documentation tells an agent to run.
        const { flags } = resolveDeployArgs(argv("deploy", "--wait", "--timeout", "300"));
        expect(flags["--wait"]).toBe(true);
        expect(flags["--timeout"]).toBe("300");
    });

    it("refuses an undeclared flag rather than deploying an app named after it", async () => {
        const err = await refusalOf(() => resolveDeployArgs(argv("deploy", "--bundel")));
        expect(err.code).toBe("usage");
        expect(err.message).toContain("--bundel");
        expect(err.message).toContain("rebase cloud deploy --help");
    });

    it("refuses a second positional instead of ignoring it", async () => {
        const err = await refusalOf(() => resolveDeployArgs(argv("deploy", "web", "backend")));
        expect(err.code).toBe("usage");
        expect(err.message).toContain("1 argument");
    });
});

/* ══════════════════════════════════════════════════════════════════
   End to end: the wrong resource is never reached
   ══════════════════════════════════════════════════════════════════ */

describe("the destructive commands, driven end to end", () => {
    function fakeClient(hooks: { invoke?: ReturnType<typeof vi.fn>; del?: ReturnType<typeof vi.fn> }) {
        return {
            functions: { invoke: hooks.invoke ?? vi.fn(async () => ({})) },
            data: {
                collection: () => ({
                    find: async () => ({ data: [] }),
                    findById: async () => undefined,
                    update: async () => ({}),
                    create: async () => ({}),
                    delete: hooks.del ?? vi.fn(async () => ({}))
                })
            }
        };
    }

    it("`env unset -p acme` removes nothing — it asks for a KEY", async () => {
        const invoke = vi.fn(async () => ({ success: true,
pendingRedeploy: true }));
        (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
            client: fakeClient({ invoke }),
            url: "https://cp.example"
        });

        const err = await refusalOf(() => envCommand("unset", argv("env", "unset", "-p", "acme")));
        // Previously: DELETE env-vars/proj_1/acme, and a variable was gone.
        expect(invoke).not.toHaveBeenCalled();
        expect(err.code).toBe("usage");
    });

    it("`webhooks delete --project acme 42` never deletes the project slug", async () => {
        const del = vi.fn(async () => ({}));
        (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
            client: fakeClient({ del }),
            url: "https://cp.example"
        });

        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        await webhooksCommand("delete", argv("webhooks", "delete", "--project", "acme", "42"));
        log.mockRestore();

        expect(del).toHaveBeenCalledTimes(1);
        expect(del.mock.calls[0][0]).toBe("42");
    });

    /**
     * `webhooks create` names its destination `--endpoint`, and the reason is
     * not taste.
     *
     * `--url` is a GLOBAL in this family: `resolveCloudUrl` reads it off the raw
     * line, ahead of the env var and ahead of the link file, for every command.
     * So the documented `webhooks create … --url https://example.com/hook` sent
     * the customer's webhook endpoint to `requireClient` as the control plane to
     * authenticate against — the one command whose whole argument is somebody
     * else's URL. Both halves are asserted: the row gets the endpoint, and the
     * control plane is still the control plane.
     */
    it("`webhooks create --endpoint <url>` does not retarget the control plane", async () => {
        const created: Array<Record<string, unknown>> = [];
        const client = {
            functions: { invoke: vi.fn(async () => ({})) },
            data: {
                collection: () => ({
                    find: async () => ({ data: [] }),
                    findById: async () => undefined,
                    update: async () => ({}),
                    create: async (row: Record<string, unknown>) => {
                        created.push(row);
                        return { id: 7 };
                    },
                    delete: async () => ({})
                })
            }
        };
        (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
            client,
            url: "https://cp.example"
        });

        const line = argv(
            "webhooks", "create",
            "--name", "notify", "--table", "orders",
            "--endpoint", "https://example.com/hook"
        );

        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        await webhooksCommand("create", line);
        log.mockRestore();

        expect(created).toHaveLength(1);
        expect(created[0].url).toBe("https://example.com/hook");
        // The half that was the bug. `resolveCloudUrl` is the real one — the
        // module mock above leaves it alone — so this is the same read the
        // client factory makes.
        expect(context.resolveCloudUrl(line)).not.toBe("https://example.com/hook");
    });
});

/**
 * `rebase cloud clusters verify <id>` — the id has to survive the parse.
 *
 * It did not. The handler picked its id with
 *
 *   rawArgs.find(a => !a.startsWith("--") && a !== "clusters" && a !== "verify")
 *
 * and `rawArgs` is the whole `process.argv`, so the first match was **`argv[0]`,
 * the node binary path**. Every invocation asked the control plane about a
 * cluster called `/usr/bin/node`, got 404, and the 404 read as "this diagnostic
 * is not deployed yet". It is the one command that reports
 * `permissions.allowed` / `permissions.denied` — which is what names a missing
 * RBAC grant in a single call, rather than by A/B-ing a live project for twenty
 * minutes.
 *
 * The first assertion is the regression, and no fixture can paper over it: the
 * old resolver returned a path, not a name.
 */
describe("cloud clusters verify", () => {
    it("reads the id from the line, not from argv[0]", () => {
        expect(resolveClusterVerifyArgs(argv("clusters", "verify", "gke-eu")).id).toBe("gke-eu");
    });

    it("is unshifted by --baseline, wherever it sits", () => {
        expect(resolveClusterVerifyArgs(argv("clusters", "verify", "gke-eu", "--baseline")))
            .toEqual({ id: "gke-eu",
baseline: true });
        expect(resolveClusterVerifyArgs(argv("clusters", "--baseline", "verify", "gke-eu")))
            .toEqual({ id: "gke-eu",
baseline: true });
    });

    it("reads no id from a declared flag's value", () => {
        // The `--project acme` trap: a plain word in argument position.
        expect(resolveClusterVerifyArgs(argv("clusters", "verify", "-p", "acme")).id).toBeUndefined();
    });

    it("names no id when the line names none", () => {
        expect(resolveClusterVerifyArgs(argv("clusters", "verify")).id).toBeUndefined();
    });

    it("refuses an undeclared flag rather than verifying a cluster named after it", async () => {
        const err = await refusalOf(() => resolveClusterVerifyArgs(argv("clusters", "verify", "--baselin")));
        expect(err.code).toBe("usage");
    });
});

/**
 * A mistyped action word refuses. It used to run the group's DEFAULT action.
 *
 * These four groups are written as a chain of `if (action === "x") return …`
 * with the listing at the bottom, so anything that matched nothing fell through
 * to it: `storage creat` listed the buckets and exited 0, `clusters verifyy`
 * listed the clusters, `resources et --cpu 500m` printed the current dials, and
 * `billing usage` printed the billing account. Every one of them reports a typo
 * as a successful run of a command nobody asked for — which is worse than an
 * error, because an agent branching on the exit code learns nothing and a person
 * reads plausible output.
 *
 * The refusal comes before the client is built, so none of these needs a
 * session — which is also what makes it cheap enough to do on every group.
 */
describe("a mistyped action word refuses instead of running the default", () => {
    it.each([
        ["storage", (line: string[]) => storageCommand("creat", line)],
        ["clusters", (line: string[]) => clustersCommand("verifyy", line)],
        ["resources", (line: string[]) => resourcesCommand("et", line)],
        ["webhooks", (line: string[]) => webhooksCommand("creat", line)]
    ])("%s", async (group, run) => {
        const err = await refusalOf(() => run(argv(group, "typo")));
        expect(err.code).toBe("unknown_command");
        expect(err.message).toContain(group);
    });

    it("billing, whose action is a positional rather than the dispatcher's", async () => {
        const err = await refusalOf(() => billingCommand(argv("billing", "usage")));
        expect(err.code).toBe("unknown_command");
    });

    it("still runs the default action when no word was given at all", async () => {
        // The guard must not swallow the bare form, which is every one of these
        // groups' listing.
        const client = {
            functions: { invoke: vi.fn(async () => ({})) },
            data: { collection: () => ({ find: async () => ({ data: [] }) }) }
        };
        (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
            client,
            url: "https://cp.example"
        });
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        await storageCommand(undefined, argv("storage"));
        log.mockRestore();
    });
});
