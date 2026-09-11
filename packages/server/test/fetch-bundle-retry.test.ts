/**
 * When a failed bundle download is worth trying again.
 *
 * The retry loop was already here — six attempts, three seconds apart — and it
 * was skipped for the one status that needed it. `/^4\d\d /` marked every 4xx
 * permanent, and 429 is the one 4xx that is an instruction rather than a
 * verdict: the control plane caps concurrent bundle fetches (three in the
 * fleet, two per project) because the handler holds a bundle in memory and
 * eight at once is an OOMKill of the thing every tenant depends on. So it
 * answers 429 with `Retry-After`, meaning "come back", and expects to be come
 * back to.
 *
 * Read as a verdict instead, a rollout that brought two pods up together failed
 * to start, took the deployment with it, and rolled back — which is what
 * happened to rebase-growth on 2026-09-11 at 15:24Z.
 */
import { isTransientStatus, retryAfterMs, MAX_RETRY_AFTER_MS } from "../src/boot/fetch-bundle";

describe("which failures are worth waiting out", () => {
    it("treats 429 and 408 as not-yet", () => {
        expect(isTransientStatus("429 Too Many Requests")).toBe(true);
        expect(isTransientStatus("408 Request Timeout")).toBe(true);
    });

    it("still treats a credential or a missing bundle as final", () => {
        // These do not become a 200 by waiting, and retrying them spends a
        // pod's whole startup budget confirming a token is still wrong.
        for (const detail of [
            "401 Unauthorized",
            "403 Forbidden",
            "404 Not Found",
            "400 Bad Request"
        ]) {
            expect(`${detail} → ${isTransientStatus(detail)}`).toBe(`${detail} → false`);
        }
    });

    it("does not mistake a status that merely contains the digits", () => {
        // The message is `<status> <statusText>`, so the space is what anchors
        // it. A bundle id or a byte count with 429 in it is not a status.
        expect(isTransientStatus("404 Not Found: bundle 429abc")).toBe(false);
        expect(isTransientStatus("write EPIPE after 4290 bytes")).toBe(false);
    });
});

describe("how long to wait", () => {
    it("honours a Retry-After given in seconds", () => {
        expect(retryAfterMs("429 Too Many Requests (retry-after: 2)")).toBe(2_000);
    });

    it("honours one given as an HTTP date", () => {
        const now = Date.parse("2026-09-11T15:24:00.000Z");
        const detail = "429 Too Many Requests (retry-after: Fri, 11 Sep 2026 15:24:05 GMT)";
        expect(retryAfterMs(detail, now)).toBe(5_000);
    });

    it("caps it, because this runs inside a startup probe window", () => {
        // A server asking for five minutes gets the cap and another attempt,
        // which is better than a container killed as unhealthy while it waits
        // politely.
        expect(retryAfterMs("429 Too Many Requests (retry-after: 600)")).toBe(MAX_RETRY_AFTER_MS);
    });

    it("never returns a negative wait for a date already past", () => {
        const now = Date.parse("2026-09-11T15:24:10.000Z");
        const detail = "429 Too Many Requests (retry-after: Fri, 11 Sep 2026 15:24:05 GMT)";
        expect(retryAfterMs(detail, now)).toBe(0);
    });

    it("says nothing when the header was absent or unreadable", () => {
        // The caller then uses its own delay. Guessing a number from a header
        // the server did not send would be inventing a server's opinion.
        expect(retryAfterMs("429 Too Many Requests")).toBeUndefined();
        expect(retryAfterMs("429 Too Many Requests (retry-after: soon)")).toBeUndefined();
    });
});
