import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * The promises this subsystem makes.
 *
 * Almost every assertion here is negative — nothing is sent, nothing is
 * written, this field does not appear — because that is what opt-in telemetry
 * actually promises. A test that only proves events reach the collector would
 * pass just as happily on a build that sent them without asking.
 *
 * The two that matter most:
 *
 *  - **Silence until consent.** No id file, no network call, nothing on disk,
 *    from a machine that has never answered the prompt.
 *  - **No free text escapes.** The payload builder drops anything that could
 *    carry a path, a hostname or a sentence — which is how a developer's home
 *    directory, and therefore their real name, would otherwise end up on our
 *    servers.
 */

/** Point HOME at a scratch dir so a test never reads or writes the real config. */
let home: string;
let previousHome: string | undefined;
let previousUserProfile: string | undefined;

beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-telemetry-"));
    previousHome = process.env.HOME;
    previousUserProfile = process.env.USERPROFILE;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    vi.spyOn(os, "homedir").mockReturnValue(home);
    vi.resetModules();
    delete process.env.DO_NOT_TRACK;
    delete process.env.REBASE_TELEMETRY_DISABLED;
    delete process.env.CI;
});

afterEach(() => {
    vi.restoreAllMocks();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
    fs.rmSync(home, { recursive: true,
force: true });
});

async function load() {
    return import("./index");
}

describe("consent gate", () => {

    it("sends nothing, and writes nothing, before anyone has been asked", async () => {
        const telemetry = await load();
        const fetchMock = vi.fn();
        (global as any).fetch = fetchMock;

        expect(telemetry.isEnabled()).toBe(false);
        expect(telemetry.suppressionReason()).toBe("not_asked");

        await telemetry.recordEvent("cli.dev", { first_run: true });

        expect(fetchMock).not.toHaveBeenCalled();
        // Nothing on disk either — an id minted before consent is a record we
        // had no right to create, even unsent.
        expect(fs.existsSync(telemetry.configPath())).toBe(false);
    });

    it("mints no machine id when the answer is no", async () => {
        const telemetry = await load();
        telemetry.setConsent(false);
        expect(telemetry.readConfig().machineId).toBeUndefined();
        expect(telemetry.isEnabled()).toBe(false);
        expect(telemetry.suppressionReason()).toBe("declined");
    });

    it("sends only after an explicit yes", async () => {
        const telemetry = await load();
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
        (global as any).fetch = fetchMock;

        telemetry.setConsent(true);
        await telemetry.recordEvent("cli.dev", { first_run: true });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.event).toBe("cli.dev");
        expect(body.machineId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("keeps the same machine id across events", async () => {
        const telemetry = await load();
        telemetry.setConsent(true);
        const first = telemetry.readConfig().machineId;
        await telemetry.recordEvent("cli.dev", {});
        expect(telemetry.readConfig().machineId).toBe(first);
    });

    it("honours DO_NOT_TRACK even when the user previously said yes", async () => {
        // The cross-tool convention. Someone who set it globally has already
        // answered this question and should not have to answer it per tool.
        const telemetry = await load();
        telemetry.setConsent(true);
        process.env.DO_NOT_TRACK = "1";
        expect(telemetry.suppressionReason()).toBe("do_not_track");
        expect(telemetry.isEnabled()).toBe(false);
    });

    it("honours REBASE_TELEMETRY_DISABLED", async () => {
        const telemetry = await load();
        telemetry.setConsent(true);
        process.env.REBASE_TELEMETRY_DISABLED = "1";
        expect(telemetry.suppressionReason()).toBe("rebase_telemetry_disabled");
    });

    it("never counts CI", async () => {
        // A build runner is not a person. One pipeline re-running on every push
        // would otherwise outweigh every real developer in the data.
        const telemetry = await load();
        telemetry.setConsent(true);
        process.env.CI = "true";
        expect(telemetry.suppressionReason()).toBe("ci");

        const fetchMock = vi.fn();
        (global as any).fetch = fetchMock;
        await telemetry.recordEvent("cli.init", {});
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("treats an unreadable config as no consent", async () => {
        const telemetry = await load();
        fs.mkdirSync(path.join(home, ".rebase"), { recursive: true });
        fs.writeFileSync(telemetry.configPath(), "{ not json", "utf-8");
        expect(telemetry.suppressionReason()).toBe("not_asked");
    });
});

describe("payload redaction", () => {

    it("drops anything that could carry a path, a host or a sentence", async () => {
        const { sanitize } = await load();
        const out = sanitize({
            preset: "blog", // kept
            count: 12, // kept
            headless: false, // kept
            project_path: "/Users/francesco/clients/acme", // path
            db: "postgresql://user:pw@host/db", // URL with a password
            email: "francesco@firecms.co", // address
            message: "could not write file", // prose
            collection_name: "Customer Invoices" // customer vocabulary
        });

        expect(out).toEqual({ preset: "blog",
count: 12,
headless: false });
    });

    it("drops over-long strings, which are never enumerated tokens", async () => {
        const { sanitize } = await load();
        expect(sanitize({ tok: "x".repeat(65) })).toEqual({});
        expect(sanitize({ tok: "x".repeat(64) })).toEqual({ tok: "x".repeat(64) });
    });

    it("drops keys that are not plain snake_case identifiers", async () => {
        const { sanitize } = await load();
        expect(sanitize({ "Weird-Key": "a",
"__proto__": "b",
ok_key: "c" })).toEqual({ ok_key: "c" });
    });

    it("reduces an error to a class, never a message or a stack", async () => {
        const { errorClass } = await load();
        const err = new Error("ENOENT: no such file or directory, open '/Users/francesco/secret.env'");
        (err as NodeJS.ErrnoException).code = "ENOENT";

        expect(errorClass(err)).toBe("ENOENT");
        expect(errorClass(new TypeError("cannot read /Users/francesco/x"))).toBe("TypeError");
        expect(errorClass("a raw string")).toBe("Unknown");
    });

    it("buckets counts rather than reporting them exactly", async () => {
        // An exact figure is a good fingerprint: "37 collections" plus a version
        // and a driver narrows the field a great deal.
        const { bucket } = await load();
        expect(bucket(0)).toBe("0");
        expect(bucket(37)).toBe("21-50");
        expect(bucket(5000)).toBe("200+");
    });

    it("carries no field that was not asked for", async () => {
        const telemetry = await load();
        telemetry.setConsent(true);
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
        (global as any).fetch = fetchMock;

        await telemetry.recordEvent("cli.init", { preset: "blog" });
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);

        expect(Object.keys(body).sort()).toEqual([
            "arch", "at", "cliVersion", "event", "machineId", "nodeMajor", "platform", "properties", "schema"
        ]);
        // Nothing anywhere in the serialised payload looks like a home directory.
        expect(JSON.stringify(body)).not.toMatch(/\/Users\/|\/home\/|C:\\/);
    });
});

describe("failure behaviour", () => {

    it("never throws when the collector is unreachable", async () => {
        // Telemetry failing is not a reason for `rebase dev` to fail.
        const telemetry = await load();
        telemetry.setConsent(true);
        (global as any).fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
        await expect(telemetry.recordEvent("cli.dev", {})).resolves.toBeUndefined();
    });

    it("gives up rather than hanging the command", async () => {
        const telemetry = await load();
        telemetry.setConsent(true);
        (global as any).fetch = vi.fn((_url: string, init: RequestInit) =>
            new Promise((_resolve, reject) => {
                init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
            }));

        const started = Date.now();
        await telemetry.recordEvent("cli.dev", {}, { timeoutMs: 50 });
        expect(Date.now() - started).toBeLessThan(2000);
    });
});

describe("endpoint", () => {
    it("is overridable, so an install can point at its own collector", async () => {
        const telemetry = await load();
        expect(telemetry.endpoint()).toBe(telemetry.DEFAULT_TELEMETRY_ENDPOINT);
        process.env.REBASE_TELEMETRY_ENDPOINT = "https://collector.internal.example.com";
        expect(telemetry.endpoint()).toBe("https://collector.internal.example.com");
        delete process.env.REBASE_TELEMETRY_ENDPOINT;
    });
});

describe("project-level policy", () => {

    /** A scratch project with a rebase.json carrying the given telemetry value. */
    function project(value: boolean | undefined): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-project-"));
        const manifest: Record<string, unknown> = { rebase: "^1",
apps: {} };
        if (value !== undefined) manifest.telemetry = value;
        fs.writeFileSync(path.join(dir, "rebase.json"), JSON.stringify(manifest, null, 2), "utf-8");
        return dir;
    }

    it("lets a repository switch sharing off for everyone who clones it", async () => {
        // An organisation setting policy for work done on its behalf. This has
        // to beat an individual's opt-in or it is worth nothing.
        const telemetry = await load();
        telemetry.setConsent(true);
        const dir = project(false);

        expect(telemetry.suppressionReason(process.env, dir)).toBe("project_opt_out");
        expect(telemetry.isEnabled(process.env, dir)).toBe(false);

        const fetchMock = vi.fn();
        (global as any).fetch = fetchMock;
        await telemetry.recordEvent("cli.dev", {}, { projectRoot: dir });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refuses to let a repository switch sharing ON for anyone", async () => {
        // The asymmetry, and the reason this is not just a per-project mirror of
        // the machine setting: rebase.json is committed, so a `true` would be one
        // developer consenting for every colleague who later clones it.
        const telemetry = await load();
        const dir = project(true);

        expect(telemetry.readProjectPolicy(dir)).toBe("ignored_opt_in");
        // Still "not asked" — the file did not answer on the developer's behalf.
        expect(telemetry.suppressionReason(process.env, dir)).toBe("not_asked");
        expect(telemetry.isEnabled(process.env, dir)).toBe(false);
    });

    it("leaves an individual's own decision intact when the project says nothing", async () => {
        const telemetry = await load();
        telemetry.setConsent(true);
        const dir = project(undefined);
        expect(telemetry.isEnabled(process.env, dir)).toBe(true);
    });

    it("still honours an opt-out in a manifest too malformed to parse", async () => {
        // A repository that says no should be obeyed even when it is broken —
        // "your JSON has a trailing comma" is not a reason to start sending.
        const telemetry = await load();
        telemetry.setConsent(true);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-project-"));
        fs.writeFileSync(path.join(dir, "rebase.json"), '{ "rebase": "^1", "telemetry": false, }', "utf-8");
        expect(telemetry.suppressionReason(process.env, dir)).toBe("project_opt_out");
    });

    it("finds the policy from a subdirectory of the project", async () => {
        // `rebase dev` run from `backend/` must still see its own repo's opt-out.
        const telemetry = await load();
        telemetry.setConsent(true);
        const dir = project(false);
        const nested = path.join(dir, "backend", "src");
        fs.mkdirSync(nested, { recursive: true });
        expect(telemetry.suppressionReason(process.env, nested)).toBe("project_opt_out");
    });

    it("reports no policy outside a project", async () => {
        const telemetry = await load();
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-not-a-project-"));
        expect(telemetry.readProjectPolicy(dir)).toBe("unset");
    });
});

describe("ensureProjectId", () => {

    function projectDir(state?: string): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-pid-"));
        fs.mkdirSync(path.join(dir, ".rebase"));
        if (state !== undefined) fs.writeFileSync(path.join(dir, ".rebase", "state.json"), state, "utf-8");
        return dir;
    }

    it("preserves the other commands' keys when it adds its own", async () => {
        // `state.json` is shared — `generate_sdk`, `apps` and `auth` all read it.
        // Clobbering their keys to store a telemetry id would break the project.
        const telemetry = await load();
        telemetry.setConsent(true);
        const dir = projectDir('{"lastSdkOutput":"./src/sdk","apiUrl":"http://localhost:3001"}');
        (global as any).fetch = vi.fn().mockResolvedValue({ ok: true });

        await telemetry.recordEvent("cli.dev", {}, { projectRoot: dir });

        const state = JSON.parse(fs.readFileSync(path.join(dir, ".rebase", "state.json"), "utf-8"));
        expect(state.lastSdkOutput).toBe("./src/sdk");
        expect(state.apiUrl).toBe("http://localhost:3001");
        expect(state.telemetryProjectId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("reuses the id it already stored", async () => {
        const telemetry = await load();
        telemetry.setConsent(true);
        const dir = projectDir('{"telemetryProjectId":"11111111-2222-3333-4444-555555555555"}');
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
        (global as any).fetch = fetchMock;

        await telemetry.recordEvent("cli.dev", {}, { projectRoot: dir });

        expect(JSON.parse(fetchMock.mock.calls[0][1].body).projectId)
            .toBe("11111111-2222-3333-4444-555555555555");
    });

    it("does not overwrite a state.json it cannot parse", async () => {
        // Better to report no project than to destroy another command's state.
        const telemetry = await load();
        telemetry.setConsent(true);
        const dir = projectDir("{ this is not json");
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
        (global as any).fetch = fetchMock;

        await telemetry.recordEvent("cli.dev", {}, { projectRoot: dir });

        expect(fs.readFileSync(path.join(dir, ".rebase", "state.json"), "utf-8")).toBe("{ this is not json");
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).projectId).toBeUndefined();
    });

    it("reports no project when there is no .rebase directory to write into", async () => {
        // A command run outside a project must not scatter directories around
        // the filesystem just to have something to count.
        const telemetry = await load();
        telemetry.setConsent(true);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-bare-"));
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
        (global as any).fetch = fetchMock;

        await telemetry.recordEvent("cli.dev", {}, { projectRoot: dir });

        expect(fs.existsSync(path.join(dir, ".rebase"))).toBe(false);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).projectId).toBeUndefined();
    });
});
