/**
 * What `rebase cloud` says about itself.
 *
 * Every case here comes from one field report, and they share a shape: the
 * machinery worked and the reporting did not. A deploy that had succeeded was
 * described as somebody else's conflict; a live GCS bucket was reported as
 * `Storage: none`; a database that had just been deployed against was reported
 * `untested`; a build-time variable was accepted by a command that cannot
 * deliver it. Each of those sends a reader somewhere other than where they
 * needed to go, which is why they are pinned as behaviour rather than left to
 * the output being "roughly right".
 */
import { describe, it, expect } from "vitest";
import { describeStorageState, describeDatabaseState, describeRuntime } from "./resources";
import { buildTimeEnvPrefix } from "./env";
import { deploymentView, parseDeploymentsLimit, DEFAULT_DEPLOYMENTS_LIMIT, type DeploymentRow } from "./deployments";

/** Colour codes are noise for these assertions. */
// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string | undefined): string => (s ?? "").replace(/\[[0-9;]*m/g, "");

describe("storage state reporting", () => {
    it("reports a bucket configured through env vars as durable, not none", () => {
        // The reported bug exactly: the `storages` row is empty because the
        // project sets STORAGE_TYPE/S3_* itself — which mergeStorageEnv
        // deliberately lets win over the row — and the pod boots with a live
        // bucket. Reading the row alone said "none".
        const line = stripAnsi(
            describeStorageState({
                effective: { kind: "durable",
summary: "dadaki-uploads on storage.googleapis.com" },
                configured: "none",
                overridden: false,
                source: "environment"
            })
        );
        expect(line).toContain("durable");
        expect(line).toContain("dadaki-uploads");
        expect(line).not.toContain("none");
    });

    it("says where the setting came from when env vars shadow the row", () => {
        const line = stripAnsi(
            describeStorageState({
                effective: { kind: "durable",
summary: "bucket on AWS S3" },
                configured: "configured",
                overridden: true,
                source: "environment"
            })
        );
        expect(line).toContain("from env vars");
    });

    it("calls unconfigured storage ephemeral, and says what that costs", () => {
        // "none" reads as merely unset. The truth is that uploads succeed and
        // are gone at the next restart, which is a state worth naming.
        const line = stripAnsi(describeStorageState({ effective: { kind: "ephemeral" } }));
        expect(line).toContain("ephemeral");
        expect(line).toContain("lost on restart");
    });

    it("names what is missing from a half-configured backend", () => {
        const line = stripAnsi(
            describeStorageState({ effective: { kind: "incomplete",
missing: ["S3_ACCESS_KEY_ID"] } })
        );
        expect(line).toContain("incomplete");
        expect(line).toContain("S3_ACCESS_KEY_ID");
    });

    it("prints a blank rather than a guess when the control plane cannot be asked", () => {
        // An older control plane has no such route, and the caller catches to
        // undefined. A blank field is a better answer than a wrong one here.
        expect(describeStorageState(undefined)).toBeUndefined();
        expect(describeStorageState({})).toBeUndefined();
        expect(describeStorageState({ effective: {} })).toBeUndefined();
    });
});

describe("database state reporting", () => {
    it("does not present a never-run test as the database's condition", () => {
        // `connectionStatus` is written "untested" at creation and only ever
        // changed by `db test`, so "managed (untested)" was reporting the
        // absence of a manual test on a project that had just deployed
        // against that database.
        const line = stripAnsi(describeDatabaseState({ type: "managed",
connectionStatus: "untested" }));
        expect(line).toContain("managed");
        expect(line).toContain("not tested");
        expect(line).toContain("db test");
    });

    it("reports a real verdict once there is one", () => {
        expect(stripAnsi(describeDatabaseState({ type: "managed",
connectionStatus: "connected" }))).toBe(
            "managed (connected)"
        );
        expect(stripAnsi(describeDatabaseState({ type: "byodb",
connectionStatus: "failed" }))).toBe(
            "byodb (failed)"
        );
    });

    it("prints nothing when there is no database row", () => {
        expect(describeDatabaseState(undefined)).toBeUndefined();
    });
});

describe("build-time environment variables", () => {
    it("recognises the prefixes a bundler inlines at build time", () => {
        expect(buildTimeEnvPrefix("VITE_API_URL")).toBe("VITE_");
        expect(buildTimeEnvPrefix("NEXT_PUBLIC_URL")).toBe("NEXT_PUBLIC_");
        expect(buildTimeEnvPrefix("PUBLIC_SITE")).toBe("PUBLIC_");
        expect(buildTimeEnvPrefix("REACT_APP_KEY")).toBe("REACT_APP_");
    });

    it("leaves ordinary run-time variables alone", () => {
        for (const key of ["DATABASE_URL", "S3_BUCKET", "STORAGE_TYPE", "MY_VITE_THING", "API_URL"]) {
            expect(buildTimeEnvPrefix(key)).toBeUndefined();
        }
    });
});

describe("deployments list", () => {
    it("defaults to a bounded window rather than all history", () => {
        expect(parseDeploymentsLimit(undefined)).toBe(DEFAULT_DEPLOYMENTS_LIMIT);
        expect(parseDeploymentsLimit(5)).toBe(5);
    });

    it("surfaces the label and the framework the bundle was built against", () => {
        // Without these, a --source project's history is N rows carrying the
        // same placeholder commit message, separable only by timestamp.
        const row = {
            id: 42,
            status: "success",
            deployMessage: "canvas selection fix",
            frameworkVersion: "0.11.0-canary.20260722"
        } as DeploymentRow;
        const view = deploymentView(row);
        expect(view.message).toBe("canvas selection fix");
        // Published as `builtAgainst`, never `frameworkVersion`: that name is
        // what `cloud status` gives the framework the runtime IMAGE ships, and
        // the two being routinely different read as one number contradicting
        // itself across two commands.
        expect(view.builtAgainst).toBe("0.11.0-canary.20260722");
        expect(view.frameworkVersion).toBeUndefined();
    });

    it("reads snake_case columns, as the rest of this view does", () => {
        const view = deploymentView({
            id: 43,
            deploy_message: "from raw sql",
            framework_version: "0.10.0"
        } as DeploymentRow);
        expect(view.message).toBe("from raw sql");
        expect(view.builtAgainst).toBe("0.10.0");
    });

    it("reports absent label and version as null, never as an empty string", () => {
        const view = deploymentView({ id: 44,
deployMessage: "   " } as DeploymentRow);
        expect(view.message).toBeNull();
        expect(view.builtAgainst).toBeNull();
    });
});

describe("describeRuntime", () => {
    /**
     * The runtime version and the framework version are different lines and are
     * easy to conflate — `runtime 1.2.0` shipping `framework 0.10.0` while the
     * project's own bundle installs `0.11.0` is a real state. Printing both is
     * the whole point, so that a reader never has to infer one from the other.
     */
    it("names the runtime and the framework its IMAGE ships", () => {
        const line = stripAnsi(describeRuntime({
            runtimeMode: "managed",
            runtimeVersion: "1.2.0",
            runtimeFrameworkVersion: "0.10.0"
        }));
        expect(line).toContain("managed 1.2.0");
        // "image framework", so it cannot be read as the bundle's own — that
        // one is `cloud deployments`' `builtAgainst`.
        expect(line).toContain("image framework 0.10.0");
    });

    it("says nothing about a framework it was not told", () => {
        // A release whose image tag is not a semver records no framework
        // version. Inventing one would defeat the reason for storing it.
        const line = stripAnsi(describeRuntime({ runtimeMode: "managed",
runtimeVersion: "1.2.0" }));
        expect(line).toContain("managed 1.2.0");
        expect(line).not.toContain("framework");
    });

    it("surfaces a pin, which is why a project may not be on the newest", () => {
        const line = stripAnsi(describeRuntime({
            runtimeMode: "managed",
            runtimeVersion: "1.1.0",
            runtimeFrameworkVersion: "0.10.0",
            runtimeVersionPin: "1.1.0"
        }));
        expect(line).toContain("pinned to 1.1.0");
    });

    it("does not claim a runtime for a custom project", () => {
        const line = stripAnsi(describeRuntime({ runtimeMode: "custom",
runtimeVersion: null }));
        expect(line).toContain("custom");
        expect(line).not.toContain("managed");
    });

    it("does not claim an image for a project that has never deployed", () => {
        // `runtime_mode` stopped defaulting to `custom` in migration 0040, so
        // absent is a third state. Reporting it as "custom · your own image"
        // described a container that was never built — and made `custom`
        // useless as the tell for an accidental eject, since it was equally the
        // resting value of every project nothing had happened to.
        for (const mode of [null, undefined, "  "]) {
            const line = stripAnsi(describeRuntime({ runtimeMode: mode,
runtimeVersion: null }));
            expect(line).toContain("not deployed yet");
            expect(line).not.toContain("your own image");
        }
    });
});
