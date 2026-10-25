/**
 * The Rebase Cloud tools past provisioning, and the guard that holds every
 * cloud tool's advertised schema to what its handler actually parses.
 *
 * A schema is a promise to the model: these keys, these types, these are
 * required. A handler that reads a key the schema does not name, ignores one
 * it does, or accepts a type it says it refuses, breaks that promise silently —
 * the call succeeds and does something else. So the check below is driven by
 * the schemas themselves, and a tool or property added tomorrow is covered by
 * it the day it lands.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSpawn = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    stdin: { on: vi.fn(), end: vi.fn() },
    on: vi.fn()
};
vi.mock("node:child_process", () => ({
    spawn: vi.fn(() => mockSpawn)
}));
vi.mock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    return { ...actual, homedir: () => `${actual.tmpdir()}/rebase-mcp-cloud-test-home` };
});
vi.mock("@rebasepro/client", () => ({ createRebaseClient: () => ({}) }));

import { spawn } from "node:child_process";
import {
    server,
    ALL_TOOLS,
    parseCloudToolArgs,
    gatedTargetFor,
    READ_ONLY_TOOLS,
    CLOUD_CONTROL_PLANE_TOOLS
} from "../src/index";
import { validateToolArgs, redactSecrets, tailLog, parseCliJson, CLOUD_LOGS_DEFAULT_TAIL } from "../src/cloud-tools";

type Schema = { type: "object"; properties: Record<string, Record<string, unknown>>; required?: string[]; additionalProperties?: boolean };

const CLOUD = ALL_TOOLS.filter((t) => t.name.startsWith("rebase_cloud_"));

/**
 * Valid arguments for each cloud tool. Several per tool where some arguments
 * exclude others; together they must name every property of the schema.
 */
const SAMPLES: Record<string, Array<Record<string, unknown>>> = {
    rebase_cloud_provision: [{ name: "Todo app", deploy: false }],
    rebase_cloud_status: [{}],
    rebase_cloud_deploy: [
        { app: "web", bundle: true, message: "first cut", wait: true, timeoutSeconds: 600, previewName: "new-quiz" },
        { preview: true, wait: false }
    ],
    rebase_cloud_logs: [
        { source: "runtime", since: "5m", tail: 50, grep: "/5\\d\\d/", level: "error", previous: true, preview: "new-quiz" },
        { source: "build", tail: 20 }
    ],
    rebase_cloud_env_list: [{ preview: true }],
    rebase_cloud_env_set: [{ key: "STRIPE_KEY", value: "sk_live_abc123", secret: true, preview: true }],
    rebase_cloud_deployments_list: [{ limit: 5 }],
    rebase_cloud_rollback: [{ deploymentId: "dep_42" }]
};

function schemaOf(name: string): Schema {
    return CLOUD.find((t) => t.name === name)!.inputSchema as Schema;
}

/** A value of the wrong JSON type for a property. */
function wrongType(prop: Record<string, unknown>): unknown {
    if (prop.type === "boolean") return "yes";
    if (prop.type === "integer") return 1.5;
    return 42;
}

describe("every cloud tool's schema against its handler's parsed input", () => {
    it("has samples for exactly the cloud tools that are registered", () => {
        expect(Object.keys(SAMPLES).sort()).toEqual(CLOUD.map((t) => t.name).sort());
    });

    describe.each(CLOUD.map((t) => t.name))("%s", (name) => {
        const schema = schemaOf(name);
        const samples = SAMPLES[name];
        const keys = Object.keys(schema.properties);

        it("refuses arguments it does not declare, and says so in the schema", () => {
            expect(schema.additionalProperties).toBe(false);
            expect(() => parseCloudToolArgs(name, { ...samples[0], projectId: "someone-elses" })).toThrow(/does not take `projectId`/);
        });

        it("names every property in its samples, and accepts each sample", () => {
            const named = new Set(samples.flatMap((s) => Object.keys(s)));
            expect([...named].sort()).toEqual([...keys].sort());
            for (const sample of samples) expect(() => parseCloudToolArgs(name, sample)).not.toThrow();
        });

        it("reads every property it declares: leaving one out changes the call", () => {
            for (const key of keys) {
                const changed = samples.some((sample) => {
                    if (!(key in sample) || schema.required?.includes(key)) return false;
                    const { [key]: _dropped, ...rest } = sample;
                    return JSON.stringify(parseCloudToolArgs(name, rest)) !== JSON.stringify(parseCloudToolArgs(name, sample));
                });
                const required = schema.required?.includes(key) ?? false;
                expect(changed || required, `\`${key}\` is declared but the handler ignores it`).toBe(true);
            }
        });

        it("refuses a call missing a required property", () => {
            for (const key of schema.required ?? []) {
                const { [key]: _dropped, ...rest } = samples[0];
                expect(() => parseCloudToolArgs(name, rest)).toThrow(new RegExp(`\`${key}\``));
            }
        });

        it("refuses a value of the wrong type for every property", () => {
            for (const key of keys) {
                const base = samples.find((s) => key in s)!;
                expect(() => parseCloudToolArgs(name, { ...base, [key]: wrongType(schema.properties[key]) })).toThrow();
            }
        });

        it("holds integers to the bounds it advertises", () => {
            for (const key of keys) {
                const prop = schema.properties[key];
                if (prop.type !== "integer") continue;
                const base = samples.find((s) => key in s)!;
                const { minimum, maximum } = prop;
                if (typeof minimum === "number") {
                    expect(() => parseCloudToolArgs(name, { ...base, [key]: minimum })).not.toThrow();
                    expect(() => parseCloudToolArgs(name, { ...base, [key]: minimum - 1 })).toThrow();
                }
                if (typeof maximum === "number") {
                    expect(() => parseCloudToolArgs(name, { ...base, [key]: maximum })).not.toThrow();
                    expect(() => parseCloudToolArgs(name, { ...base, [key]: maximum + 1 })).toThrow();
                }
            }
        });

        it("accepts every value an enum advertises, and nothing else", () => {
            for (const key of keys) {
                const prop = schema.properties[key];
                if (!Array.isArray(prop.enum)) continue;
                const base = samples.find((s) => key in s)!;
                for (const value of prop.enum) {
                    // A value that excludes the sample's other arguments is tried alone.
                    const alone = { ...Object.fromEntries((schema.required ?? []).map((r) => [r, base[r]])), [key]: value };
                    expect(() => parseCloudToolArgs(name, alone)).not.toThrow();
                }
                expect(() => parseCloudToolArgs(name, { ...base, [key]: "nonesuch" })).toThrow();
            }
        });

        it("never lets a string become a flag of its own on the command line", () => {
            for (const key of keys) {
                if (schema.properties[key].type !== "string" || schema.properties[key].enum) continue;
                const base = samples.find((s) => key in s)!;
                let argv: string[];
                try {
                    argv = parseCloudToolArgs(name, { ...base, [key]: "--project=evil" }).argv;
                } catch {
                    continue; // refused by its pattern
                }
                expect(argv, `\`${key}\` reached argv as a flag`).not.toContain("--project=evil");
            }
        });
    });

    it("keeps every tool's required list inside its properties, with a usable type for each", () => {
        // The universal half: every tool the server registers, not only the
        // cloud ones, advertises a schema a client can satisfy.
        for (const tool of ALL_TOOLS) {
            const schema = tool.inputSchema as Schema;
            for (const key of schema.required ?? []) {
                expect(Object.keys(schema.properties), `${tool.name} requires \`${key}\` it does not declare`).toContain(key);
            }
            for (const [key, prop] of Object.entries(schema.properties)) {
                expect(["string", "boolean", "integer", "number", "object", "array"], `${tool.name}.${key}`).toContain(prop.type);
            }
        }
    });
});

describe("cloud tool argv", () => {
    it("asks every command for JSON, and never follows a log", () => {
        for (const [name, samples] of Object.entries(SAMPLES)) {
            for (const sample of samples) {
                const { argv } = parseCloudToolArgs(name, sample);
                expect(argv).toContain("--json");
                expect(argv).not.toContain("-f");
                expect(argv).not.toContain("--follow");
            }
        }
    });

    it("puts an env value on stdin, never on argv", () => {
        const call = parseCloudToolArgs("rebase_cloud_env_set", { key: "STRIPE_KEY", value: "sk_live_abc123" });
        expect(call.argv).toEqual(["cloud", "env", "set", "STRIPE_KEY", "--stdin", "--json"]);
        expect(call.argv.join(" ")).not.toContain("sk_live_abc123");
        expect(call.stdin).toBe("sk_live_abc123");
    });

    it("confirms a rollback with --yes: the tool call is the confirmation", () => {
        expect(parseCloudToolArgs("rebase_cloud_rollback", {}).argv).toEqual(["cloud", "rollback", "--yes", "--json"]);
    });

    it("refuses runtime-only log arguments on a build log, and a timeout on a deploy that does not wait", () => {
        expect(() => parseCloudToolArgs("rebase_cloud_logs", { source: "build", since: "5m" })).toThrow(/`since`/);
        expect(() => parseCloudToolArgs("rebase_cloud_deploy", { wait: false, timeoutSeconds: 60 })).toThrow(/timeoutSeconds/);
    });

    it("defaults a runtime log to the last 200 lines", () => {
        expect(parseCloudToolArgs("rebase_cloud_logs", {}).argv).toEqual(["cloud", "logs", "--runtime", "--json", `--tail=${CLOUD_LOGS_DEFAULT_TAIL}`]);
    });
});

describe("cloud tool helpers", () => {
    it("redacts a secret of any length, everywhere", () => {
        expect(redactSecrets("a=x1 and x1", ["x1"])).toBe("a=[redacted] and [redacted]");
        expect(redactSecrets("nothing", [""])).toBe("nothing");
    });

    it("reads the CLI's result even when a build tool wrote to stdout ahead of it", () => {
        expect(parseCliJson('{\n  "a": 1\n}\n')).toEqual({ a: 1 });
        expect(parseCliJson('vite v6 building...\n{ not json\n{\n  "ok": true,\n  "nested": {\n    "b": 2\n  }\n}\n')).toEqual({ ok: true, nested: { b: 2 } });
        expect(parseCliJson("plain words")).toBeUndefined();
        expect(parseCliJson("")).toBeUndefined();
    });

    it("keeps a log's last lines and counts what it dropped", () => {
        expect(tailLog("a\nb\nc\n", 2)).toEqual({ logs: "b\nc", dropped: 1 });
        expect(tailLog("a\nb", 5)).toEqual({ logs: "a\nb", dropped: 0 });
    });

    it("validates against a schema with no properties", () => {
        expect(validateToolArgs("t", { type: "object", properties: {}, additionalProperties: false }, undefined)).toEqual({});
        expect(() => validateToolArgs("t", { type: "object", properties: {}, additionalProperties: false }, { a: 1 })).toThrow(/takes no arguments/);
        expect(() => validateToolArgs("t", { type: "object", properties: {} }, "x")).toThrow(/object/);
    });
});

describe("the loopback gate and cloud tools", () => {
    it("lets the cloud reads through as reads, and the cloud writes through as control-plane calls", () => {
        for (const name of ["rebase_cloud_status", "rebase_cloud_logs", "rebase_cloud_env_list", "rebase_cloud_deployments_list"]) {
            expect(READ_ONLY_TOOLS.has(name)).toBe(true);
            expect(gatedTargetFor(name)).toBeNull();
        }
        for (const name of ["rebase_cloud_deploy", "rebase_cloud_env_set", "rebase_cloud_rollback"]) {
            expect(CLOUD_CONTROL_PLANE_TOOLS.has(name)).toBe(true);
            expect(gatedTargetFor(name)).toBeNull();
        }
    });

    it("does not gate provisioning on baseUrl, which it never reads", () => {
        // It creates a project on the control plane and links this directory;
        // it touches no existing app or database. Gated, it was refused exactly
        // when the active project already pointed at a remote app — with a
        // message about a URL the tool does not use.
        expect(CLOUD_CONTROL_PLANE_TOOLS.has("rebase_cloud_provision")).toBe(true);
        expect(gatedTargetFor("rebase_cloud_provision")).toBeNull();
    });
});

describe("running the cloud tools", () => {
    function cliPrints(stdout: string, code = 0, stderr = "") {
        mockSpawn.stdout.on.mockImplementation((event: string, callback: (d: Buffer) => void) => {
            if (event === "data") setTimeout(() => callback(Buffer.from(stdout)), 0);
            return mockSpawn.stdout;
        });
        mockSpawn.stderr.on.mockImplementation((event: string, callback: (d: Buffer) => void) => {
            if (event === "data" && stderr) setTimeout(() => callback(Buffer.from(stderr)), 0);
            return mockSpawn.stderr;
        });
        mockSpawn.on.mockImplementation((event: string, callback: (code: number) => void) => {
            if (event === "close") setTimeout(() => callback(code), 10);
            return mockSpawn;
        });
    }

    const call = (name: string, args: Record<string, unknown>) =>
        (server as any)._requestHandlers.get("tools/call")({ method: "tools/call", params: { name, arguments: args } });

    const spawnedArgv = () => vi.mocked(spawn).mock.calls.at(-1)![1] as string[];

    beforeEach(() => vi.clearAllMocks());

    it("status: the CLI's JSON, fenced, behind a trusted line about the claim link", async () => {
        const claimUrl = `https://app.rebase.pro/claim/rcl_${"a".repeat(48)}`;
        cliPrints(JSON.stringify({ projectId: "p1", status: "running", unclaimed: { claimUrl, expiresAt: "2026-10-26T05:00:00.000Z" } }));
        const result = await call("rebase_cloud_status", {});
        expect(spawnedArgv()).toEqual(expect.arrayContaining(["rebase", "cloud", "status", "--json"]));
        expect(result.isError).toBeFalsy();
        const text: string = result.content[0].text;
        expect(text.indexOf("unclaimed.claimUrl")).toBeLessThan(text.indexOf("UNTRUSTED_DATA"));
        expect(text).toContain(claimUrl);
    });

    it("env set: writes the value to stdin, returns only its shape, and redacts an echo of it", async () => {
        cliPrints(JSON.stringify({ success: true, key: "STRIPE_KEY", secret: true, valueSet: true, pendingRedeploy: true, echoed: "sk_live_abc123" }));
        const result = await call("rebase_cloud_env_set", { key: "STRIPE_KEY", value: "sk_live_abc123", secret: true });
        expect(spawnedArgv().join(" ")).not.toContain("sk_live_abc123");
        expect(mockSpawn.stdin.end).toHaveBeenCalledWith("sk_live_abc123");
        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).not.toContain("sk_live_abc123");
        expect(JSON.parse(result.content[0].text)).toMatchObject({ key: "STRIPE_KEY", secret: true, pendingRedeploy: true, preview: false });
    });

    it("env set: a refusal says why and never carries the value, even when the CLI's words do", async () => {
        cliPrints(JSON.stringify({ error: { code: "build_time_variable", message: "VITE_KEY=sk_live_abc123 is read at BUILD time" } }), 1);
        const result = await call("rebase_cloud_env_set", { key: "VITE_KEY", value: "sk_live_abc123" });
        expect(result.isError).toBe(true);
        expect(result.content[0].text).not.toContain("sk_live_abc123");
        expect(result.content[0].text).toContain("build_time_variable");
        expect(result.content[0].text).toMatch(/belongs in the build/);
    });

    it("env set: an older CLI without --stdin is named, not retried with the value on argv", async () => {
        cliPrints(JSON.stringify({ error: { code: "usage", message: "Unknown or unexpected option: --stdin" } }), 1);
        const result = await call("rebase_cloud_env_set", { key: "K", value: "v" });
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/predates `env set --stdin`/);
        expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1);
    });

    it("deploy: a failed deploy is an error whose build log is cut to its end", async () => {
        const logs = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
        cliPrints(JSON.stringify({ error: { code: "deploy_failed", message: "backend failed", reason: "TS2345", logs } }), 1);
        const result = await call("rebase_cloud_deploy", {});
        expect(result.isError).toBe(true);
        const text: string = result.content[0].text;
        expect(text).toContain("line 499");
        expect(text).not.toContain("line 299\\n");
        expect(text).toContain("logsLinesDropped");
        expect(text.indexOf("rebase_cloud_rollback")).toBeLessThan(text.indexOf("UNTRUSTED_DATA"));
    });

    it("deploy: a managed project's refusal points at bundle: true, and never at ejecting", async () => {
        cliPrints(JSON.stringify({ error: { code: "managed_project", message: "runs on the managed runtime", hint: "add `--eject`" } }), 1);
        const result = await call("rebase_cloud_deploy", {});
        const text: string = result.content[0].text;
        const trusted = text.slice(0, text.indexOf("UNTRUSTED_DATA"));
        expect(trusted).toContain("bundle: true");
        expect(trusted).not.toContain("--eject");
    });

    it("rollback: nothing to roll back to points at the deployment list", async () => {
        cliPrints(JSON.stringify({ error: { code: "deploy_not_rollbackable", message: "No rollbackable deployment found" } }), 1);
        const result = await call("rebase_cloud_rollback", {});
        expect(spawnedArgv()).toEqual(expect.arrayContaining(["cloud", "rollback", "--yes", "--json"]));
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("rebase_cloud_deployments_list");
    });

    it("logs: a build log comes back cut to `tail` lines", async () => {
        cliPrints(JSON.stringify({ deploymentId: "d1", status: "success", logs: "a\nb\nc\nd" }));
        const result = await call("rebase_cloud_logs", { source: "build", tail: 2 });
        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain('"logs":"c\\nd"');
    });

    it("an unlinked directory gets the way to a project, before the CLI's own words", async () => {
        cliPrints(JSON.stringify({ error: { code: "no_project", message: "No project specified and this directory is not linked." } }), 1);
        const result = await call("rebase_cloud_env_list", {});
        expect(result.isError).toBe(true);
        const text: string = result.content[0].text;
        expect(text.indexOf("rebase_cloud_provision")).toBeLessThan(text.indexOf("UNTRUSTED_DATA"));
    });

    it("output that is not JSON is an error, fenced, with secrets cut out", async () => {
        cliPrints("", 1, "Error: something broke near sk_live_abc123\n");
        const result = await call("rebase_cloud_env_set", { key: "K", value: "sk_live_abc123" });
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("UNTRUSTED_DATA");
        expect(result.content[0].text).not.toContain("sk_live_abc123");
    });

    it("refuses bad arguments before spawning anything", async () => {
        const result = await call("rebase_cloud_deploy", { app: "--eject" });
        expect(result.isError).toBe(true);
        expect(spawn).not.toHaveBeenCalled();
    });
});
