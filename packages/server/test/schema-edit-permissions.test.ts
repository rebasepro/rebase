/**
 * Who may plan a schema change, and who may apply one.
 *
 * The weight here is on the ways a *machine* could end up applying, because
 * that is the failure with consequences: a credential sitting in a CI
 * environment variable that can rewrite the project's source and push a commit
 * to its default branch. Everything else is a matter of ergonomics.
 */
import { describe, expect, it } from "@jest/globals";
import {
    classifyPrincipal,
    machineCommitAuthor,
    schemaEditCapabilities
} from "../src/schema-edit/schema-edit-permissions";

describe("classifying the caller", () => {
    it("reads a signed-in user as a person", () => {
        const principal = classifyPrincipal({ uid: "u_123", roles: ["admin"], email: "a@b.c" });
        expect(principal).toMatchObject({ kind: "person", uid: "u_123" });
    });

    it("reads the service key as a machine", () => {
        // Set by `createRequireAuth` when the bearer matches the service key.
        expect(classifyPrincipal({ uid: "service", roles: ["admin"] })).toMatchObject({
            kind: "machine",
            machineKind: "service-key"
        });
    });

    it("reads an API key as a machine", () => {
        expect(classifyPrincipal({ uid: "api-key:7c3f", roles: ["admin", "service"] })).toMatchObject({
            kind: "machine",
            machineKind: "api-key"
        });
    });

    it("does not demote a person who happens to hold a `service` role", () => {
        // Detected by uid, not by role. `service` is a role a person could be
        // granted, and losing the ability to commit under your own name because
        // of an unfortunate role name would be a strange rule.
        expect(classifyPrincipal({ uid: "u_9", roles: ["admin", "service"] }).kind).toBe("person");
    });

    it("reads nothing at all as anonymous", () => {
        expect(classifyPrincipal(undefined).kind).toBe("anonymous");
        expect(classifyPrincipal(null).kind).toBe("anonymous");
        expect(classifyPrincipal({}).kind).toBe("anonymous");
        expect(classifyPrincipal({ uid: "" }).kind).toBe("anonymous");
        expect(classifyPrincipal("service").kind).toBe("anonymous");
    });
});

describe("what a caller may do", () => {
    const person = classifyPrincipal({ uid: "u_1", roles: ["admin"] });
    const serviceKey = classifyPrincipal({ uid: "service", roles: ["admin"] });
    const apiKey = classifyPrincipal({ uid: "api-key:7c3f", roles: ["admin", "service"] });

    it("lets a person plan and apply", () => {
        expect(schemaEditCapabilities(person)).toEqual({ plan: true, apply: true });
    });

    it("lets a machine plan but not apply", () => {
        // Planning has no side effects, and a CI job asking whether a proposed
        // change is applicable is a good use of this API. Applying writes a
        // commit, and a commit needs an author.
        for (const machine of [serviceKey, apiKey]) {
            const capabilities = schemaEditCapabilities(machine);
            expect(capabilities.plan).toBe(true);
            expect(capabilities.apply).toBe(false);
            expect(capabilities.code).toBe("SCHEMA_EDIT_REQUIRES_A_PERSON");
            expect(capabilities.reason).toMatch(/needs an author/);
        }
    });

    it("names the credential kind in the refusal", () => {
        expect(schemaEditCapabilities(serviceKey).reason).toMatch(/service key/);
        expect(schemaEditCapabilities(apiKey).reason).toMatch(/API key/);
    });

    it("says how to turn it on, in the refusal itself", () => {
        expect(schemaEditCapabilities(apiKey).reason).toMatch(/allowMachineApply/);
    });

    it("lets a machine apply when the project has said so", () => {
        expect(schemaEditCapabilities(apiKey, { allowMachineApply: true }))
            .toEqual({ plan: true, apply: true });
    });

    it("refuses an anonymous caller everything", () => {
        const capabilities = schemaEditCapabilities(classifyPrincipal(undefined));
        expect(capabilities).toMatchObject({ plan: false, apply: false, code: "UNAUTHORIZED" });
    });

    it("refuses an anonymous caller even with the machine policy on", () => {
        // The policy widens who counts as an acceptable author. It does not
        // make an absent identity into one.
        expect(schemaEditCapabilities(classifyPrincipal(undefined), { allowMachineApply: true }))
            .toMatchObject({ plan: false, apply: false });
    });
});

describe("attributing a machine's commit", () => {
    it("names the service key as what it is", () => {
        const author = machineCommitAuthor(classifyPrincipal({ uid: "service", roles: [] }));
        expect(author.name).toBe("Rebase service key");
    });

    it("names which API key it was", () => {
        // An operator reading `git log` a month from now should be able to tell
        // a change somebody made from one a pipeline made, and *which* pipeline.
        const author = machineCommitAuthor(classifyPrincipal({ uid: "api-key:7c3f", roles: [] }));
        expect(author.name).toContain("7c3f");
        expect(author.name).toMatch(/API key/);
    });

    it("produces an address git will accept", () => {
        const author = machineCommitAuthor(classifyPrincipal({ uid: "api-key:7c/3f 9", roles: [] }));
        // git rejects a blank address and is unhappy with spaces and `<>`; the
        // uid comes from a database column, so it is sanitised rather than
        // trusted.
        expect(author.email).toMatch(/^[A-Za-z0-9._-]+@machines\.noreply\.rebase\.pro$/);
    });
});
