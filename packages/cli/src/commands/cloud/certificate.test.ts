/**
 * Whether a verified domain's HTTPS works: the verdict on one handshake, the
 * parallel check `domains` and `status` run, and the deploy's live check
 * naming a refused certificate for what it is.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
    checkCertificates,
    classifyHandshake,
    isCertificateErrorCode,
    setCertificateCheckerForTest,
    verifiedLabel
} from "./certificate";
import { probeOnce } from "./deploy-summary";

afterEach(() => setCertificateCheckerForTest());

describe("classifyHandshake", () => {
    it("is ready for a trusted certificate that names the host", () => {
        expect(classifyHandshake("shop.example.com", {
            authorized: true,
            subjectCN: "shop.example.com",
            subjectAltName: "DNS:shop.example.com",
            nameMismatch: false
        })).toEqual({ state: "ready" });
    });

    it("is pending while the ingress serves its placeholder", () => {
        const check = classifyHandshake("shop.example.com", {
            authorized: false,
            authorizationError: "DEPTH_ZERO_SELF_SIGNED_CERT",
            subjectCN: "Kubernetes Ingress Controller Fake Certificate",
            subjectAltName: "DNS:ingress.local",
            nameMismatch: true
        });
        expect(check.state).toBe("pending");
        expect(check.reason).toContain("placeholder certificate");
        expect(check.reason).toContain("Kubernetes Ingress Controller Fake Certificate");
    });

    it("is pending for an untrusted chain, naming why", () => {
        expect(classifyHandshake("shop.example.com", { authorized: false, authorizationError: "CERT_HAS_EXPIRED" }))
            .toEqual({ state: "pending", reason: "the certificate it serves is not trusted yet (CERT_HAS_EXPIRED)" });
    });

    it("is pending for a trusted certificate for another name", () => {
        expect(classifyHandshake("shop.example.com", {
            authorized: true,
            subjectCN: "shop.rebase.website",
            subjectAltName: "DNS:*.rebase.website",
            nameMismatch: true
        })).toEqual({ state: "pending", reason: "the certificate it serves is for *.rebase.website, not shop.example.com" });
    });
});

describe("checkCertificates", () => {
    it("asks each host once, in parallel, through the injected checker", async () => {
        const asked: string[] = [];
        setCertificateCheckerForTest(async (host) => {
            asked.push(host);
            return host === "a.example.com" ? { state: "ready" } : { state: "pending", reason: "placeholder" };
        });

        const checks = await checkCertificates(["a.example.com", "b.example.com", "a.example.com"]);

        expect(asked.sort()).toEqual(["a.example.com", "b.example.com"]);
        expect(checks.get("a.example.com")).toEqual({ state: "ready" });
        expect(checks.get("b.example.com")).toEqual({ state: "pending", reason: "placeholder" });
    });

    it("reads a checker that throws as unreachable, never as ready", async () => {
        setCertificateCheckerForTest(async () => {
            throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
        });

        const checks = await checkCertificates(["a.example.com"]);

        expect(checks.get("a.example.com")).toEqual({ state: "unreachable", reason: "nothing accepts HTTPS on port 443" });
    });
});

describe("verifiedLabel", () => {
    it("adds what HTTPS answered to `verified`", () => {
        expect(verifiedLabel({ state: "ready" })).toBe("verified");
        expect(verifiedLabel(undefined)).toBe("verified");
        expect(verifiedLabel({ state: "pending" })).toBe("verified, certificate pending");
        expect(verifiedLabel({ state: "unreachable" })).toBe("verified, HTTPS not answering");
    });
});

describe("the deploy's live check", () => {
    it("names a refused certificate as not ready, rather than unreachable", async () => {
        expect(isCertificateErrorCode("DEPTH_ZERO_SELF_SIGNED_CERT")).toBe(true);
        expect(isCertificateErrorCode("ECONNREFUSED")).toBe(false);

        const refused: typeof fetch = async () => {
            throw Object.assign(new TypeError("fetch failed"), {
                cause: Object.assign(new Error("self-signed certificate"), { code: "DEPTH_ZERO_SELF_SIGNED_CERT" })
            });
        };
        const check = await probeOnce(
            { name: "site", type: "static", host: "shop.example.com", url: "https://shop.example.com" },
            "d1",
            refused
        );

        expect(check).toMatchObject({ live: false, reason: "HTTPS certificate not ready yet (DEPTH_ZERO_SELF_SIGNED_CERT)" });
    });
});
