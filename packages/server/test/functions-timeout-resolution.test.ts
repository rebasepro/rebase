/**
 * Where the custom-functions request ceiling comes from.
 *
 * `0` means "no ceiling" on this setting, deliberately — for a deployment whose
 * proxy already imposes one. That makes an accidental zero expensive, and
 * `Number("")` is 0: a compose file with
 * `REBASE_FUNCTIONS_TIMEOUT_MS=${SOMETHING}` and no `SOMETHING`, or a `.env`
 * line with the name and no value, produced an empty string that read as an
 * explicit "disable this".
 *
 * Both are ordinary ways to write those files, and the failure is invisible —
 * nothing logs, and the server behaves exactly as it did before the ceiling
 * existed. This is the only surface that runs code the framework did not write,
 * and on the managed runtime the process is shared between tenants.
 */
import {
    resolveFunctionsTimeoutMs,
    DEFAULT_FUNCTIONS_TIMEOUT_MS
} from "../src/functions/request-timeout";

describe("resolveFunctionsTimeoutMs", () => {
    const KEY = "REBASE_FUNCTIONS_TIMEOUT_MS";
    let saved: string | undefined;

    beforeEach(() => { saved = process.env[KEY]; delete process.env[KEY]; });
    afterEach(() => { if (saved === undefined) delete process.env[KEY]; else process.env[KEY] = saved; });

    it("defaults when the variable is absent", () => {
        expect(resolveFunctionsTimeoutMs()).toBe(DEFAULT_FUNCTIONS_TIMEOUT_MS);
    });

    it("treats a declared-but-empty variable as absent, not as zero", () => {
        process.env[KEY] = "";
        expect(resolveFunctionsTimeoutMs()).toBe(DEFAULT_FUNCTIONS_TIMEOUT_MS);
    });

    it("treats a whitespace-only variable as absent", () => {
        process.env[KEY] = "   ";
        expect(resolveFunctionsTimeoutMs()).toBe(DEFAULT_FUNCTIONS_TIMEOUT_MS);
    });

    it("still honours an explicit zero, which disables the ceiling", () => {
        process.env[KEY] = "0";
        expect(resolveFunctionsTimeoutMs()).toBe(0);
    });

    it("reads a real value", () => {
        process.env[KEY] = "5000";
        expect(resolveFunctionsTimeoutMs()).toBe(5000);
    });

    it("ignores a value that is not a number", () => {
        process.env[KEY] = "soon";
        expect(resolveFunctionsTimeoutMs()).toBe(DEFAULT_FUNCTIONS_TIMEOUT_MS);
    });

    it("ignores a negative value", () => {
        process.env[KEY] = "-1";
        expect(resolveFunctionsTimeoutMs()).toBe(DEFAULT_FUNCTIONS_TIMEOUT_MS);
    });

    it("lets an explicit config value win over the environment", () => {
        process.env[KEY] = "5000";
        expect(resolveFunctionsTimeoutMs(1234)).toBe(1234);
        // Config `0` is a choice, not an accident — there is no empty string
        // to confuse it with.
        expect(resolveFunctionsTimeoutMs(0)).toBe(0);
    });
});
