import { describe, it, expect, afterEach } from "@jest/globals";
import { Hono } from "hono";
import { loadBootEnv } from "../src/boot/env";
import { runtimeSecureHeaders } from "../src/boot/security-headers";

/**
 * `includeSubDomains` is the operator's call, not the runtime's.
 *
 * It tells a browser to refuse plain HTTP on every subdomain of the host that
 * sent it, for six months — including subdomains this process has never heard
 * of. It is opt-in now, through REBASE_HSTS_INCLUDE_SUBDOMAINS, validated at
 * boot like every other switch.
 */
describe("REBASE_HSTS_INCLUDE_SUBDOMAINS", () => {
    const originalEnv = { ...process.env };
    afterEach(() => {
        process.env = { ...originalEnv };
    });

    async function hsts(includeSubDomains: boolean): Promise<string | null> {
        const app = new Hono();
        app.use("/*", runtimeSecureHeaders({ hstsIncludeSubDomains: includeSubDomains }));
        app.get("/", (c) => c.text("ok"));
        return (await app.request("/")).headers.get("strict-transport-security");
    }

    it("leaves sibling subdomains alone by default", async () => {
        expect(await hsts(false)).toBe("max-age=15552000");
    });

    it("covers them when asked", async () => {
        expect(await hsts(true)).toBe("max-age=15552000; includeSubDomains");
    });

    function bootEnvWith(value: string | undefined) {
        process.env = {
            DATABASE_URL: "postgresql://db.example.com:5432/app",
            JWT_SECRET: "a-secret-that-is-long-enough-for-the-check-1234",
            ...(value === undefined ? {} : { REBASE_HSTS_INCLUDE_SUBDOMAINS: value })
        };
        return loadBootEnv();
    }

    it("is read and validated at boot", () => {
        expect(bootEnvWith(undefined).REBASE_HSTS_INCLUDE_SUBDOMAINS).toBe(false);
        expect(bootEnvWith("true").REBASE_HSTS_INCLUDE_SUBDOMAINS).toBe(true);
        expect(() => bootEnvWith("yes please")).toThrow(/REBASE_HSTS_INCLUDE_SUBDOMAINS/);
    });
});
