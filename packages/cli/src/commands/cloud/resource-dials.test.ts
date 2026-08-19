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

    it("sends the instance count as a number, not a string", () => {
        // The control plane decides whether anything CHANGED by comparing with
        // the stored value. "2" against 2 differs, so a string would report a
        // change on every save — and, before self-serve is enabled, be refused
        // on every save.
        const { patch } = buildDialPatch(["set", "--db-instances", "2"]);
        expect(patch.databaseInstances).toBe(2);
        expect(typeof patch.databaseInstances).toBe("number");
    });

    it("refuses a flag whose value is the next flag", () => {
        // Sending "" here would CLEAR the dial, which is the opposite of what
        // somebody who fumbled a flag meant.
        const { error } = buildDialPatch(["set", "--cpu", "--memory", "2Gi"]);
        expect(error).toMatch(/--cpu needs a value/);
    });

    it("refuses a fractional instance count before it reaches the server", () => {
        const { error } = buildDialPatch(["set", "--db-instances", "1.5"]);
        expect(error).toMatch(/whole number/);
    });

    it("refuses a set with no dials rather than sending an empty patch", () => {
        const { error } = buildDialPatch(["set"]);
        expect(error).toMatch(/Nothing to set/);
    });

    it("does not invent dials that were not passed", () => {
        // A patch carrying every field at a default would overwrite dials the
        // customer set from another client.
        const { patch } = buildDialPatch(["set", "--cpu", "1"]);
        expect(Object.keys(patch)).toEqual(["cpu"]);
    });
});
