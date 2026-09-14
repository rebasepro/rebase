import { parseEnvBoolean } from "../src/types/env_boolean";

describe("parseEnvBoolean", () => {
    it.each(["true", "1", "yes", "on", "TRUE", "Yes", " on ", "\ttrue\n"])("reads %p as true", (value) => {
        expect(parseEnvBoolean(value)).toBe(true);
    });

    it.each(["false", "0", "no", "off", "FALSE", "No", " off "])("reads %p as false", (value) => {
        // The half that broke: a raw truthiness test read every one of these
        // as set, and `FORCE_LOCAL_STORAGE=false` stood the storage guard down.
        expect(parseEnvBoolean(value)).toBe(false);
    });

    it.each([undefined, "", "   "])("leaves %p to the caller's default", (value) => {
        expect(parseEnvBoolean(value)).toBeUndefined();
    });

    it.each(["maybe", "2", "enabled", "t", "y", "truthy", "on-ish"])("leaves an unrecognised %p to the caller's default", (value) => {
        // Not a guess in either direction. A default-off flag stays off and a
        // default-on flag stays on, so a typo lands where the caller chose.
        expect(parseEnvBoolean(value)).toBeUndefined();
    });

    it("agrees with the boot schemas on every value they accept", () => {
        // `loadEnv` and `loadBootEnv` take `true`, `false` and blank, and refuse
        // anything else before the server starts. On that set the two readings
        // must be one reading, or a variable parsed at boot and read lazily
        // elsewhere means two things.
        expect(parseEnvBoolean("true")).toBe(true);
        expect(parseEnvBoolean("false")).toBe(false);
        expect(parseEnvBoolean("") ?? false).toBe(false);
    });
});
