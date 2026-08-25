/**
 * Flag handling for `rebase cloud resources set`.
 *
 * Its own file rather than an addition to cloud-commands.test.ts, which mocks
 * `./resources` wholesale — weakening that mock to reach one export would have
 * traded a real guarantee for a convenience.
 *
 * Nothing here checks whether a VALUE is allowed. That is the target cluster's
 * question, not the CLI's: Autopilot's floor and ratio band do not exist on
 * Hetzner or EKS, so a CLI carrying them would be wrong for two of three
 * providers the day it shipped.
 */
import { describe, it, expect } from "vitest";
import { buildDialPatch } from "./resources";

/* ── resource dials ─────────────────────────────────────────────── */

describe("buildDialPatch", () => {
    it("reads each dial flag", () => {
        const { patch } = buildDialPatch(["set", "--cpu", "500m", "--memory", "2Gi"]);
        expect(patch).toEqual({ cpu: "500m", memory: "2Gi" });
    });

    it("sends a count as a number, not a string", () => {
        // The control plane decides whether anything CHANGED by comparing with
        // the stored value, and re-syncs a Stripe subscription and rolls the
        // tenant's pods when something did. "2" against 2 differs, so a string
        // here would turn every unrelated save into a resize and a proration.
        const { patch } = buildDialPatch(["set", "--db-instances", "2", "--replicas", "3"]);
        expect(patch.databaseInstances).toBe(2);
        expect(typeof patch.databaseInstances).toBe("number");
        expect(patch.replicaCount).toBe(3);
        expect(typeof patch.replicaCount).toBe("number");
    });

    it("sends a yes/no dial as a boolean, not as the word", () => {
        // `preemptible: "false"` is TRUTHY. It would put a project that asked
        // for on-demand capacity onto preemptible nodes — a third of the price
        // and with the restarts it explicitly declined.
        expect(buildDialPatch(["set", "--spot", "false"]).patch.preemptible).toBe(false);
        expect(buildDialPatch(["set", "--spot", "true"]).patch.preemptible).toBe(true);
        expect(buildDialPatch(["set", "--scale-to-zero", "true"]).patch.scaleToZero).toBe(true);
    });

    it("refuses a yes/no dial given anything else", () => {
        // "yes" would be stored as false by the comparison above, which is the
        // opposite of what was typed — worse than refusing it.
        const { error } = buildDialPatch(["set", "--spot", "yes"]);
        expect(error).toMatch(/true or false/);
    });

    it("reads the dials that used to be a plan's to decide", () => {
        // Capacity, replicas, scale-to-zero and storage mode all came bundled
        // with a tier. Each is a flag now, and a project can take one without
        // buying the rest of a rung it did not want.
        const { patch } = buildDialPatch([
            "set", "--replicas", "2", "--spot", "false", "--storage", "dedicated-bucket"
        ]);
        expect(patch).toEqual({ replicaCount: 2, preemptible: false, storageMode: "dedicated-bucket" });
    });

    it("refuses a flag whose value is the next flag", () => {
        // Sending "" here would CLEAR the dial, which is the opposite of what
        // somebody who fumbled a flag meant.
        const { error } = buildDialPatch(["set", "--cpu", "--memory", "2Gi"]);
        expect(error).toMatch(/--cpu needs a value/);
    });

    it("refuses a fractional count before it reaches the server", () => {
        expect(buildDialPatch(["set", "--db-instances", "1.5"]).error).toMatch(/whole number/);
        expect(buildDialPatch(["set", "--replicas", "2.5"]).error).toMatch(/whole number/);
    });

    it("refuses a set with no dials rather than sending an empty patch", () => {
        const { error } = buildDialPatch(["set"]);
        expect(error).toMatch(/Nothing to set/);
    });

    it("allows no dials at all when a project is being created", () => {
        // `projects create` shares this parser, and a new project naming no dial
        // is the ordinary case — it takes the platform default. Refusing there
        // would make every headless create pass flags it does not care about.
        const { patch, error } = buildDialPatch(["create", "--name", "x"], { requireOne: false });
        expect(error).toBeUndefined();
        expect(patch).toEqual({});
    });

    it("does not invent dials that were not passed", () => {
        // A patch carrying every field at a default would overwrite dials the
        // customer set from another client.
        const { patch } = buildDialPatch(["set", "--cpu", "1"]);
        expect(Object.keys(patch)).toEqual(["cpu"]);
    });
});

describe("the autoscaling range", () => {
    it("sets both ends as numbers, not strings", () => {
        // Numbers, because the control plane decides whether anything CHANGED by
        // comparing against the stored value — and when something did, it
        // re-syncs a Stripe subscription and rolls the tenant's pods. "6" against
        // 6 differs, so a string here turns every unrelated save into a resize.
        const { patch, error } = buildDialPatch(
            ["set", "--autoscale-max", "6", "--autoscale-cpu-target", "70"]
        );
        expect(error).toBeUndefined();
        expect(patch).toEqual({ autoscaleMaxReplicas: 6, autoscaleTargetCpuPercent: 70 });
    });

    it("refuses a fractional pod count", () => {
        const { error } = buildDialPatch(["set", "--autoscale-max", "2.5"]);
        expect(error).toMatch(/whole number/);
    });

    it("reads the floor and the ceiling as one change", () => {
        // --replicas is the floor and the guaranteed spend; --autoscale-max is
        // the ceiling and the worst case. Setting them together is the ordinary
        // way to buy a range, so it must be one patch and one price quote.
        const { patch } = buildDialPatch(["set", "--replicas", "2", "--autoscale-max", "6"]);
        expect(patch).toEqual({ replicaCount: 2, autoscaleMaxReplicas: 6 });
    });

    it("names the new flags when nothing was passed", () => {
        // The error lists what CAN be set. A flag missing from that list is a
        // dial nobody discovers.
        const { error } = buildDialPatch(["set"]);
        expect(error).toContain("--autoscale-max");
        expect(error).toContain("--autoscale-cpu-target");
    });
});

describe("turning autoscaling off", () => {
    it("clears both ends of the range", () => {
        // null, not absent: the patch has to REACH the row and unset the column.
        // An omitted key means "leave it as it is", which would report success
        // and change nothing.
        const { patch, error } = buildDialPatch(["set", "--no-autoscale"]);
        expect(error).toBeUndefined();
        expect(patch).toEqual({ autoscaleMaxReplicas: null, autoscaleTargetCpuPercent: null });
    });

    it("is offered when nothing was passed", () => {
        const { error } = buildDialPatch(["set"]);
        expect(error).toContain("--no-autoscale");
    });

    it("does not need a value, and does not swallow the next flag", () => {
        // The value-less flag sits beside flags that DO take values. Reading a
        // value here would consume `--replicas`, and `--replicas` would then be
        // missing its own.
        const { patch, error } = buildDialPatch(["set", "--no-autoscale", "--replicas", "2"]);
        expect(error).toBeUndefined();
        expect(patch).toEqual({
            autoscaleMaxReplicas: null,
            autoscaleTargetCpuPercent: null,
            replicaCount: 2
        });
    });
});
