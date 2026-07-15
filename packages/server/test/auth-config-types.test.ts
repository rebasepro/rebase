/**
 * Compile-time tests for `RebaseAuthConfig`.
 *
 * The Jest assertions are trivial (always true) — the real value is that
 * `tsc` validates the `@ts-expect-error` annotations: if a line compiles
 * when it shouldn't, tsc reports an error. This guards against a
 * regression of the `[key: string]: unknown` catch-all that used to make
 * every key (including typos) compile silently.
 */
import type { RebaseAuthConfig } from "../src/init";

describe("RebaseAuthConfig", () => {

    it("accepts known top-level keys", () => {
        const config: RebaseAuthConfig = {
            jwtSecret: "secret",
            allowRegistration: true,
            defaultRole: "viewer",
            google: { clientId: "id" }
        };
        expect(config.jwtSecret).toBe("secret");
    });

    it("rejects a misspelled top-level key (compile-time)", () => {
        const config: RebaseAuthConfig = {
            jwtSecret: "secret",
            // @ts-expect-error — "jwtSecrt" is a typo, not a real RebaseAuthConfig key
            jwtSecrt: "secret"
        };
        expect(config).toBeDefined();
    });

    it("rejects an unknown provider-shaped key (compile-time)", () => {
        const config: RebaseAuthConfig = {
            // @ts-expect-error — "seedDefaultRoles" is not a supported option
            seedDefaultRoles: true
        };
        expect(config).toBeDefined();
    });
});
