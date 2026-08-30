/**
 * A cluster refusal is summarised, and a platform-side one says so.
 *
 * Both halves matter, and the second is the one that cost real work. A `403`
 * naming a `system:serviceaccount:` is the control plane's OWN credentials
 * being refused — nothing in the user's project can grant it. Printed raw in
 * the middle of a failed deploy it reads as a project fault, and acting on that
 * reading means changing working code to see whether it helps. On a real first
 * deploy all three of a project's cron jobs were deleted to test whether they
 * caused a `cronjobs.batch` 403. They did not.
 *
 * The fixtures are the shapes actually observed: a `Status` object embedded in
 * a wrapper sentence, with the client's header dump appended.
 */
import { describe, expect, it } from "vitest";
import { extractKubernetesStatus, summarizeError, wantsRawError } from "./errors";

/** The refusal that motivated all of this, near enough verbatim. */
const RBAC_403 =
    "Failed to reconcile tenant workloads: HTTP request failed "
    + '{"kind":"Status","apiVersion":"v1","metadata":{},"status":"Failure",'
    + '"message":"cronjobs.batch is forbidden: User '
    + '\\"system:serviceaccount:rebase-control-plane:control-plane\\" cannot create resource '
    + '\\"cronjobs\\" in API group \\"batch\\" in the namespace \\"tenant-mexico-inmo\\"",'
    + '"reason":"Forbidden","details":{"group":"batch","kind":"cronjobs"},"code":403} '
    + "headers: { 'audit-id': '9f2c1e77-2b5a-4a1c-9a0f-6f5f6b1f2f2b', "
    + "'x-kubernetes-pf-flowschema-uid': 'b8b5c3ba-3d6b-4a7a-9e2e-0c2a5f9d1a11' }";

/** A 404 for a secret — what `db test` answers before the first deploy. */
const SECRET_404 =
    "Failed to read the database secret: "
    + '{"kind":"Status","apiVersion":"v1","metadata":{},"status":"Failure",'
    + '"message":"secrets \\"postgres-app\\" not found","reason":"NotFound",'
    + '"details":{"name":"postgres-app","kind":"secrets"},"code":404}';

describe("extractKubernetesStatus", () => {
    it("finds a Status object embedded in a wrapper sentence", () => {
        const status = extractKubernetesStatus(RBAC_403);
        expect(status?.code).toBe(403);
        expect(status?.reason).toBe("Forbidden");
        expect(status?.message).toContain("cronjobs.batch is forbidden");
    });

    it("survives the nested `details` object", () => {
        // A lazy `\{.*?\}` truncates at the first inner brace, parses to
        // nothing, and silently falls through to printing the raw body — which
        // is the behaviour this whole file exists to remove.
        expect(extractKubernetesStatus(SECRET_404)?.details?.name).toBe("postgres-app");
    });

    it("leaves ordinary JSON in an error message alone", () => {
        expect(extractKubernetesStatus('Validation failed: {"field":"email","rule":"required"}'))
            .toBeUndefined();
    });

    it("returns nothing when there is no JSON at all", () => {
        expect(extractKubernetesStatus("connect ECONNREFUSED 127.0.0.1:5432")).toBeUndefined();
    });
});

describe("summarizeError", () => {
    it("names a service-account 403 as the platform's problem", () => {
        const summary = summarizeError({ status: 500,
message: RBAC_403 }, "Deploy failed");

        expect(summary.platform).toBe(true);
        expect(summary.code).toBe("platform_permission_denied");
        expect(summary.message).toContain("platform's own cluster credentials");
        // The remedy is "report it", and it has to say so: an agent that reads
        // this as a project fault retries or mutates the project.
        expect(summary.hint).toContain("not something your project can grant");
        expect(summary.hint).toContain("cronjobs.batch is forbidden");
    });

    it("keeps the audit-id and the header dump out of the summary", () => {
        const summary = summarizeError({ message: RBAC_403 }, "Deploy failed");
        expect(summary.message).not.toContain("audit-id");
        expect(summary.message).not.toContain("x-kubernetes-pf-flowschema-uid");
        expect(summary.hint).not.toContain("x-kubernetes-pf-flowschema-uid");
        // …but the whole thing is still there for `--debug`.
        expect(summary.raw).toBe(RBAC_403);
    });

    it("does not call an ordinary cluster refusal platform-side", () => {
        const summary = summarizeError({ message: SECRET_404 }, "Failed to test database");
        expect(summary.platform).toBe(false);
        expect(summary.code).toBe("k8s_notfound");
        expect(summary.message).toContain('secrets "postgres-app" not found');
    });

    it("does not call a 403 about a human user platform-side", () => {
        // A grant a person can actually be given is a different situation from
        // one that lives in a cluster they do not own.
        const summary = summarizeError({
            message: '{"kind":"Status","status":"Failure","message":"projects is forbidden: '
                + 'User \\"alice@example.com\\" cannot list resource \\"projects\\"",'
                + '"reason":"Forbidden","code":403}'
        }, "Failed to list");
        expect(summary.platform).toBe(false);
    });

    it("trims transport noise from a non-Kubernetes error", () => {
        const summary = summarizeError({
            status: 502,
            message: "Upstream did not respond headers: { 'x-request-id': 'abc' }"
        }, "Deploy failed");
        expect(summary.message).toBe("Deploy failed (502): Upstream did not respond");
        expect(summary.code).toBe("http_502");
    });

    it("keeps a plain message intact", () => {
        const summary = summarizeError({ status: 404,
message: "Project not found" }, "Failed to load status");
        expect(summary.message).toBe("Failed to load status (404): Project not found");
    });

    it("caps a summary that would otherwise be a wall", () => {
        const summary = summarizeError({ message: "x".repeat(5000) }, "Failed");
        expect(summary.message.length).toBeLessThan(400);
        expect(summary.raw.length).toBe(5000);
    });
});

describe("wantsRawError", () => {
    it("is off by default and on with --debug", () => {
        expect(wantsRawError(["node", "rebase", "cloud", "deploy"])).toBe(false);
        expect(wantsRawError(["node", "rebase", "cloud", "deploy", "--debug"])).toBe(true);
    });
});
