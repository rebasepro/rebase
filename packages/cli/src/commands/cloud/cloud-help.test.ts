/**
 * `--help` prints a page. It does not run the command.
 *
 * Every one of these was broken, and each broke differently, which is why the
 * assertions are about the dispatcher rather than about any one group:
 *
 *  - `cli.ts` rewrote the subcommand to the literal `"--help"` whenever the flag
 *    appeared anywhere, so the group never reached this dispatcher and every
 *    `rebase cloud <group> --help` printed the same index page. Seven modules
 *    carry their own `"--help": Boolean` that could not run.
 *  - Passing `--help` through as the *action* fixed only the groups that
 *    happened to switch on it. The rest take `rawArgs` and ignore the action, so
 *    the flag did nothing and the command ran: `env --help` tried to list
 *    variables and failed on "No project specified", `deploy --help` began
 *    resolving a project, and `link --help` opened an interactive project
 *    picker — a prompt, from a flag whose whole job is to print and exit.
 *
 * So the property under test is not "the right page appears" but "no handler is
 * reached at all". A regression here does not look like wrong text; it looks
 * like a CI job hanging on a prompt.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Every group module is mocked, so *any* call into one is a test failure rather
// than a network request or a prompt. This is the assertion — the expectations
// below just name it.
vi.mock("./auth", () => ({ loginCommand: vi.fn(), logoutCommand: vi.fn(), whoamiCommand: vi.fn() }));
vi.mock("./link", () => ({ linkCommand: vi.fn(), unlinkCommand: vi.fn(), selectOrgCommand: vi.fn(), openCommand: vi.fn() }));
vi.mock("./projects", () => ({ listProjects: vi.fn(), createProject: vi.fn(), projectInfo: vi.fn(), deleteProject: vi.fn() }));
vi.mock("./deploy", () => ({ deployCommand: vi.fn(), logsCommand: vi.fn() }));
vi.mock("./orgs", () => ({ orgsCommand: vi.fn(), printOrgsHelp: vi.fn() }));
vi.mock("./databases", () => ({ dbCommand: vi.fn(), printDbHelp: vi.fn() }));
vi.mock("./env", () => ({ envCommand: vi.fn(), printEnvHelp: vi.fn() }));
vi.mock("./domains", () => ({ domainsCommand: vi.fn(), printDomainsHelp: vi.fn() }));
vi.mock("./extensions", () => ({ extensionsCommand: vi.fn(), printExtensionsHelp: vi.fn() }));
vi.mock("./settings", () => ({ settingsCommand: vi.fn(), printSettingsHelp: vi.fn() }));
vi.mock("./deployments", () => ({ deploymentsListCommand: vi.fn(), rollbackCommand: vi.fn(), cancelCommand: vi.fn() }));
vi.mock("./power", () => ({ powerCommand: vi.fn() }));
vi.mock("./debug", () => ({ debugCommand: vi.fn(), printDebugHelp: vi.fn() }));
vi.mock("./resources", () => ({
    statusCommand: vi.fn(), metricsCommand: vi.fn(), webhooksCommand: vi.fn(),
    storageCommand: vi.fn(), clustersCommand: vi.fn(), billingCommand: vi.fn(),
    printStorageHelp: vi.fn()
}));
vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        initOutputMode: vi.fn(),
        // The one that turns a missing project into a hard exit. Mocked so a
        // regression surfaces as "requireProjectRef was called" rather than as
        // the process dying mid-test.
        requireProjectRef: vi.fn(() => "proj_test")
    };
});

const { cloudCommand } = await import("./index");
const context = await import("./context");
const link = await import("./link");
const deploy = await import("./deploy");
const env = await import("./env");
const projects = await import("./projects");
const databases = await import("./databases");
const resources = await import("./resources");

/**
 * The help printers, excluded from the "nothing ran" sweep because calling them
 * is the point. Held by identity: `vi.fn()` mocks are anonymous, so an earlier
 * version of this filtered on `getMockName().startsWith("print")` and matched
 * nothing — which made `storage --help` look like a failure for calling its own
 * help page.
 */
const PRINTERS: unknown[] = [
    resources.printStorageHelp, env.printEnvHelp, databases.printDbHelp
];

/** Every mocked handler, so "nothing ran" can be asserted in one place. */
function allHandlers() {
    return [
        ...Object.values(link), ...Object.values(deploy), ...Object.values(projects),
        ...Object.values(resources), env.envCommand, databases.dbCommand,
        context.requireProjectRef
    ].filter((f): f is ReturnType<typeof vi.fn> =>
        typeof f === "function" && "mock" in f && !PRINTERS.includes(f));
}

function argv(...tokens: string[]): string[] {
    // rawArgs is the full process.argv; the group sits at index 3.
    return ["node", "rebase", "cloud", ...tokens];
}

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
    logSpy.mockRestore();
});

/**
 * Groups with a page of their own, and the printer each must reach.
 * Aliases included deliberately — `domain` and `domains` are both accepted by
 * the dispatcher, so both have to route.
 */
const WITH_OWN_PAGE: Array<[string, () => unknown]> = [
    ["env", () => env.printEnvHelp],
    ["db", () => databases.printDbHelp],
    ["database", () => databases.printDbHelp],
    ["storage", () => resources.printStorageHelp]
];

describe("rebase cloud <group> --help", () => {
    it.each(WITH_OWN_PAGE)("routes %s to its own help page", async (group, printer) => {
        await cloudCommand(group, argv(group, "--help"));
        expect(printer()).toHaveBeenCalledTimes(1);
    });

    it.each([
        ["env"], ["db"], ["deploy"], ["link"], ["projects"], ["logs"],
        ["status"], ["billing"], ["storage"], ["domains"], ["settings"]
    ])("runs no handler for %s", async (group) => {
        await cloudCommand(group, argv(group, "--help"));
        for (const handler of allHandlers()) {
            expect(handler).not.toHaveBeenCalled();
        }
    });

    it("does not open the interactive picker for `link --help`", async () => {
        // The regression that motivated central handling: a flag that printed
        // text on every other command sat waiting for keyboard input here.
        await cloudCommand("link", argv("link", "--help"));
        expect(link.linkCommand).not.toHaveBeenCalled();
    });

    it("does not resolve a project for `deploy --help`", async () => {
        await cloudCommand("deploy", argv("deploy", "--help"));
        expect(deploy.deployCommand).not.toHaveBeenCalled();
        expect(context.requireProjectRef).not.toHaveBeenCalled();
    });

    it("honours -h as well as --help", async () => {
        await cloudCommand("env", argv("env", "-h"));
        expect(env.printEnvHelp).toHaveBeenCalledTimes(1);
        expect(env.envCommand).not.toHaveBeenCalled();
    });

    it("still dispatches normally without the flag", async () => {
        // The guard must not swallow real invocations — a `--help` check that
        // matched too eagerly would break every command instead of fixing help.
        await cloudCommand("env", argv("env", "list"));
        expect(env.envCommand).toHaveBeenCalledTimes(1);
        expect(env.printEnvHelp).not.toHaveBeenCalled();
    });

    it("falls back to the index page for a group with no page of its own", async () => {
        await cloudCommand("logs", argv("logs", "--help"));
        // printCloudHelp is module-local, so its output is the observable.
        expect(logSpy).toHaveBeenCalled();
        const printed = logSpy.mock.calls.map(c => String(c[0])).join("\n");
        expect(printed).toContain("rebase cloud");
    });
});
