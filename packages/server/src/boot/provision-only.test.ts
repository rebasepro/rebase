/**
 * `REBASE_PROVISION_ONLY` decides whether a boot ends in a socket or an exit.
 *
 * Tested at the resolver rather than by booting a runtime and watching it not
 * listen: the interesting cases are all about what counts as "set", and a blank
 * value reaching the wrong branch turns an ordinary deployment into one that
 * migrates and then refuses to serve.
 */
import { resolveProvisionOnly } from "./boot";

describe("resolveProvisionOnly", () => {
    it("is false when unset", () => {
        expect(resolveProvisionOnly({})).toBe(false);
    });

    // The trap this repository has hit before: `FOO: ${BAR}` in a compose file
    // with BAR undefined produces an empty string, not an absent variable. A
    // Helm template that conditionally omits a value does the same.
    it.each(["", " ", "\t", "\n"])("treats %j as unset", (raw) => {
        expect(resolveProvisionOnly({ REBASE_PROVISION_ONLY: raw })).toBe(false);
    });

    it.each(["true", "TRUE", "1", " true "])("accepts %j", (raw) => {
        expect(resolveProvisionOnly({ REBASE_PROVISION_ONLY: raw })).toBe(true);
    });

    // Anything that is not an affirmative is "serve". The failure direction
    // matters: a misread here that produced a provisioning run would take the
    // deployment down, while one that produced a serving run merely means the
    // migration Job did not do what its author expected — and that shows up as
    // a Job that never completes, which is loud.
    it.each(["false", "no", "0", "yes", "on"])("does not accept %j", (raw) => {
        expect(resolveProvisionOnly({ REBASE_PROVISION_ONLY: raw })).toBe(false);
    });
});
