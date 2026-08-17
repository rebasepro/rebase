import {
    resolveRateLimitStoreKind,
    RateLimitStoreConfigurationError
} from "./resolve-rate-limit-store";

describe("resolveRateLimitStoreKind", () => {
    it("defaults to memory when unset", () => {
        expect(resolveRateLimitStoreKind({})).toBe("memory");
    });

    // A blank variable is the ordinary result of `FOO: ${BAR}` in a compose file
    // with BAR undefined, and it is how the platform neutralises a tenant's own
    // value. Reading it as invalid would turn both into a boot refusal.
    it.each(["", " ", "\t", "\n"])("treats %j as unset", (raw) => {
        expect(resolveRateLimitStoreKind({ REBASE_RATE_LIMIT_STORE: raw })).toBe("memory");
    });

    it("accepts the two kinds, case-insensitively and with surrounding space", () => {
        expect(resolveRateLimitStoreKind({ REBASE_RATE_LIMIT_STORE: "sql" })).toBe("sql");
        expect(resolveRateLimitStoreKind({ REBASE_RATE_LIMIT_STORE: "SQL" })).toBe("sql");
        expect(resolveRateLimitStoreKind({ REBASE_RATE_LIMIT_STORE: " memory " })).toBe("memory");
    });

    // The whole point of refusing: every other failure of this setting is
    // invisible. "postgres" is the word the rest of the product uses for the
    // driver, so it is the likely typo, and silently meaning "memory" would be a
    // per-replica limit that reads as a shared one.
    it("refuses a value it does not recognise rather than falling back", () => {
        expect(() => resolveRateLimitStoreKind({ REBASE_RATE_LIMIT_STORE: "postgres" }))
            .toThrow(RateLimitStoreConfigurationError);
    });

    it("names the variable and the fix in the refusal", () => {
        try {
            resolveRateLimitStoreKind({ REBASE_RATE_LIMIT_STORE: "redis" });
            throw new Error("expected a refusal");
        } catch (err) {
            const e = err as RateLimitStoreConfigurationError;
            expect(e.message).toContain("REBASE_RATE_LIMIT_STORE");
            expect(e.message).toContain("redis");
            expect(e.hint).toContain('"sql"');
        }
    });
});
