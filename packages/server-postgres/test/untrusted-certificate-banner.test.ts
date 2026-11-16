import { diagnoseDbError, isUntrustedServerCertificate } from "../src/cli-errors";
import { createPostgresBootstrapper } from "../src/PostgresBootstrapper";

/**
 * `sslmode=require` on a managed database whose certificate no public
 * authority signed. psql, Atlas and the provider's docs read `require` as
 * "encrypted, not verified"; node-postgres reads it as `verify-full`, so the
 * same URL failed boot and `rebase db push` with a bare `self-signed
 * certificate` and a stack trace.
 */
const selfSigned = () => Object.assign(new Error("self-signed certificate"), { code: "DEPTH_ZERO_SELF_SIGNED_CERT" });

const URL_ = "postgresql://app:s3cret@db.example.com:5432/shop?sslmode=require";

describe("isUntrustedServerCertificate", () => {
    it("recognises node's codes for an unsigned or privately signed certificate", () => {
        for (const code of ["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"]) {
            expect(isUntrustedServerCertificate(Object.assign(new Error("x"), { code }))).toBe(true);
        }
    });

    it("finds it under Drizzle's wrapper, the shape boot and db push actually see", () => {
        expect(isUntrustedServerCertificate(new Error("Failed query: SELECT 1", { cause: selfSigned() }))).toBe(true);
    });

    it("finds it inside a dual-stack AggregateError", () => {
        expect(isUntrustedServerCertificate(new AggregateError([selfSigned()], "All attempts failed"))).toBe(true);
    });

    it("does not claim other TLS or connection failures", () => {
        expect(isUntrustedServerCertificate(Object.assign(new Error("Hostname/IP does not match certificate's altnames"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" }))).toBe(false);
        expect(isUntrustedServerCertificate(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))).toBe(false);
        expect(isUntrustedServerCertificate(null)).toBe(false);
    });
});

describe("the untrusted-certificate banner", () => {
    const banner = (url: string = URL_) => diagnoseDbError(new Error("Failed query: SELECT 1", { cause: selfSigned() }), url) ?? "";

    it("names the host", () => {
        expect(banner()).toContain("db.example.com:5432");
    });

    it("offers the URL with sslmode=no-verify in place of require", () => {
        expect(banner()).toContain("postgresql://app:***@db.example.com:5432/shop?sslmode=no-verify");
    });

    it("drops uselibpqcompat from the suggestion, since no-verify does its job", () => {
        const out = banner("postgresql://app:s3cret@db.example.com:5432/shop?sslmode=require&uselibpqcompat=true");
        expect(out).toContain("/shop?sslmode=no-verify");
        expect(out).not.toContain("uselibpqcompat");
    });

    it("also names the way to keep verification", () => {
        expect(banner()).toContain("sslmode=verify-full&sslrootcert=");
    });

    it("never prints the password", () => {
        expect(banner()).not.toContain("s3cret");
    });
});

describe("boot on an untrusted certificate", () => {
    it("stops with an error that names the fix, not a generic 'cannot reach'", async () => {
        const bootstrapper = createPostgresBootstrapper({
            connectionString: URL_,
            connection: { execute: async () => { throw new Error("Failed query: SELECT 1", { cause: selfSigned() }); } }
        });
        await expect(bootstrapper.verifyConnection!(undefined)).rejects.toThrow(/db\.example\.com:5432 is not trusted.*sslmode=no-verify/s);
    });
});
