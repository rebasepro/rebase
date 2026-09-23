/**
 * The order TLS is tried in, when the connection string does not say.
 *
 * The comment on `connect` promised libpq's behaviour, and libpq's default
 * (`sslmode=prefer`) asks for TLS first. The scan asked for plaintext first,
 * so any server that accepts both — RDS with `force_ssl` off, most self-hosted
 * Postgres — was scanned in cleartext, with nothing in the report to say so.
 */
import { describe, expect, it } from "vitest";

import { connectionAttempts } from "./introspect";

describe("connectionAttempts", () => {
    it.each([undefined, "prefer"])("tries TLS before plaintext when sslmode is %s", (sslmode) => {
        expect(connectionAttempts(sslmode)).toEqual([
            { ssl: { rejectUnauthorized: true }, downgraded: false },
            { ssl: { rejectUnauthorized: false }, downgraded: true },
            { ssl: false, downgraded: false }
        ]);
    });

    it("tries plaintext first only when sslmode=allow asks for that", () => {
        expect(connectionAttempts("allow")).toEqual([
            { ssl: false, downgraded: false },
            { ssl: { rejectUnauthorized: false }, downgraded: false }
        ]);
    });

    it("never falls back from an explicit mode", () => {
        expect(connectionAttempts("disable")).toEqual([{ ssl: false, downgraded: false }]);
        expect(connectionAttempts("require")).toEqual([{ ssl: { rejectUnauthorized: false }, downgraded: false }]);
        expect(connectionAttempts("verify-full")).toEqual([{ ssl: { rejectUnauthorized: true }, downgraded: false }]);
    });
});
