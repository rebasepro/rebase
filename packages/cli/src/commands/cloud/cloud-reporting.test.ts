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
import { describeStorageState, describeDatabaseState } from "./resources";
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
                effective: { kind: "durable", summary: "dadaki-uploads on storage.googleapis.com" },
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
                effective: { kind: "durable", summary: "bucket on AWS S3" },
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
            describeStorageState({ effective: { kind: "incomplete", missing: ["S3_ACCESS_KEY_ID"] } })
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
        const line = stripAnsi(describeDatabaseState({ type: "managed", connectionStatus: "untested" }));
        expect(line).toContain("managed");
        expect(line).toContain("not tested");
        expect(line).toContain("db test");
    });

    it("reports a real verdict once there is one", () => {
        expect(stripAnsi(describeDatabaseState({ type: "managed", connectionStatus: "connected" }))).toBe(
            "managed (connected)"
        );
        expect(stripAnsi(describeDatabaseState({ type: "byodb", connectionStatus: "failed" }))).toBe(
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

    it("surfaces the label and framework version that make a row identifiable", () => {
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
        expect(view.frameworkVersion).toBe("0.11.0-canary.20260722");
    });

    it("reads snake_case columns, as the rest of this view does", () => {
        const view = deploymentView({
            id: 43,
            deploy_message: "from raw sql",
            framework_version: "0.10.0"
        } as DeploymentRow);
        expect(view.message).toBe("from raw sql");
        expect(view.frameworkVersion).toBe("0.10.0");
    });

    it("reports absent label and version as null, never as an empty string", () => {
        const view = deploymentView({ id: 44, deployMessage: "   " } as DeploymentRow);
        expect(view.message).toBeNull();
        expect(view.frameworkVersion).toBeNull();
    });
});
