/**
 * `blockedOn` / `nextAction` — the difference between "working on it" and
 * "waiting for you".
 *
 * `rebase cloud status` reported `status: "provisioning"` for a project with no
 * database, and a caller has no way to read that as anything but async work in
 * progress. The correct response to work in progress is to wait; the correct
 * response to this state is a command nothing named. That is not a slow path,
 * it is a non-terminating one — no timeout is long enough, because the value
 * never changes. It cost 43 minutes of polling on a real first deploy, and an
 * unattended agent would still be polling.
 *
 * So the property under test is narrow and total: `blockedOn` is null EXACTLY
 * when polling is the right thing to do, and names a command otherwise.
 */
import { describe, expect, it } from "vitest";
import { resolveBlockedState } from "./resources";

describe("resolveBlockedState", () => {
    it("names the missing database, and the command that attaches it", () => {
        const state = resolveBlockedState({ projectStatus: "provisioning",
database: undefined });
        expect(state.blockedOn).toBe("no_database");
        expect(state.nextAction).toBe("rebase cloud db create --type managed");
    });

    it("still says so when the project reads `provisioning`", () => {
        // The whole point: the project status is the misleading half, so it
        // must not be able to suppress the verdict.
        const state = resolveBlockedState({
            projectStatus: "provisioning",
            database: undefined,
            lastDeploy: { status: "deploying" }
        });
        expect(state.blockedOn).toBe("no_database");
    });

    it("is null while a deploy is actually in flight", () => {
        const state = resolveBlockedState({
            projectStatus: "provisioning",
            database: { connectionStatus: "untested" },
            lastDeploy: { status: "deploying" }
        });
        expect(state.blockedOn).toBeNull();
        expect(state.nextAction).toBeNull();
    });

    it("asks for the first deploy once a database is attached", () => {
        const state = resolveBlockedState({
            projectStatus: "provisioning",
            database: { connectionStatus: "untested" },
            lastDeploy: undefined
        });
        expect(state).toEqual({ blockedOn: "never_deployed",
nextAction: "rebase cloud deploy" });
    });

    it("points at the log after a failed deploy", () => {
        const state = resolveBlockedState({
            projectStatus: "active",
            database: { connectionStatus: "connected" },
            lastDeploy: { status: "failed" }
        });
        expect(state).toEqual({ blockedOn: "last_deploy_failed",
nextAction: "rebase cloud logs" });
    });

    it("reports a database that has been attached and cannot be reached", () => {
        const state = resolveBlockedState({
            projectStatus: "active",
            database: { connectionStatus: "failed" },
            lastDeploy: { status: "success" }
        });
        expect(state).toEqual({ blockedOn: "database_unreachable",
nextAction: "rebase cloud db test" });
    });

    it("is null for a healthy, deployed project", () => {
        const state = resolveBlockedState({
            projectStatus: "active",
            database: { connectionStatus: "connected" },
            lastDeploy: { status: "success" }
        });
        expect(state).toEqual({ blockedOn: null,
nextAction: null });
    });

    it("does not call an untested database a blocker", () => {
        // `connectionStatus` is written "untested" at creation and only ever
        // changed by `db test`, so treating it as a fault would report every
        // healthy project as blocked on a manual step it does not need.
        const state = resolveBlockedState({
            projectStatus: "active",
            database: { connectionStatus: "untested" },
            lastDeploy: { status: "success" }
        });
        expect(state.blockedOn).toBeNull();
    });

    it("always pairs a blocker with a command", () => {
        // The contract a caller branches on: a named blocker is actionable, and
        // a null one means wait. Neither half may be half-populated.
        const cases = [
            { database: undefined },
            { database: { connectionStatus: "untested" } },
            { database: { connectionStatus: "connected" },
lastDeploy: { status: "failed" } },
            { database: { connectionStatus: "failed" },
lastDeploy: { status: "success" } },
            { database: { connectionStatus: "connected" },
lastDeploy: { status: "success" } },
            { database: { connectionStatus: "connected" },
lastDeploy: { status: "deploying" } }
        ];
        for (const input of cases) {
            const state = resolveBlockedState(input);
            expect(state.blockedOn === null).toBe(state.nextAction === null);
        }
    });
});
