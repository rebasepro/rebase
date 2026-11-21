/**
 * Whether a verified custom domain is served over HTTPS yet.
 *
 * Verification proves the DNS; the certificate comes after it. The control
 * plane marks a host verified and puts it on the Ingress, and only then is a
 * certificate requested for it — for the minutes that takes, the ingress
 * answers with its placeholder ("Kubernetes Ingress Controller Fake
 * Certificate"), and every browser refuses the site. The control plane's
 * domain rows carry no certificate state, so `domains list` said `verified`
 * through all of it and `domains verify` said "verified and live".
 *
 * So the CLI asks the host itself: one TLS handshake on port 443, with SNI and
 * the platform's normal certificate checks (a trusted chain, and a name that
 * matches), and a short timeout. It runs only for verified hosts — a pending
 * one is not on the Ingress at all.
 *
 * The checker is injectable ({@link setCertificateCheckerForTest}): a test
 * never opens a socket to a real domain.
 */
import tls from "node:tls";

/**
 * `ready` — a trusted certificate for this name; HTTPS works.
 * `pending` — the host answers TLS with a certificate a browser refuses: the
 *   placeholder while the real one is issued, or one for another name.
 * `unreachable` — no TLS answer at all (refused, timed out, not resolving).
 */
export type CertificateState = "ready" | "pending" | "unreachable";

export interface CertificateCheck {
    state: CertificateState;
    /** Why it is not ready, in a few words. Absent when ready. */
    reason?: string;
}

export type CertificateChecker = (host: string) => Promise<CertificateCheck>;

/** How long one handshake may take. Short: this decorates a listing, it is not the listing. */
export const CERTIFICATE_TIMEOUT_MS = 4_000;

/**
 * The OpenSSL verification codes that mean "this certificate is not the
 * trusted one for this name" rather than "nothing answered". Node reports them
 * as an error's `code` on a refused handshake, `fetch` included.
 */
const CERTIFICATE_ERROR_CODES = new Set([
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "UNABLE_TO_GET_ISSUER_CERT",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "CERT_UNTRUSTED",
    "CERT_HAS_EXPIRED",
    "CERT_NOT_YET_VALID",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "HOSTNAME_MISMATCH"
]);

/** Whether an error code is a certificate refusal rather than a network failure. */
export function isCertificateErrorCode(code: string | undefined): boolean {
    return code !== undefined && CERTIFICATE_ERROR_CODES.has(code);
}

/** What a finished handshake showed, reduced to what the verdict needs. */
export interface HandshakeFacts {
    /** The chain verified against the trusted roots. */
    authorized: boolean;
    /** Why it did not, as Node words it (`DEPTH_ZERO_SELF_SIGNED_CERT`, …). */
    authorizationError?: string;
    /** The certificate's subject common name, when it has one. */
    subjectCN?: string;
    /** `subjectaltname`, as Node prints it: `DNS:a.example.com, DNS:b.example.com`. */
    subjectAltName?: string;
    /** Set when the certificate does not name the host. */
    nameMismatch?: boolean;
}

/** The verdict on one handshake: pure, so every branch of it is testable. */
export function classifyHandshake(host: string, facts: HandshakeFacts): CertificateCheck {
    const placeholder = facts.subjectCN && /fake certificate/i.test(facts.subjectCN);
    if (placeholder) {
        return {
            state: "pending",
            reason: `the ingress still serves its placeholder certificate ("${facts.subjectCN}"); the real one is being issued`
        };
    }
    if (!facts.authorized) {
        return {
            state: "pending",
            reason: `the certificate it serves is not trusted yet (${facts.authorizationError ?? "unverified"})`
        };
    }
    if (facts.nameMismatch) {
        const names = facts.subjectAltName?.replace(/DNS:/g, "").trim() || facts.subjectCN || "another name";
        return { state: "pending", reason: `the certificate it serves is for ${names}, not ${host}` };
    }
    return { state: "ready" };
}

function errorCode(e: unknown): string | undefined {
    return typeof e === "object" && e !== null && "code" in e && typeof e.code === "string" ? e.code : undefined;
}

/** A failed connection, in a few words. */
function unreachableReason(e: unknown): string {
    const code = errorCode(e);
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "the name does not resolve yet";
    if (code === "ECONNREFUSED") return "nothing accepts HTTPS on port 443";
    if (code) return `no TLS answer (${code})`;
    return e instanceof Error ? e.message : String(e);
}

/**
 * One handshake to `host:443`, with SNI. The chain and the name are checked as
 * Node checks them for any HTTPS request — read rather than enforced, so a
 * refused certificate can be described instead of only failing.
 */
export const checkCertificate: CertificateChecker = (host) => new Promise<CertificateCheck>((resolve) => {
    let settled = false;
    const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false });
    const settle = (check: CertificateCheck) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(check);
    };
    socket.setTimeout(CERTIFICATE_TIMEOUT_MS, () =>
        settle({ state: "unreachable", reason: `no TLS answer within ${CERTIFICATE_TIMEOUT_MS / 1000}s` }));
    socket.once("error", (e) => {
        const code = errorCode(e);
        settle(isCertificateErrorCode(code)
            ? { state: "pending", reason: `the certificate it serves is not trusted yet (${code})` }
            : { state: "unreachable", reason: unreachableReason(e) });
    });
    socket.once("secureConnect", () => {
        const cert = socket.getPeerCertificate();
        const authorizationError = socket.authorizationError;
        settle(classifyHandshake(host, {
            authorized: socket.authorized,
            authorizationError: errorCode(authorizationError) ?? authorizationError?.message,
            subjectCN: typeof cert.subject?.CN === "string" ? cert.subject.CN : undefined,
            subjectAltName: cert.subjectaltname,
            nameMismatch: tls.checkServerIdentity(host, cert) !== undefined
        }));
    });
});

let activeChecker: CertificateChecker = checkCertificate;

/** Replace the checker (a test's fake), or put the real one back with no argument. */
export function setCertificateCheckerForTest(checker?: CertificateChecker): void {
    activeChecker = checker ?? checkCertificate;
}

/** The certificate state of each host, checked in parallel. A checker that throws reads as unreachable. */
export async function checkCertificates(hosts: readonly string[]): Promise<Map<string, CertificateCheck>> {
    const unique = [...new Set(hosts)];
    const checked = await Promise.all(unique.map(async (host): Promise<[string, CertificateCheck]> => {
        try {
            return [host, await activeChecker(host)];
        } catch (e) {
            return [host, { state: "unreachable", reason: unreachableReason(e) }];
        }
    }));
    return new Map(checked);
}

/** `verified`, or `verified, certificate pending` — the state a person reads. */
export function verifiedLabel(check: CertificateCheck | undefined): string {
    if (!check || check.state === "ready") return "verified";
    return check.state === "pending" ? "verified, certificate pending" : "verified, HTTPS not answering";
}
