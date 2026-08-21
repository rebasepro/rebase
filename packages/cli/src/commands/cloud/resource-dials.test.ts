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
