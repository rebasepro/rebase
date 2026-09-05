/**
 * What `rebase cloud projects create` records as a project's location.
 *
 * `provider`/`region` on a project are a REQUEST, not a fact: nothing downstream
 * reads them to pick a deploy target — that comes from the project's cluster
 * record or the ambient in-cluster context (saas/backend/src/k8s/resolve.ts). So
 * a wrong value is never contradicted by a failure, it just sits in the record.
 *
 * This CLI defaulted it to `hetzner`/`nbg1` unconditionally, which is how
 * projects running on our GKE cluster came to describe themselves as "Hetzner ·
 * Nbg1" in the console. `provider` is also half the Stripe compute lookup key
 * (`compute_<provider>_<vmSize>`), so it billed them against hardware they were
 * not on.
 */
import { describe, it, expect } from "vitest";
import { chooseRequestedTarget } from "./projects";

describe("chooseRequestedTarget", () => {
    it("records the target a deploy would actually use", () => {
        expect(chooseRequestedTarget(undefined, [
            { clusterId: null,
provider: "gcp",
region: "europe-west1",
label: "Rebase Cloud" }
        ])).toEqual({ provider: "gcp",
region: "europe-west1" });
    });

    it("takes the first target, which is the resolver's own preference order", () => {
        expect(chooseRequestedTarget(undefined, [
            { clusterId: "c1",
provider: "gcp",
region: "europe-west1" },
            { clusterId: "c2",
provider: "aws",
region: "us-east-1" }
        ])?.provider).toBe("gcp");
    });

    it("lets an explicit --provider win", () => {
        // The caller stating intent outranks what exists today, and `deploy`
        // stamps the record with the truth either way.
        expect(chooseRequestedTarget("aws", [
            { clusterId: null,
provider: "gcp",
region: "europe-west1" }
        ])).toEqual({ provider: "aws",
region: undefined });
    });

    it("an explicit provider takes the region the control plane offers on it", () => {
        // `--provider hetzner` means the Hetzner region we have capacity in —
        // which the control plane lists and a per-provider guess cannot know.
        expect(chooseRequestedTarget("hetzner", [
            { clusterId: null,
provider: "gcp",
region: "europe-west1",
label: "Rebase Cloud" },
            { clusterId: null,
provider: "hetzner",
region: "fsn1",
label: "Falkenstein (Hetzner)" }
        ])).toEqual({ provider: "hetzner",
region: "fsn1" });
    });

    it("leaves the region unset when the target cannot name one", () => {
        // The ambient in-cluster rung has no cluster record to read a region
        // from. `providerDefaults` then supplies one that at least matches the
        // provider — never `nbg1` on a Google target.
        expect(chooseRequestedTarget(undefined, [
            { clusterId: null,
provider: "gcp",
label: "Rebase Cloud" }
        ])).toEqual({ provider: "gcp",
region: undefined });
        expect(chooseRequestedTarget(undefined, [
            { clusterId: null,
provider: "gcp",
region: "  " }
        ])?.region).toBeUndefined();
    });

    it("keeps the historical default when the control plane cannot answer", () => {
        // An older deployment 404s on `platform-config`, and a failed request is
        // indistinguishable from it. Refusing to create a project would be a
        // worse answer than the default this has always used.
        expect(chooseRequestedTarget(undefined, undefined)).toEqual({
            provider: "hetzner",
            region: undefined
        });
    });

    it("refuses when the control plane says it has no infrastructure", () => {
        // An empty list is an ANSWER, not a gap: this control plane has nothing
        // to deploy to. Recording a plausible provider here is exactly the lie
        // this whole change removes.
        expect(chooseRequestedTarget(undefined, [])).toBeNull();
    });

    it("still records an explicit provider against an empty control plane", () => {
        expect(chooseRequestedTarget("hetzner", [])).toEqual({
            provider: "hetzner",
            region: undefined
        });
    });
});
